/**
 * AgenticRPGMaker — two-context multiplayer smoke test (P4 gate,
 * docs/07-mvp-plan.md §3.4/§6 + docs/06-architecture.md §9 E2E row).
 *
 * Exercises the real C++ relay server with a real browser:
 *
 *   1. build the runtime demo harness (vite bundles runtime/core/renderer)
 *   2. start vite preview (serves the demo page to both contexts)
 *   3. build (or reuse) the C++ `agenticrpg-server` and launch it on a test
 *      port with a stub www root
 *   4. open TWO Playwright contexts, both load the demo with
 *      `?server=ws://127.0.0.1:<port>/ws&room=qa-smoke&name=A|B`
 *   5. wait for BOTH to complete the handshake (`network.connected`)
 *   6. player A walks right; poll player B's `network.remotePlayers` and
 *      assert B sees A's new position
 *   7. close both contexts (leave) and stop the server + preview
 *
 * Skip policy (matches the other e2e runners): if Playwright browsers are not
 * installed the script SKIPS gracefully and exits 0, reporting exactly which
 * steps ran vs skipped. A server that cannot be built/launched is a hard FAIL
 * (the smoke test is the P3/P4 gate for the C++ server — a missing browser is
 * an environment gap, a missing server binary is a real defect).
 *
 * Env overrides:
 *   AGENTICRPG_SERVER_BIN  — path to a prebuilt agenticrpg-server
 *   AGENTICRPG_CMAKE       — cmake binary to use if the server must be built
 *   AGENTICRPG_SMOKE_PORT  — server test port (default 18099)
 *   AGENTICRPG_SMOKE_PREVIEW_PORT — demo preview port (default 4175)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(RUNTIME_DIR, "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const P0_CMAKE = path.join(
  REPO_ROOT,
  "work",
  "p0",
  ".tools",
  "cmake-3.31.6-linux-x86_64",
  "bin",
  "cmake",
);

const SERVER_PORT = Number(process.env.AGENTICRPG_SMOKE_PORT ?? 18099);
const PREVIEW_PORT = Number(process.env.AGENTICRPG_SMOKE_PREVIEW_PORT ?? 4175);
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}/ws`;
const ROOM = "qa-smoke";
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/?server=${encodeURIComponent(WS_URL)}&room=${ROOM}&name=`;

const results = [];
function report(step, status, detail = "") {
  results.push({ step, status, detail });
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ""}`;
  if (status === "FAIL") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function fail(step, error) {
  report(step, "FAIL", error instanceof Error ? error.message : String(error));
}

function runSync(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: false });
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      console.error(`  [spawn error] ${cmd} ${args.join(" ")}: ${err.message}`);
      resolve(1);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 10000, intervalMs = 100, label = "condition" } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) {
      return last;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last)})`);
}

/** Detect the cmake binary: env → p0 self-hosted → PATH. */
function resolveCmake() {
  if (process.env.AGENTICRPG_CMAKE) {
    return process.env.AGENTICRPG_CMAKE;
  }
  if (fs.existsSync(P0_CMAKE)) {
    return P0_CMAKE;
  }
  return "cmake"; // let PATH resolve it; spawn error is reported if missing
}

/** Build (or reuse) the C++ server binary; returns its path or null. */
async function ensureServerBinary() {
  const envBin = process.env.AGENTICRPG_SERVER_BIN;
  if (envBin && fs.existsSync(envBin)) {
    report("server binary", "PASS", `reused AGENTICRPG_SERVER_BIN=${envBin}`);
    return envBin;
  }
  const candidates = [path.join(SERVER_DIR, "build", "agenticrpg-server")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      report("server binary", "PASS", `reused ${candidate}`);
      return candidate;
    }
  }
  report("build server (cmake configure + build)", "RUN");
  const cmake = resolveCmake();
  const buildDir = path.join(SERVER_DIR, "build");
  const configure = await runSync(
    cmake,
    ["-B", buildDir, "-DCMAKE_BUILD_TYPE=Release"],
    SERVER_DIR,
  );
  if (configure !== 0) {
    fail("build server (cmake configure)", new Error(`cmake configure failed (${cmake})`));
    return null;
  }
  const build = await runSync(cmake, ["--build", buildDir, "-j", "4"], SERVER_DIR);
  if (build !== 0) {
    fail("build server (cmake build)", new Error("cmake build failed"));
    return null;
  }
  report("build server (cmake configure + build)", "PASS");
  return path.join(buildDir, "agenticrpg-server");
}

/** Read the player's tile position from the HUD (e.g. "5,2"). */
async function hudPosition(page) {
  const pos = await page.locator('[data-testid="hud-position"]').textContent();
  return pos ? pos.trim() : null;
}

/** Read network state from the running game (connected + remote target pos). */
async function gameNetwork(page) {
  return page.evaluate(() => {
    // `window` here is the page's browser global (eslint: node globals only).
    const game = globalThis.__game;
    if (game === undefined || game.network === null) {
      return { connected: false, remotes: [] };
    }
    const remotes = [...game.network.remotePlayers.values()].map((p) => ({
      sessionId: p.sessionId,
      name: p.playerName,
      targetX: p.targetX,
      targetY: p.targetY,
      x: p.x,
      y: p.y,
    }));
    return { connected: game.network.connected, remotes };
  });
}

function makeServerArgs(serverBin, stubRoot) {
  return [
    serverBin,
    "--port",
    String(SERVER_PORT),
    "--www-root",
    stubRoot,
    "--editor-root",
    stubRoot,
    "--log-level",
    "info",
    "--max-players-per-room",
    "16",
  ];
}

let browser;
let serverProc;
let previewProc;
let stubDir;
let contextA;
let contextB;
let exitCode = 0;

async function main() {
  console.log("=== AgenticRPGMaker multiplayer smoke test (two contexts) ===");

  // ------------------------------------------------------------ stub www root
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenticrpg-www-"));
  fs.writeFileSync(
    path.join(stubDir, "index.html"),
    "<!doctype html><html><head><title>stub</title></head><body>stub www</body></html>",
  );

  // ------------------------------------------------------------ build demo
  report("build runtime demo (vite build)", "RUN");
  const buildCode = await runSync(
    "npx",
    ["vite", "build", "--config", "demo/vite.config.ts"],
    RUNTIME_DIR,
  );
  if (buildCode !== 0) {
    fail("build runtime demo (vite build)", new Error("vite build failed"));
    return;
  }
  report("build runtime demo (vite build)", "PASS");

  // ------------------------------------------------------------ start preview
  report("start demo preview server", "RUN");
  previewProc = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "vite",
      "preview",
      "--config",
      "demo/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(PREVIEW_PORT),
      "--strictPort",
    ],
    { cwd: RUNTIME_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${PREVIEW_URL}A`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, intervalMs: 250, label: "preview server ready" },
  ).catch((error) => {
    fail("start demo preview server", error);
    return Promise.reject(error);
  });
  report("start demo preview server", "PASS", `http://127.0.0.1:${PREVIEW_PORT}`);

  // ------------------------------------------------------------ start C++ server
  const serverBin = await ensureServerBinary();
  if (serverBin === null) {
    return; // failure already reported
  }
  report("start agenticrpg-server", "RUN");
  const serverArgs = makeServerArgs(serverBin, stubDir);
  serverProc = spawn(serverArgs[0], serverArgs.slice(1), {
    cwd: SERVER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, intervalMs: 250, label: "agenticrpg-server ready" },
  ).catch((error) => {
    fail("start agenticrpg-server", error);
    return Promise.reject(error);
  });
  report("start agenticrpg-server", "PASS", `ws://127.0.0.1:${SERVER_PORT}/ws`);

  // ------------------------------------------------------------ playwright
  const { chromium } = await import("playwright");
  try {
    browser = await chromium.launch();
    contextA = await browser.newContext({ viewport: { width: 720, height: 560 } });
    contextB = await browser.newContext({ viewport: { width: 720, height: 560 } });
  } catch (error) {
    report("playwright browser launch", "SKIP", `browsers not installed: ${error.message}`);
    console.log("MULTIPLAYER SMOKE SKIPPED — Playwright browsers unavailable. Steps did not run.");
    return;
  }

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pageA.on("pageerror", (err) => console.error(`  [pageA pageerror] ${err.message}`));
  pageB.on("pageerror", (err) => console.error(`  [pageB pageerror] ${err.message}`));

  try {
    // 1. Both contexts boot the demo and join the same room.
    report("boot two contexts into room", "RUN");
    await pageA.goto(`${PREVIEW_URL}A`, { waitUntil: "load" });
    await pageB.goto(`${PREVIEW_URL}B`, { waitUntil: "load" });
    const [netA, netB] = await Promise.all([
      waitFor(async () => (await gameNetwork(pageA)).connected, {
        timeoutMs: 15000,
        label: "context A connected",
      }),
      waitFor(async () => (await gameNetwork(pageB)).connected, {
        timeoutMs: 15000,
        label: "context B connected",
      }),
    ]);
    report(
      "boot two contexts into room",
      netA === true && netB === true ? "PASS" : "FAIL",
      "both handshakes complete",
    );

    // 2. Each sees the other as a remote player.
    report("cross-visibility (A sees B, B sees A)", "RUN");
    await Promise.all([
      waitFor(async () => (await gameNetwork(pageA)).remotes.length === 1, {
        timeoutMs: 10000,
        label: "A sees B",
      }),
      waitFor(async () => (await gameNetwork(pageB)).remotes.length === 1, {
        timeoutMs: 10000,
        label: "B sees A",
      }),
    ]);
    report(
      "cross-visibility (A sees B, B sees A)",
      "PASS",
      "each context has exactly 1 remote player",
    );

    // 3. Move A right twice (1,2) → (3,2); B must observe A's new position.
    report("move A, observe in B", "RUN");
    const startPos = await hudPosition(pageA);
    for (let i = 0; i < 2; i++) {
      await pageA.keyboard.press("ArrowRight");
      await sleep(400);
    }
    const aPos = await hudPosition(pageA);
    const remoteSeen = await waitFor(
      async () => {
        const { remotes } = await gameNetwork(pageB);
        return remotes.find((r) => r.x >= parseFloat(aPos.split(",")[0]) - 0.25) ?? null;
      },
      { timeoutMs: 10000, label: `B sees A at ${aPos}` },
    ).catch(() => null);
    report(
      "move A, observe in B",
      remoteSeen !== null ? "PASS" : "FAIL",
      `A moved ${startPos} → ${aPos}; B sees target (${remoteSeen?.targetX},${remoteSeen?.targetY})`,
    );
  } catch (error) {
    fail("multiplayer smoke scenario", error);
  } finally {
    await contextA?.close();
    await contextB?.close();
    await browser?.close();
  }

  // ------------------------------------------------------------ report
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  console.log("---");
  console.log(
    `Multiplayer smoke results: ${results.length} steps, ${failed.length} failed, ${skipped.length} skipped`,
  );
  if (failed.length > 0) {
    exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Multiplayer smoke runner failed:", error);
    exitCode = 1;
  })
  .finally(() => {
    if (contextA) contextA.close().catch(() => {});
    if (contextB) contextB.close().catch(() => {});
    if (browser) browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
    if (previewProc && !previewProc.killed) previewProc.kill("SIGTERM");
    if (stubDir) {
      try {
        fs.rmSync(stubDir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
    // Explicitly exit after cleanup; the C++ server needs a moment to bind-free.
    setTimeout(() => process.exit(exitCode), 100);
  });
