#!/usr/bin/env node
/**
 * AgenticRPGMaker — build the portable `www` game folder (P5, RQ1).
 *
 * Produces the self-contained RPG-Maker-style portable package:
 *
 *   www/
 *     index.html                 shipped player page (loads js/runtime.js)
 *     js/runtime.js              bundled runtime + core + renderer (plain browser JS)
 *     data/manifest.json         build-generated load list (static-host friendly)
 *     data/project.json          sample project document (validated vs core)
 *     data/maps/*.map.json       sample maps (validated vs core)
 *     data/tilesets/*.tileset.json  sample tilesets (validated vs core)
 *     img/tilesets/placeholder.png  generated placeholder atlas (deterministic)
 *     audio/README.md            audio is an MVP non-goal (RQ1)
 *     README.md                  how to run: static host / JoiPlay / via the server
 *
 * Bundling: esbuild (a pinned root devDependency). The entry
 * (`scripts/www-entry.ts`) mirrors the runtime demo harness but is the shipped
 * player page: it loads `data/`, validates with core schemas, and calls
 * `boot()`. The workspace packages are aliased to their TypeScript sources
 * (same trick as the demo's vite config) so no pre-built dists are required.
 *
 * Verification built into this script:
 *   1. banned-API grep on the built bundle (docs/08 §3) — zero hits or exit 1
 *   2. schema validation of every data/ document via packages/core
 *   3. `node --check` syntax validation of the built bundle
 *
 * Usage:
 *   node scripts/build-www.mjs [--out <dir>] [--minify] [--skip-bundle]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(REPO_ROOT, "packages");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const outDir = flagValue(args, "--out") ?? path.join(REPO_ROOT, "www");
const minify = args.includes("--minify");
const skipBundle = args.includes("--skip-bundle");

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`[build-www] FAIL: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Deterministic placeholder atlas (replicates packages/editor/src/tileset/
// placeholder.ts colors so the shipped image matches the editor's preview).
// ---------------------------------------------------------------------------
const TILE_SIZE = 16;
const COLUMNS = 8;
const ROWS = 8;

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function tileColor(index) {
  const hue = (index * 47) % 360;
  const sat = 50 + (index % 4) * 8;
  const light = 40 + (index % 5) * 9;
  return hslToRgb(hue, sat / 100, light / 100);
}

function tileEdgeColor(index) {
  const hue = (index * 47) % 360;
  return hslToRgb(hue, 0.55, 0.25);
}

function tileDotColor(index) {
  const hue = (index * 47) % 360;
  return hslToRgb(hue, 0.7, 0.75);
}

/** Paint the placeholder atlas into an RGBA pixel buffer (128x128). */
function paintPlaceholderAtlas() {
  const size = TILE_SIZE * COLUMNS; // 128
  const rgba = Buffer.alloc(size * size * 4);
  const setPx = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const o = (y * size + x) * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  };
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const index = row * COLUMNS + col + 1; // atlas cell → tile index (0 = empty)
      const x0 = col * TILE_SIZE;
      const y0 = row * TILE_SIZE;
      const fill = tileColor(index);
      const edge = tileEdgeColor(index);
      const dot = tileDotColor(index);
      const dotRadius = 2 + (index % 4);
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          let color = fill;
          if (y < 2 || x < 2) {
            color = edge; // inner pattern: top + left edge stripe
          } else {
            const dx = x - TILE_SIZE / 2;
            const dy = y - TILE_SIZE / 2;
            if (dx * dx + dy * dy <= dotRadius * dotRadius) {
              color = dot; // center dot
            }
          }
          setPx(x0 + x, y0 + y, color);
        }
      }
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression / filter / interlace = 0
  const stride = 1 + width * 4; // filter byte per scanline
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Banned-API smoke check (docs/08-compatibility-checklist.md §3, D1/D2)
// ---------------------------------------------------------------------------
const BANNED_PATTERNS = [
  { label: "File System Access API (showOpenFilePicker)", re: /\bshowOpenFilePicker\b/ },
  { label: "File System Access API (showSaveFilePicker)", re: /\bshowSaveFilePicker\b/ },
  { label: "File System Access API (FileSystemFileHandle)", re: /\bFileSystemFileHandle\b/ },
  { label: "OPFS (getDirectory)", re: /\bgetDirectory\b/ },
  { label: "Node require()", re: /\brequire\s*\(/ },
  { label: "Node process.*", re: /\bprocess\.[a-zA-Z_]/ },
  { label: "Node builtin (node:)", re: /\bnode:[a-zA-Z]/ },
  { label: "file:// fetch", re: /file:\/\// },
];

function checkBannedApis(bundlePath) {
  const bundle = readFileSync(bundlePath, "utf8");
  const hits = [];
  for (const { label, re } of BANNED_PATTERNS) {
    const match = bundle.match(re);
    if (match !== null) {
      hits.push(`${label} (first hit: ${match[0]})`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
function readDirRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of readDirRecursive(abs)) {
        out.push(path.join(entry.name, child));
      }
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/** Walk a dir, returning all files and directories as paths relative to it. */
function walkRelative(dir) {
  const files = [];
  const dirs = [];
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const rel = path.relative(dir, path.join(base, entry.name));
      if (entry.isDirectory()) {
        dirs.push(rel);
        walk(path.join(base, entry.name));
      } else {
        files.push(rel);
      }
    }
  };
  walk(dir);
  return { files, dirs };
}

function cleanDir(dir) {
  // Remove the previous build deterministically (no rm -rf dependency).
  if (existsSync(dir)) {
    const { files, dirs } = walkRelative(dir);
    for (const rel of files) {
      unlinkSync(path.join(dir, rel));
    }
    for (const rel of dirs.sort().reverse()) {
      rmdirSync(path.join(dir, rel));
    }
    rmdirSync(dir);
  }
  mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
}

function collectJsonFiles(dir, suffix) {
  if (!existsSync(dir)) {
    return [];
  }
  return readDirRecursive(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// Validation via packages/core (requires the built dist; built on demand)
// ---------------------------------------------------------------------------
function ensureCoreDist() {
  const dist = path.join(PACKAGES, "core", "dist", "index.js");
  if (existsSync(dist)) {
    return;
  }
  console.log("[build-www] packages/core dist missing — building…");
  execFileSync("pnpm", ["--filter", "@agenticrpg/core", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (!existsSync(dist)) {
    fail("packages/core build did not produce dist/index.js");
  }
}

async function validateDataFiles(dataDir) {
  ensureCoreDist();
  // Import the built ESM dist directly (the root package does not declare a
  // dependency on @agenticrpg/core, so it is not resolvable via node_modules).
  const core = await import(path.join(PACKAGES, "core", "dist", "index.js"));
  const jsonFiles = collectJsonFiles(dataDir, ".json");
  const reports = [];
  for (const file of jsonFiles) {
    const rel = path.relative(REPO_ROOT, file);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const name = path.basename(file);
    if (name === "manifest.json") {
      reports.push({
        file: rel,
        ok: true,
        kind: "manifest (build-generated, not schema-validated)",
      });
      continue;
    }
    try {
      if (name.endsWith(".map.json")) {
        const parsed = core.parseMapDocument(raw);
        reports.push({ file: rel, ok: true, kind: "map", id: parsed.id });
      } else if (name.endsWith(".tileset.json")) {
        const parsed = core.parseTilesetDocument(raw);
        reports.push({ file: rel, ok: true, kind: "tileset", id: parsed.id });
      } else if (name.endsWith(".project.json") || name === "project.json") {
        const parsed = core.parseProjectDocument(raw);
        reports.push({ file: rel, ok: true, kind: "project", id: `${parsed.settings.initialMap}` });
      } else {
        reports.push({ file: rel, ok: true, kind: "json (no schema)" });
      }
    } catch (error) {
      reports.push({
        file: rel,
        ok: false,
        kind: "schema validation failed",
        error: String(error),
      });
    }
  }
  return reports;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const samplesDir = path.join(REPO_ROOT, "samples");
  console.log(`[build-www] output: ${outDir}`);

  // 1. Clean + scaffold the folder layout.
  cleanDir(outDir);
  for (const sub of ["js", "data/maps", "data/tilesets", "img/tilesets", "audio"]) {
    mkdirSync(path.join(outDir, sub), { recursive: true });
  }

  // 2. Bundle the shipped player page (runtime + core + renderer) via esbuild.
  const bundlePath = path.join(outDir, "js", "runtime.js");
  if (!skipBundle) {
    const esbuild = await import("esbuild");
    const result = await esbuild.build({
      entryPoints: [path.join(__dirname, "www-entry.ts")],
      bundle: true,
      format: "iife",
      target: "es2020",
      platform: "browser",
      outfile: bundlePath,
      minify,
      sourcemap: false,
      legalComments: "none",
      logLevel: "info",
      alias: {
        "@agenticrpg/runtime": path.join(PACKAGES, "runtime", "src", "index.ts"),
        "@agenticrpg/core": path.join(PACKAGES, "core", "src", "index.ts"),
        "@agenticrpg/renderer": path.join(PACKAGES, "renderer", "src", "index.ts"),
      },
    });
    console.log(`[build-www] bundled ${bundlePath} (${result.metafile ? "ok" : "ok"})`);
  } else {
    console.log("[build-www] --skip-bundle: using existing bundle");
    if (!existsSync(bundlePath)) {
      fail("--skip-bundle but no existing bundle at " + bundlePath);
    }
  }

  // 3. Copy sample data (maps, tilesets, project) into data/.
  const mapFiles = collectJsonFiles(path.join(samplesDir, "maps"), ".map.json");
  const tilesetFiles = collectJsonFiles(path.join(samplesDir, "tilesets"), ".tileset.json");
  const projectFiles = collectJsonFiles(path.join(samplesDir, "projects"), ".project.json");
  if (mapFiles.length === 0) {
    fail("no sample maps found under samples/maps/");
  }

  const copiedMaps = [];
  for (const file of mapFiles) {
    copyFile(file, path.join(outDir, "data", "maps", path.basename(file)));
    copiedMaps.push(`data/maps/${path.basename(file)}`);
  }
  const copiedTilesets = [];
  for (const file of tilesetFiles) {
    copyFile(file, path.join(outDir, "data", "tilesets", path.basename(file)));
    copiedTilesets.push(`data/tilesets/${path.basename(file)}`);
  }
  if (projectFiles.length > 0) {
    copyFile(projectFiles[0], path.join(outDir, "data", "project.json"));
  }

  // 4. Generate the placeholder atlas PNG into img/.
  const png = encodePng(TILE_SIZE * COLUMNS, TILE_SIZE * ROWS, paintPlaceholderAtlas());
  const pngPath = path.join(outDir, "img", "tilesets", "placeholder.png");
  writeFileSync(pngPath, png);
  console.log(`[build-www] generated ${path.relative(REPO_ROOT, pngPath)} (${png.length} bytes)`);

  // 5. Build-generated manifest (static-host friendly load list).
  const manifest = { maps: copiedMaps, tilesets: copiedTilesets };
  writeFileSync(
    path.join(outDir, "data", "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // 6. index.html — the shipped player page (no remote fonts, conservative).
  writeFileSync(path.join(outDir, "index.html"), INDEX_HTML);

  // 7. READMEs.
  writeFileSync(path.join(outDir, "README.md"), wwwReadme(mkRelative(REPO_ROOT, outDir)));
  writeFileSync(path.join(outDir, "audio", "README.md"), AUDIO_README);

  // ---- Verification -------------------------------------------------------
  // a. banned-API smoke check on the built bundle (docs/08 §3, D1/D2)
  console.log("[build-www] banned-API smoke check…");
  const hits = checkBannedApis(bundlePath);
  if (hits.length > 0) {
    fail(`banned APIs found in bundle:\n  ${hits.join("\n  ")}`);
  }
  console.log("[build-www] banned-API grep: 0 hits (clean)");

  // b. schema validation of every data/ document via packages/core
  console.log("[build-www] validating data/ against core schemas…");
  const reports = await validateDataFiles(path.join(outDir, "data"));
  const bad = reports.filter((r) => !r.ok);
  for (const r of reports) {
    console.log(`  [${r.ok ? "ok" : "FAIL"}] ${r.file} (${r.kind}${r.id ? `, id=${r.id}` : ""})`);
  }
  if (bad.length > 0) {
    fail(`data validation failed:\n  ${bad.map((r) => `${r.file}: ${r.error}`).join("\n  ")}`);
  }

  // c. syntax check of the built bundle (browser-only code parses as JS)
  execFileSync(process.execPath, ["--check", bundlePath], { stdio: "inherit" });
  console.log(`[build-www] bundle syntax check: ${bundlePath} parses as valid JS`);

  // d. integrity summary
  const bundle = readFileSync(bundlePath, "utf8");
  const sha = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
  console.log(`[build-www] bundle sha256[0:16]=${sha}, size=${bundle.length} bytes`);
  console.log(
    "[build-www] done. To serve: agenticrpg-server --www-root " + outDir + " --port 8080",
  );
}

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <title>AgenticRPGMaker — Sample Game</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #111;
        color: #ddd;
        font:
          14px/1.5 system-ui,
          sans-serif;
        height: 100%;
        overflow: hidden;
      }
      #app {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #game-canvas {
        image-rendering: pixelated;
        background: #22332a;
        max-width: 100vw;
        max-height: 100vh;
      }
      #root {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      #boot-status {
        position: fixed;
        bottom: 0.5rem;
        left: 0.5rem;
        color: #9aa;
        font: 11px/1.4 monospace;
        background: rgba(0, 0, 0, 0.45);
        padding: 0.3rem 0.5rem;
        border-radius: 0.3rem;
        pointer-events: none;
      }
      .controls-hint {
        position: fixed;
        top: 2.2rem;
        left: 0.5rem;
        color: #9aa;
        font: 11px/1.4 monospace;
        background: rgba(0, 0, 0, 0.45);
        padding: 0.3rem 0.5rem;
        border-radius: 0.3rem;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas" width="640" height="480"></canvas>
    </div>
    <div id="root"></div>
    <div class="controls-hint">Arrows/WASD walk · Z/Enter talk · X/Esc close · F5 save · F9 load</div>
    <div id="boot-status" data-testid="boot-status" data-status="loading">Loading…</div>
    <script src="js/runtime.js"></script>
  </body>
</html>
`;

const AUDIO_README = `# audio/

Audio is an **explicit MVP non-goal** (docs/01-vision.md, docs/02-open-questions.md
RQ1, docs/07-mvp-plan.md §9.2). This folder exists in the portable layout by
design and is intentionally empty: the runtime never loads audio and degrades
silently when a \`playSound\` event fires (the C++ server and the runtime only log
it). When audio lands, only Web Audio basics are allowed
(docs/08-compatibility-checklist.md §4.2).
`;

function mkRelative(from, to) {
  return path.relative(from, to) || ".";
}

function wwwReadme(relOut) {
  return `# AgenticRPGMaker — portable game package (www/)

This folder is the **portable game** (docs/01-vision.md §3, docs/02-open-questions.md
RQ1): a self-contained RPG-Maker-style bundle that runs on **any static host, any
modern browser, and JoiPlay-type mobile HTML runtimes** — no Node.js, no server,
no install required for single-player.

## Layout

| Path                         | Purpose                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| \`index.html\`               | The shipped player page (loads \`js/runtime.js\`, calls \`boot()\`).                       |
| \`js/runtime.js\`            | Bundled runtime + core + renderer (plain browser JS, ES2020, zero Node APIs).             |
| \`data/manifest.json\`       | Build-generated load list of maps + tilesets (static-host friendly, no directory listing).|
| \`data/maps/*.map.json\`     | Sample map(s), validated against the core map schema (ADR-003).                           |
| \`data/tilesets/*.tileset.json\` | Sample tileset(s), validated against the core tileset schema (ADR-003).               |
| \`data/project.json\`        | Sample project manifest (validated against the core project schema).                      |
| \`img/tilesets/placeholder.png\` | Generated placeholder atlas (deterministic, 128×128, 8×8 tiles of 16 px).              |
| \`audio/\`                   | Intentionally empty — audio is an MVP non-goal (see \`audio/README.md\`).                 |

## How to run

### Any static host

Upload/copy this folder anywhere and serve it over HTTP(S), e.g.:

\`\`\`sh
python3 -m http.server 8000 --directory ${relOut}
# or
npx serve ${relOut}
\`\`\`

then open \`http://localhost:8000/\`. Single-player works immediately; saves go to
IndexedDB (docs/08 §4.7).

### JoiPlay-type mobile runtime

Copy the whole folder onto the device, import it in JoiPlay (or equivalent),
and point it at \`index.html\`. On-screen D-pad + A/B buttons are provided for
touch input (docs/08 §4.4). A weak/absent WebGL environment automatically falls
back to the Canvas2D renderer (RQ2).

### Via the C++ server (local launcher mode)

\`\`\`sh
agenticrpg-server --www-root ${relOut} --editor-root editor --port 8080
# open http://localhost:8080/
\`\`\`

### Multiplayer (VPS mode)

Run the server on a machine reachable by your players (it binds 0.0.0.0 by
default) and open the game with the relay URL:

\`\`\`sh
agenticrpg-server --www-root ${relOut} --port 8080
# browser 1: http://host:8080/?server=ws://host:8080/ws&room=demo&name=Alice
# browser 2: http://host:8080/?server=ws://host:8080/ws&room=demo&name=Bob
\`\`\`

TLS is out of scope for the MVP (docs/06-architecture.md §6); put a reverse
proxy in front for public deployments.

## Compatibility notes

- Conservative web APIs only: no File System Access API, no OPFS requirement,
  no Node APIs, no \`file://\` fetches, no remote webfonts (system font stack),
  WebGL1-compatible subset with automatic Canvas2D fallback
  (docs/08-compatibility-checklist.md).
- Rebuild with \`pnpm build:www\` (see repo \`AGENTS.md\`).
`;
}

main().catch((error) => {
  console.error("[build-www] unexpected failure:", error);
  process.exit(1);
});
