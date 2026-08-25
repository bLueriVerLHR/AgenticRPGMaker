#!/usr/bin/env node
/**
 * AgenticRPGMaker — assemble the single-binary deployment folder (P5,
 * docs/06-architecture.md §6; docs/07-mvp-plan.md §7).
 *
 * Produces the MVP deployment layout:
 *
 *   deploy/
 *     agenticrpg-server        the C++20 server binary (ADR-005 / RQ3)
 *     www/                     the portable game package (from build-www)
 *     editor/                  the editor production build (vite)
 *     README.md                run instructions (local + VPS modes)
 *
 * The editor's vite build emits absolute `/assets/...` URLs, which would
 * resolve to the www root when the server mounts the editor under `/editor/`.
 * This script rewrites them to relative (`./assets/...`) URLs in the deployed
 * copy, so the editor works under any mount prefix (assembly-level fix; no
 * package source is modified).
 *
 * Requirements: all workspace packages built (`pnpm -r build`, run up front
 * in dependency order so core → renderer → runtime → editor dists exist), the
 * C++ toolchain. cmake is resolved as: $AGENTICRPG_CMAKE → the pinned
 * self-hosted cmake under work/p0/.tools → PATH.
 *
 * Clean-state contract: `pnpm -r build` runs first so this script works from a
 * fresh clone where no package `dist/` output exists yet. The later "build if
 * missing" checks (editor dist, packages/core dist for build-www validation)
 * are kept as no-op safety nets rather than the primary build path.
 *
 * Usage:
 *   node scripts/build-deploy.mjs [--out <dir>] [--server-build <dir>] [--skip-server-build]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(REPO_ROOT, "packages");
const SERVER_DIR = path.join(REPO_ROOT, "server");

const args = process.argv.slice(2);
const outDir = flagValue(args, "--out") ?? path.join(REPO_ROOT, "deploy");
const serverBuildDir = flagValue(args, "--server-build") ?? path.join(SERVER_DIR, "build-deploy");
const skipServerBuild = args.includes("--skip-server-build");

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`[build-deploy] FAIL: ${message}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  console.log(`[build-deploy] $ ${cmd} ${args.join(" ")} (cwd=${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function resolveCmake() {
  if (process.env.AGENTICRPG_CMAKE) {
    return process.env.AGENTICRPG_CMAKE;
  }
  // The pinned self-hosted cmake lives under <repo>/work/p0/.tools/. In a git
  // worktree the `work/` directory belongs to the MAIN checkout, which is two
  // levels up from a work/p5-pack-style worktree, so check both layouts.
  const relative = path.join("work", "p0", ".tools", "cmake-3.31.6-linux-x86_64", "bin", "cmake");
  for (const candidate of [
    path.join(REPO_ROOT, relative),
    path.join(path.resolve(REPO_ROOT, "..", ".."), relative),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "cmake"; // let PATH resolve it; spawn error is reported if missing
}

function rmrfSync(target) {
  if (!existsSync(target)) {
    return;
  }
  execFileSync("rm", ["-rf", target], { stdio: "inherit" });
}

function copyTree(src, dest) {
  execFileSync("cp", ["-r", ".", dest], { cwd: src, stdio: "inherit" });
}

/** Rewrite absolute /assets/ URLs to relative ./assets/ in the editor index. */
function relativizeEditorAssets(editorDir) {
  const indexPath = path.join(editorDir, "index.html");
  if (!existsSync(indexPath)) {
    fail("editor build missing index.html at " + indexPath);
  }
  let html = readFileSync(indexPath, "utf8");
  const before = html;
  html = html
    .replaceAll('src="/assets/', 'src="./assets/')
    .replaceAll('href="/assets/', 'href="./assets/');
  if (html === before) {
    console.warn("[build-deploy] warn: no /assets/ URLs found to relativize in " + indexPath);
  }
  writeFileSync(indexPath, html);
  console.log("[build-deploy] editor index asset URLs relativized (works under /editor/)");
}

async function main() {
  console.log(`[build-deploy] output: ${outDir}`);

  // 0. Build ALL workspace packages in dependency order (pnpm resolves the
  // topological order core → renderer → runtime → editor). This guarantees the
  // editor's tsc step can resolve `@agenticrpg/runtime` (and renderer/core) from
  // a clean clone where no packages/*/dist exist yet — previously the editor
  // build ran first and failed with TS2307 "Cannot find module '@agenticrpg/runtime'".
  // The per-step "build if missing" checks below remain as no-op safety nets.
  run("pnpm", ["-r", "build"], REPO_ROOT);

  // 1. www — portable game package (Task 1).
  run(process.execPath, [path.join(__dirname, "build-www.mjs")], REPO_ROOT);

  // 2. editor — production build (tsc + vite), then relativize assets.
  const editorDist = path.join(PACKAGES, "editor", "dist");
  if (!existsSync(path.join(editorDist, "index.html"))) {
    console.log("[build-deploy] editor build missing — building…");
    run("pnpm", ["--filter", "@agenticrpg/editor", "build"], REPO_ROOT);
  }
  if (!existsSync(path.join(editorDist, "index.html"))) {
    fail("editor build still missing after pnpm build");
  }

  // 3. C++ server binary (build on demand into server/build-deploy).
  const serverBin = path.join(serverBuildDir, "agenticrpg-server");
  if (!skipServerBuild && !existsSync(serverBin)) {
    const cmake = resolveCmake();
    const configureArgs = [
      "-B",
      serverBuildDir,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DAGENTICRPG_BUILD_TESTS=OFF",
    ];
    // Offline fallback: reuse previously-populated FetchContent sources from
    // another build directory (e.g. a teammate's server/build) instead of
    // cloning deps from the network. Set AGENTICRPG_FETCHCONTENT_DIR to that
    // build directory.
    const fetchDir = process.env.AGENTICRPG_FETCHCONTENT_DIR;
    if (fetchDir !== undefined) {
      if (!existsSync(path.join(fetchDir, "_deps"))) {
        fail(`AGENTICRPG_FETCHCONTENT_DIR=${fetchDir} has no _deps/ directory`);
      }
      const sourceDirs = [
        ["ASIO", "asio-src"],
        ["WEBSOCKETPP", "websocketpp-src"],
        ["SPDLOG", "spdlog-src"],
        ["CATCH2", "catch2-src"],
        ["NLOHMANN_JSON", "nlohmann_json-src"],
      ];
      configureArgs.push("-DFETCHCONTENT_FULLY_DISCONNECTED=ON");
      for (const [name, rel] of sourceDirs) {
        configureArgs.push(
          `-DFETCHCONTENT_SOURCE_DIR_${name}=${path.join(fetchDir, "_deps", rel)}`,
        );
      }
      console.log(`[build-deploy] offline build: reusing FetchContent sources from ${fetchDir}`);
    }
    console.log(`[build-deploy] configuring + building C++ server with cmake=${cmake}`);
    run(cmake, configureArgs, SERVER_DIR);
    run(cmake, ["--build", serverBuildDir, "-j", "4"], SERVER_DIR);
  } else if (!existsSync(serverBin)) {
    fail(`server binary not found at ${serverBin} (remove --skip-server-build or build first)`);
  } else {
    console.log(`[build-deploy] reusing server binary ${serverBin}`);
  }

  // 4. Assemble deploy/.
  rmrfSync(outDir);
  mkdirSync(path.join(outDir, "editor"), { recursive: true });
  execFileSync("cp", [serverBin, path.join(outDir, "agenticrpg-server")], { stdio: "inherit" });
  execFileSync("chmod", ["+x", path.join(outDir, "agenticrpg-server")], { stdio: "inherit" });
  copyTree(path.join(REPO_ROOT, "www"), path.join(outDir, "www"));
  copyTree(editorDist, path.join(outDir, "editor"));

  // Relativize the deployed editor's asset URLs (must happen after the copy).
  relativizeEditorAssets(path.join(outDir, "editor"));

  // 5. README with run instructions.
  writeFileSync(path.join(outDir, "README.md"), deployReadme());

  console.log(`[build-deploy] done. deploy layout:\n${layout(outDir)}`);
}

function layout(outDir) {
  const entries = [];
  for (const entry of [
    "agenticrpg-server",
    "www/index.html",
    "www/js/runtime.js",
    "editor/index.html",
    "README.md",
  ]) {
    entries.push(`  ${entry} (${existsSync(path.join(outDir, entry)) ? "ok" : "MISSING"})`);
  }
  return entries.join("\n");
}

function deployReadme() {
  return `# AgenticRPGMaker — deployment folder

Single C++ Linux binary + static files (docs/06-architecture.md §6). One
process serves the portable game (\`www/\`), the editor (\`editor/\` under
\`/editor\`), and the multiplayer WebSocket relay (\`/ws\`) on one port.

## Layout

| Path                | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| \`agenticrpg-server\` | The C++20 relay/state-sync server (ADR-005).  |
| \`www/\`             | Portable game package (\`index.html\` + \`data/\` + \`js/\` + \`img/\` + \`audio/\`). |
| \`editor/\`          | Editor production build (served under \`/editor\`). |

## Local launcher mode (single player, localhost)

\`\`\`sh
./agenticrpg-server --www-root www --editor-root editor --port 8080
# game:   http://localhost:8080/
# editor: http://localhost:8080/editor/
\`\`\`

## VPS mode (remote multiplayer WebSocket host)

The server binds **0.0.0.0 by default** (\`websocketpp listen(port)\`), so the
same binary is already reachable from the network. Open the server port (8080,
or via \`--port\`) in the firewall, then players join with the relay URL:

\`\`\`sh
./agenticrpg-server --www-root www --editor-root editor --port 8080
# player 1: http://<host>:8080/?server=ws://<host>:8080/ws&room=demo&name=Alice
# player 2: http://<host>:8080/?server=ws://<host>:8080/ws&room=demo&name=Bob
\`\`\`

**Bind-address note:** the MVP server has no \`--bind\` flag; it listens on all
interfaces (0.0.0.0). For a public deployment put a reverse proxy (e.g. nginx /
Caddy, which also terminates TLS) in front — TLS is out of scope for the MVP
(docs/06-architecture.md §6) and a proxy can be added without code changes.

## Options

\`\`\`sh
./agenticrpg-server --help
# --port <port>            default 8080 (env AGENTICRPG_PORT)
# --www-root <dir>         default "www"
# --editor-root <dir>      default "editor"
# --log-level <level>      trace|debug|info|warn|error|critical (env AGENTICRPG_LOG_LEVEL)
# --max-players-per-room <n> default 16
\`\`\`

## Rebuilding

\`pnpm build:deploy\` in the repo regenerates this folder from source
(www bundle + editor build + C++ server binary).
`;
}

main().catch((error) => {
  console.error("[build-deploy] unexpected failure:", error);
  process.exit(1);
});
