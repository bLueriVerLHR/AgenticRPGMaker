#!/usr/bin/env node
/**
 * AgenticRPGMaker — validate game data against the core schemas (D24).
 *
 * The agent-facing gate for editor-less, data-first authoring: walks one or
 * more data directories, loads every JSON document, and runs it through
 * `packages/core`'s parsers (`parseMapDocument`, `parseTilesetDocument`,
 * `parseProjectDocument`). Exits 0 only if every document validates.
 *
 * Same core-loading trick as `scripts/build-www.mjs`: it builds `packages/core`
 * on demand (if `dist` is missing) and imports the built ESM dist directly, so
 * it runs from a clean clone without any pre-built workspace dists.
 *
 * `manifest.json` documents (build-generated load lists) are reported as "ok"
 * without schema validation, matching `build-www.mjs`.
 *
 * Usage:
 *   node scripts/validate.mjs [dir...]      # default: samples/
 *   node scripts/validate.mjs www/data      # validate a built portable package
 *
 * Exit code 0 = all documents valid; 1 = at least one invalid document.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(REPO_ROOT, "packages");
const DEFAULT_DIRS = [path.join(REPO_ROOT, "samples")];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dirs = args.length > 0 ? args.map((d) => path.resolve(REPO_ROOT, d)) : DEFAULT_DIRS;

function fail(message) {
  console.error(`[validate] FAIL: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Core dist (built on demand, imported directly — no workspace resolution)
// ---------------------------------------------------------------------------
function ensureCoreDist() {
  const dist = path.join(PACKAGES, "core", "dist", "index.js");
  if (existsSync(dist)) {
    return dist;
  }
  console.log("[validate] packages/core dist missing — building…");
  execFileSync("pnpm", ["--filter", "@agenticrpg/core", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (!existsSync(dist)) {
    fail("packages/core build did not produce dist/index.js");
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Document collection + validation
// ---------------------------------------------------------------------------
function collectJsonFiles(dir) {
  const out = [];
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const abs = path.join(base, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.name.endsWith(".json")) {
        out.push(abs);
      }
    }
  };
  if (existsSync(dir)) {
    walk(dir);
  }
  return out.sort();
}

async function validateDataDir(core, dir) {
  const files = collectJsonFiles(dir);
  const reports = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      reports.push({ file: rel, ok: false, kind: "invalid JSON", error: String(error) });
      continue;
    }
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
        reports.push({
          file: rel,
          ok: true,
          kind: "project",
          id: `${parsed.settings.initialMap}`,
        });
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
  const coreDist = ensureCoreDist();
  const core = await import(coreDist);

  const allReports = [];
  let totalFiles = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`[validate] warn: no such directory: ${dir}`);
      continue;
    }
    const reports = await validateDataDir(core, dir);
    totalFiles += reports.length;
    for (const r of reports) {
      allReports.push(r);
      console.log(`  [${r.ok ? "ok" : "FAIL"}] ${r.file} (${r.kind}${r.id ? `, id=${r.id}` : ""})`);
      if (!r.ok) {
        console.log(`        ${r.error}`);
      }
    }
  }

  const bad = allReports.filter((r) => !r.ok);
  console.log("---");
  console.log(`[validate] ${totalFiles} document(s), ${bad.length} failed`);
  if (bad.length > 0) {
    fail(`validation failed:\n  ${bad.map((r) => `${r.file}: ${r.error}`).join("\n  ")}`);
  }
  console.log("[validate] all documents valid");
}

main().catch((error) => {
  console.error("[validate] unexpected failure:", error);
  process.exit(1);
});
