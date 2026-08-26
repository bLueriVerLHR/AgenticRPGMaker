/**
 * AgenticRPGMaker runtime — Playwright E2E (P1c gate, docs/07-mvp-plan.md §3.4).
 *
 * Boots the game in a real browser against the demo harness and walks the
 * mandatory single-player scenario:
 *
 *   1. boot → HUD visible (backend + player position)
 *   2. walk (keyboard) → position advances tile by tile
 *   3. collide with a wall → movement stops (position unchanged)
 *   4. collide with a solid NPC → movement stops
 *   5. trigger dialogue → text appears
 *   6. advance/close the dialogue
 *   7. save → reload the page → state restored (position + switch)
 *
 * The server (vite preview of the demo build) is started and stopped by this
 * script. If Playwright browsers are not installed the script skips
 * gracefully and reports exactly which steps ran vs skipped (per the P1c task
 * constraint). Each step is reported individually as PASS / SKIP / FAIL.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(__dirname, "..");
const PREVIEW_PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

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

async function waitFor(fn, { timeoutMs = 8000, intervalMs = 60, label = "condition" } = {}) {
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

/** Read the player position from the HUD (e.g. "5,2"). */
async function hudPosition(page) {
  const pos = await page.locator('[data-testid="hud-position"]').textContent();
  return pos ? pos.trim() : null;
}

let browser;
let server;
let exitCode = 0;

async function main() {
  // ------------------------------------------------------------------ setup
  console.log("=== AgenticRPGMaker runtime E2E ===");

  // Build the demo harness (vite bundles the runtime/core/renderer from source).
  report("build demo harness (vite build)", "RUN");
  const buildCode = await runSync(
    "npx",
    ["vite", "build", "--config", "demo/vite.config.ts"],
    RUNTIME_DIR,
  );
  if (buildCode !== 0) {
    fail("build demo harness", new Error("vite build failed"));
    return;
  }
  report("build demo harness (vite build)", "PASS");

  // Start vite preview.
  report("start vite preview server", "RUN");
  const { chromium } = await import("playwright");
  server = spawn(
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
        const res = await fetch(`${BASE_URL}/`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, intervalMs: 250, label: "preview server ready" },
  ).catch((error) => {
    fail("start vite preview server", error);
    return Promise.reject(error);
  });
  report("start vite preview server", "PASS", BASE_URL);

  // ------------------------------------------------------------------ run
  let context;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 720, height: 560 } });
  } catch (error) {
    report("playwright browser launch", "SKIP", `browsers not installed: ${error.message}`);
    // Graceful skip: the unit/integration suites already cover the logic.
    console.log("E2E SKIPPED — Playwright browsers unavailable. Steps below did not run.");
    return;
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => {
    console.error(`  [pageerror] ${err.message}`);
  });

  try {
    // 1. Boot.
    await page.goto(BASE_URL, { waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 10000,
      label: "HUD (boot)",
    });
    // Focus the page so keyboard events reach the game.
    await page.mouse.click(360, 280);
    const backend = (await page.locator('[data-testid="hud-backend"]').textContent())?.trim();
    const startPos = await hudPosition(page);
    report("boot game (HUD visible)", "PASS", `backend=${backend}, start=${startPos}`);

    // 2. Walk right from (1,2) → 5 presses → (5,2), blocked by the NPC at (6,2).
    report("walk: 5 steps right", "RUN");
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(350);
    }
    const afterWalk = await hudPosition(page);
    report(
      "walk: 5 steps right",
      afterWalk === "5,2" ? "PASS" : "FAIL",
      `expected 5,2 got ${afterWalk}`,
    );

    // 3. Collide with the wall (row y=4): down to (5,3), then down is blocked.
    report("collide with wall", "RUN");
    await page.keyboard.press("ArrowDown");
    await sleep(350);
    await page.keyboard.press("ArrowDown");
    await sleep(350);
    const afterWall = await hudPosition(page);
    report(
      "collide with wall",
      afterWall === "5,3" ? "PASS" : "FAIL",
      `expected 5,3 got ${afterWall}`,
    );

    // 4. Collide with a solid NPC: back up to (5,2), try right → blocked at (6,2).
    report("collide with NPC", "RUN");
    await page.keyboard.press("ArrowUp");
    await sleep(350);
    await page.keyboard.press("ArrowRight");
    await sleep(350);
    const afterNpc = await hudPosition(page);
    report(
      "collide with NPC",
      afterNpc === "5,2" ? "PASS" : "FAIL",
      `expected 5,2 got ${afterNpc}`,
    );

    // 5. Trigger dialogue (Z facing the innkeeper at (6,2)).
    report("trigger dialogue", "RUN");
    await page.keyboard.press("KeyZ");
    const dialogue = await waitFor(
      async () => {
        const box = page.locator('[data-testid="dialogue-box"]');
        if ((await box.count()) === 0) {
          return null;
        }
        const visible = await box.isVisible();
        if (!visible) {
          return null;
        }
        return (await page.locator('[data-testid="dialogue-text"]').textContent())?.trim() ?? null;
      },
      { timeoutMs: 3000, label: "dialogue text" },
    ).catch(() => null);
    report(
      "trigger dialogue",
      dialogue === "Hello, traveler!" ? "PASS" : "FAIL",
      `expected "Hello, traveler!" got ${String(dialogue)}`,
    );

    // 6. Advance and close the dialogue.
    report("advance/close dialogue", "RUN");
    await page.keyboard.press("KeyZ");
    await sleep(200);
    const stillVisible = await page.locator('[data-testid="dialogue-box"]').isVisible();
    report("advance/close dialogue", stillVisible ? "FAIL" : "PASS", "dialogue closed");

    // 7. Walk to a distinct position (3,2) and save; reload restores it.
    report("walk to (3,2) and save", "RUN");
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("ArrowLeft");
      await sleep(350);
    }
    const savedPos = await waitFor(async () => (await hudPosition(page)) === "3,2", {
      timeoutMs: 3000,
      label: "position 3,2",
    })
      .then(() => "3,2")
      .catch(() => hudPosition(page));
    await page.keyboard.press("F5");
    await waitFor(
      async () => {
        const toast = await page.locator('[data-testid="save-toast"]').textContent();
        return toast?.includes("saved") ?? false;
      },
      { timeoutMs: 3000, label: "save toast" },
    ).catch(() => {});
    report(
      "walk to (3,2) and save",
      savedPos === "3,2" ? "PASS" : "FAIL",
      `saved at ${String(savedPos)}`,
    );

    report("reload → restore state", "RUN");
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 10000,
      label: "HUD after reload",
    });
    const restored = await hudPosition(page);
    report(
      "reload → restore state",
      restored === "3,2" ? "PASS" : "FAIL",
      `expected 3,2 got ${restored}`,
    );

    // 8. Switch state restored: walk right to (5,2), talk to the innkeeper → v2.
    report("switch state restored (dialogue v2)", "RUN");
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(350);
    }
    await waitFor(async () => (await hudPosition(page)) === "5,2", {
      timeoutMs: 3000,
      label: "position 5,2",
    }).catch(() => {});
    await page.keyboard.press("KeyZ");
    const dialogue2 = await waitFor(
      async () => {
        const box = page.locator('[data-testid="dialogue-box"]');
        if ((await box.count()) === 0 || !(await box.isVisible())) {
          return null;
        }
        return (await page.locator('[data-testid="dialogue-text"]').textContent())?.trim() ?? null;
      },
      { timeoutMs: 3000, label: "dialogue v2 text" },
    ).catch(() => null);
    report(
      "switch state restored (dialogue v2)",
      dialogue2 === "Welcome back, traveler!" ? "PASS" : "FAIL",
      `expected "Welcome back, traveler!" got ${String(dialogue2)}`,
    );
  } catch (error) {
    fail("E2E scenario", error);
  } finally {
    await browser?.close();
  }

  // ------------------------------------------------------------------ report
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  console.log("---");
  console.log(
    `E2E results: ${results.length} steps, ${failed.length} failed, ${skipped.length} skipped`,
  );
  if (failed.length > 0) {
    exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("E2E runner failed:", error);
    exitCode = 1;
  })
  .finally(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
    process.exit(exitCode);
  });
