/**
 * AgenticRPGMaker editor — Playwright E2E (P2 gate, docs/07-mvp-plan.md §4).
 *
 * Drives the real editor UI in a browser against a vite preview build and
 * walks the mandatory P2 scenario:
 *
 *   1. boot → project list screen
 *   2. create a project → editor screen with the default map
 *   3. paint tiles (palette → click/drag on the canvas) → the core model
 *      changes (asserted via window.__editor, the single source of truth)
 *   4. place an event (event tool → click) → event panel shows it
 *   5. add a command to the event page via the command editor
 *   6. save (autosave debounce) → reload → re-open the project → map + event
 *      persisted (IndexedDB)
 *   7. run the embedded runtime preview (Play) → the runtime HUD appears over
 *      the same core model; Stop disposes it
 *
 * If Playwright browsers are not installed the script skips gracefully and
 * reports exactly which steps ran vs skipped (per the P2 task constraint).
 * Each step is reported individually as PASS / SKIP / FAIL.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(__dirname, "..");
const PREVIEW_PORT = 4174;
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

/** Read the editor store state from window.__editor (or null). */
async function editorState(page) {
  return page.evaluate(() => {
    // `window` here is the page's browser global (eslint: node globals only).
    const ed = globalThis.__editor;
    if (ed === undefined || ed.store === null) {
      return null;
    }
    const snapshot = ed.store.getSnapshot();
    return {
      projectName: snapshot.projectName,
      currentMapId: snapshot.currentMapId,
      maps: snapshot.maps,
      tool: snapshot.tool,
    };
  });
}

let browser;
let server;
let exitCode = 0;

async function main() {
  console.log("=== AgenticRPGMaker editor E2E ===");

  // ------------------------------------------------------------------ setup
  report("build editor (vite build)", "RUN");
  const buildCode = await runSync("npx", ["vite", "build"], EDITOR_DIR);
  if (buildCode !== 0) {
    fail("build editor (vite build)", new Error("vite build failed"));
    return;
  }
  report("build editor (vite build)", "PASS");

  report("start vite preview server", "RUN");
  const { chromium } = await import("playwright");
  server = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    { cwd: EDITOR_DIR, stdio: ["ignore", "pipe", "pipe"] },
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
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  } catch (error) {
    report("playwright browser launch", "SKIP", `browsers not installed: ${error.message}`);
    console.log("E2E SKIPPED — Playwright browsers unavailable. Steps below did not run.");
    return;
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => {
    console.error(`  [pageerror] ${err.message}`);
  });

  try {
    // 1. Boot → project list.
    await page.goto(BASE_URL, { waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="project-list"]').count()) > 0, {
      timeoutMs: 10000,
      label: "project list",
    });
    report("boot editor (project list)", "PASS");

    // 2. Create a project.
    report("create project", "RUN");
    await page.fill('[data-testid="new-project-name"]', "E2E Game");
    await page.click('[data-testid="new-project-create"]');
    await waitFor(async () => (await page.locator('[data-testid="app-editor"]').count()) > 0, {
      timeoutMs: 10000,
      label: "editor screen",
    });
    const nameText = (await page.locator('[data-testid="project-name"]').textContent()) ?? "";
    report("create project", nameText === "E2E Game" ? "PASS" : "FAIL", `project name=${nameText}`);

    // 3. Paint tiles on the ground layer.
    report("paint tiles", "RUN");
    await page.click('[data-testid="tool-paint"]');
    await page.click('[data-testid="palette-tile-5"]');
    const canvas = page.locator('[data-testid="map-canvas"]');
    const box = await canvas.boundingBox();
    if (box === null) {
      fail("paint tiles", new Error("map canvas has no bounding box"));
    } else {
      // Click three cells (1,1), (2,1), (3,2). Map: 16x12 tiles, tileSize 16, SCALE 2.
      const cellPx = 16 * 2;
      await page.mouse.click(box.x + 1.5 * cellPx, box.y + 1.5 * cellPx);
      await page.mouse.click(box.x + 2.5 * cellPx, box.y + 1.5 * cellPx);
      await page.mouse.click(box.x + 3.5 * cellPx, box.y + 2.5 * cellPx);
      await sleep(150);
      const state = await editorState(page);
      const ground = state?.maps[0]?.layers.find((l) => l.name === "Ground");
      const painted = [ground?.data?.[1]?.[1], ground?.data?.[1]?.[2], ground?.data?.[2]?.[3]];
      report(
        "paint tiles",
        painted.every((v) => v === 5) ? "PASS" : "FAIL",
        `painted cells = ${JSON.stringify(painted)} (expected [5,5,5])`,
      );
    }

    // 4. Undo then redo the last paint (undo/redo across the command stack).
    report("undo/redo paint", "RUN");
    await page.click('[data-testid="toolbar-undo"]');
    await sleep(100);
    let groundAfterUndo = (await editorState(page))?.maps[0]?.layers.find(
      (l) => l.name === "Ground",
    );
    const cellAfterUndo = groundAfterUndo?.data?.[2]?.[3];
    await page.click('[data-testid="toolbar-redo"]');
    await sleep(100);
    const groundAfterRedo = (await editorState(page))?.maps[0]?.layers.find(
      (l) => l.name === "Ground",
    );
    const cellAfterRedo = groundAfterRedo?.data?.[2]?.[3];
    report(
      "undo/redo paint",
      cellAfterUndo === 0 && cellAfterRedo === 5 ? "PASS" : "FAIL",
      `after undo=${cellAfterUndo}, after redo=${cellAfterRedo}`,
    );

    // 5. Place an event at (8,3) with the event tool.
    report("place event", "RUN");
    await page.click('[data-testid="tool-event"]');
    const cx = box === null ? 0 : box.x + 8.5 * 32;
    const cy = box === null ? 0 : box.y + 3.5 * 32;
    await page.mouse.click(cx, cy);
    await sleep(150);
    let state2 = await editorState(page);
    const eventCount = state2?.maps[0]?.events.length ?? 0;
    report("place event", eventCount === 1 ? "PASS" : "FAIL", `events=${eventCount}`);

    // 6. Add a command to the event page (showText).
    report("add event command", "RUN");
    await page.click('[data-testid="tab-event"]');
    await waitFor(async () => (await page.locator('[data-testid="event-panel"]').count()) > 0, {
      timeoutMs: 3000,
      label: "event panel",
    });
    await page.click('[data-testid="cmd-add-showText"]');
    await page.click('[data-testid="command-edit-0"]');
    await page.fill('[data-testid="command-arg-text"]', "Hello from E2E!");
    const state3 = await editorState(page);
    const cmd = state3?.maps[0]?.events[0]?.pages[0]?.commands[0];
    report(
      "add event command",
      cmd?.cmd === "showText" && cmd?.args?.[0] === "Hello from E2E!" ? "PASS" : "FAIL",
      `command=${JSON.stringify(cmd)}`,
    );

    // 7. Wait for the autosave debounce (500ms), then reload and re-open.
    report("autosave + reload persistence", "RUN");
    await sleep(900);
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="project-list"]').count()) > 0, {
      timeoutMs: 10000,
      label: "project list after reload",
    });
    await page.click('[data-testid^="project-row-"]');
    await waitFor(async () => (await page.locator('[data-testid="app-editor"]').count()) > 0, {
      timeoutMs: 10000,
      label: "editor screen after re-open",
    });
    const persisted = await editorState(page);
    const groundPersisted = persisted?.maps[0]?.layers.find((l) => l.name === "Ground");
    const tilePersisted = groundPersisted?.data?.[2]?.[3];
    const eventPersisted = persisted?.maps[0]?.events[0];
    report(
      "autosave + reload persistence",
      tilePersisted === 5 &&
        eventPersisted?.pages?.[0]?.commands?.[0]?.args?.[0] === "Hello from E2E!"
        ? "PASS"
        : "FAIL",
      `tile=${tilePersisted}, event=${JSON.stringify(eventPersisted?.pages?.[0]?.commands)}`,
    );

    // 8. Run the embedded runtime preview over the same map.
    report("run preview (embedded runtime)", "RUN");
    await page.click('[data-testid="preview-toggle"]');
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 15000,
      label: "runtime HUD (preview booted)",
    });
    const hudBackend = (await page.locator('[data-testid="hud-backend"]').textContent())?.trim();
    const previewStatus = (
      await page.locator('[data-testid="preview-status"]').textContent()
    )?.trim();
    report(
      "run preview (embedded runtime)",
      "PASS",
      `backend=${hudBackend}, status=${previewStatus}`,
    );

    // 9. Stop preview.
    report("stop preview", "RUN");
    await page.click('[data-testid="preview-toggle"]');
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) === 0, {
      timeoutMs: 5000,
      label: "runtime HUD removed (preview stopped)",
    });
    report("stop preview", "PASS");
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
