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
 *     README.md                run instructions (local + VPS modes)
 *
 * The editor (ADR-006) was removed from `main` and archived via git tag
 * (`archive/editor-0.1.0`) on 2026-08-31 (D20) — this script no longer builds
 * or mounts an editor under `/editor`.
 *
 * Requirements: all workspace packages built (`pnpm -r build`, run up front
 * in dependency order so core → renderer → runtime dists exist), the
 * C++ toolchain. cmake is resolved as: $AGENTICRPG_CMAKE → the pinned
 * self-hosted cmake under .tools → PATH.
 *
 * Clean-state contract: `pnpm -r build` runs first so this script works from a
 * fresh clone where no package `dist/` output exists yet. The later "build if
 * missing" checks (packages/core dist for build-www validation)
 * are kept as no-op safety nets rather than the primary build path.
 *
 * Usage:
 *   node scripts/build-deploy.mjs [--out <dir>] [--server-build <dir>] [--skip-server-build]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
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
  // The pinned self-hosted cmake lives under <repo>/.tools/. It is gitignored,
  // so it is not checked out into a worktree; in a git worktree the `.tools/`
  // directory belongs to the MAIN checkout, which is two levels up from a
  // work/<member>-style worktree, so check both layouts.
  const relative = path.join(".tools", "cmake-3.31.6-linux-x86_64", "bin", "cmake");
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

async function main() {
  console.log(`[build-deploy] output: ${outDir}`);

  // 0. Build ALL workspace packages in dependency order (pnpm resolves the
  // topological order core → renderer → runtime). This guarantees the
  // packages' tsc steps can resolve their workspace deps from
  // a clean clone where no packages/*/dist exist yet.
  // The per-step "build if missing" checks below remain as no-op safety nets.
  run("pnpm", ["-r", "build"], REPO_ROOT);

  // 1. www — portable game package (Task 1).
  run(process.execPath, [path.join(__dirname, "build-www.mjs")], REPO_ROOT);

  // 2. C++ server binary (build on demand into server/build-deploy).
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

  // 3. Assemble deploy/.
  rmrfSync(outDir);
  mkdirSync(outDir, { recursive: true });
  execFileSync("cp", [serverBin, path.join(outDir, "agenticrpg-server")], { stdio: "inherit" });
  execFileSync("chmod", ["+x", path.join(outDir, "agenticrpg-server")], { stdio: "inherit" });
  copyTree(path.join(REPO_ROOT, "www"), path.join(outDir, "www"));

  // 4. README with run instructions.
  writeFileSync(path.join(outDir, "README.md"), deployReadme());

  console.log(`[build-deploy] done. deploy layout:\n${layout(outDir)}`);
}

function layout(outDir) {
  const entries = [];
  for (const entry of ["agenticrpg-server", "www/index.html", "www/js/runtime.js", "README.md"]) {
    entries.push(`  ${entry} (${existsSync(path.join(outDir, entry)) ? "ok" : "MISSING"})`);
  }
  return entries.join("\n");
}

function deployReadme() {
  return `# AgenticRPGMaker — deployment folder

Single C++ Linux binary + static files (docs/06-architecture.md §6). One
process serves the portable game (\`www/\`) and the multiplayer WebSocket relay
(\`/ws\`) on one port. The Web editor (ADR-006) was removed from \`main\` and
archived via git tag \`archive/editor-0.1.0\` (D20) — there is no \`editor/\`
mount in this deployment.

## Layout

| Path                | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| \`agenticrpg-server\` | The C++20 relay/state-sync server (ADR-005).  |
| \`www/\`             | Portable game package (\`index.html\` + \`data/\` + \`js/\` + \`img/\` + \`audio/\`). |

## Local launcher mode (single player, localhost)

\`\`\`sh
./agenticrpg-server --www-root www --port 8080
# game:   http://localhost:8080/
\`\`\`

## VPS mode (remote multiplayer WebSocket host)

The server binds **0.0.0.0 by default** (\`websocketpp listen(port)\`), so the
same binary is already reachable from the network. Open the server port (8080,
or via \`--port\`) in the firewall, then players join with the relay URL:

\`\`\`sh
./agenticrpg-server --www-root www --port 8080
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
# --log-level <level>      trace|debug|info|warn|error|critical (env AGENTICRPG_LOG_LEVEL)
# --max-players-per-room <n> default 16
\`\`\`

> \`--editor-root\` still exists in the server binary but is **unused**: the Web
> editor (ADR-006) was removed from \`main\` and archived via git tag
> \`archive/editor-0.1.0\` (D20).

## Rebuilding

\`pnpm build:deploy\` in the repo regenerates this folder from source
(www bundle + C++ server binary).
`;
}

main().catch((error) => {
  console.error("[build-deploy] unexpected failure:", error);
  process.exit(1);
});
