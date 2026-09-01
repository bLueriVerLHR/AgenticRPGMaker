/**
 * AgenticRPGMaker — Vertical-slice quest E2E (task 18, D24 acceptance).
 *
 * Serves the prebuilt `www/` folder (the shipped artifact) and walks "The Lost
 * Shipment" end to end in a real browser:
 *
 *   1. boot www → HUD visible, initial map = Riverside Village
 *   2. talk to Elder Rowan → quest started (switch flips via dialogue)
 *   3. North Gate transfer → Old Forest Road (boot loadMap seam, task 17)
 *   4. talk to the patrolling Road Slime → showChoices → answer "Flee past it"
 *      (choice UI + variable write, task 16)
 *   5. Cave Mouth transfer → Whisper Cave
 *   6. find the Sealed Crate → sw_crate_found flips
 *   7. walk back: Cave → Forest → Village (transfers both directions, state
 *      carried across maps)
 *   8. talk to the elder → reward page (+25 gold, sw_quest_done), and a second
 *      talk hits the quest-done page (first-match page selection)
 *
 * The www folder must exist (pnpm build:www). If Playwright browsers are not
 * installed the script skips gracefully and reports which steps did not run.
 * Each step is reported individually as PASS / SKIP / FAIL; any FAIL exits 1.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(RUNTIME_DIR, "..", "..");
const WWW_DIR = path.join(REPO_ROOT, "www");
const PORT = 4175;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const results = [];
function report(step, status, detail = "") {
  results.push({ step, status });
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ""}`;
  if (status === "FAIL") {
    console.error(line);
  } else {
    console.log(line);
  }
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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function startStaticServer(root, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** HUD position, e.g. "5,2". */
async function hudPosition(page) {
  const pos = await page.locator('[data-testid="hud-position"]').textContent();
  return pos ? pos.trim() : null;
}

/** Presses `key` up to `times`, then retries until the HUD shows `expected`. */
async function walkTo(page, key, times, expected, label) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await sleep(350);
  }
  try {
    await waitFor(async () => (await hudPosition(page)) === expected, {
      timeoutMs: 4000,
      label: `position ${expected}`,
    });
    report(label, "PASS", `at ${expected}`);
    return true;
  } catch {
    report(label, "FAIL", `expected ${expected}, HUD shows ${String(await hudPosition(page))}`);
    return false;
  }
}

/**
 * A blocked step that only turns the player (target tile solid/event): press
 * once and assert the position did NOT change.
 */
async function faceOnly(page, key, stayPut, label) {
  await page.keyboard.press(key);
  await sleep(400);
  const pos = await hudPosition(page);
  report(label, pos === stayPut ? "PASS" : "FAIL", `still at ${String(pos)}`);
  return pos === stayPut;
}

/** Interact (Z) and wait for the dialogue box to show a line containing `expected`. */
async function talk(page, expected, label) {
  await page.keyboard.press("KeyZ");
  try {
    const text = await waitFor(
      async () => {
        const box = page.locator('[data-testid="dialogue-box"]');
        if ((await box.count()) === 0 || !(await box.isVisible())) {
          return null;
        }
        const t = (await page.locator('[data-testid="dialogue-text"]').textContent())?.trim();
        return t !== undefined && t.includes(expected) ? t : null;
      },
      { timeoutMs: 4000, label: `dialogue "${expected}"` },
    );
    report(label, "PASS", String(text));
    return true;
  } catch (error) {
    report(label, "FAIL", error.message);
    return false;
  }
}

async function currentMap(page) {
  return page.evaluate(() => globalThis.window.__game?.scene?.map?.id ?? null);
}

async function expectMap(page, mapId, label) {
  try {
    await waitFor(async () => (await currentMap(page)) === mapId, {
      timeoutMs: 5000,
      label: `map ${mapId}`,
    });
    report(label, "PASS", mapId);
    return true;
  } catch {
    report(label, "FAIL", `on map ${String(await currentMap(page))}`);
    return false;
  }
}

let browser;
let server;
let exitCode = 0;

async function main() {
  console.log("=== AgenticRPGMaker vertical-slice quest E2E (www) ===");

  if (!existsSync(join(WWW_DIR, "index.html"))) {
    report("www/ exists", "FAIL", "run `pnpm build:www` first");
    exitCode = 1;
    return;
  }
  report("www/ exists", "PASS", "run `pnpm build:www` output found");

  report("start static server", "RUN");
  server = await startStaticServer(WWW_DIR, PORT);
  report("start static server", "PASS", BASE_URL);

  const { chromium } = await import("playwright");
  let context;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 720, height: 560 } });
  } catch (error) {
    report("playwright browser launch", "SKIP", `browsers not installed: ${error.message}`);
    console.log("E2E SKIPPED — Playwright browsers unavailable. Steps below did not run.");
    return;
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`  [pageerror] ${err.message}`));

  try {
    // 1. Boot the shipped www build.
    await page.goto(BASE_URL, { waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 10000,
      label: "HUD (boot)",
    });
    await page.mouse.click(360, 280); // focus so keyboard reaches the game
    const status = (await page.locator('[data-testid="boot-status"]').textContent()) ?? "";
    const mapId = await currentMap(page);
    report(
      "boot www → village",
      mapId === "map_quest_village" && status.includes("Ready") ? "PASS" : "FAIL",
      `status=${status.trim()}, map=${String(mapId)}`,
    );

    // 2. Elder Rowan at (3,4): spawn (1,2) → right right → (3,2), down → (3,3), face down, talk.
    if ((await walkTo(page, "ArrowRight", 2, "3,2", "walk to (3,2)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowDown", 1, "3,3", "walk to (3,3)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowDown", "3,3", "face the elder at (3,4)")) === false)
      throw new Error("face");
    if ((await talk(page, "autumn shipment", "elder: quest text")) === false) {
      throw new Error("elder talk");
    }
    await page.keyboard.press("KeyZ"); // close the quest dialogue
    await sleep(200);

    // 3. North Gate at (5,1): right right → (5,3)... (5,2) then blocked step up, Z transfers.
    if ((await walkTo(page, "ArrowRight", 2, "5,3", "walk to (5,3)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowUp", 1, "5,2", "walk to (5,2)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowUp", "5,2", "face the north gate at (5,1)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_forest", "transfer: village → forest")) === false) {
      throw new Error("transfer");
    }

    // 4. Forest: (6,8) → up up up → (6,5); face left at the slime's tile (5,5);
    // the patrolling slime entity may temporarily block the corridor, so use retries.
    const upToRow5 = await walkTo(page, "ArrowUp", 3, "6,5", "walk to (6,5)");
    if (!upToRow5) throw new Error("walk (slime corridor)");
    if ((await faceOnly(page, "ArrowLeft", "6,5", "face the slime at (5,5)")) === false) {
      throw new Error("face");
    }
    // Ask → choice box opens (task 16 UI).
    await page.keyboard.press("KeyZ");
    try {
      await waitFor(
        async () => {
          const box = page.locator('[data-testid="choice-box"]');
          return (await box.count()) > 0 && (await box.isVisible());
        },
        { timeoutMs: 4000, label: "choice box" },
      );
      const optionCount = await page.locator('[data-testid="choice-option"]').count();
      report(
        "slime: choice box opens",
        optionCount === 2 ? "PASS" : "FAIL",
        `${optionCount} options`,
      );
    } catch (error) {
      report("slime: choice box opens", "FAIL", error.message);
      throw new Error("choice");
    }
    // Answer "Flee past it" (index 1): down then confirm; movement is frozen while open.
    await page.keyboard.press("ArrowDown");
    await sleep(150);
    await page.keyboard.press("KeyZ");
    await sleep(200);
    const choiceClosed = !(await page
      .locator('[data-testid="choice-box"]')
      .isVisible()
      .catch(() => false));
    report("slime: answer recorded (box closed)", choiceClosed ? "PASS" : "FAIL");
    await page.keyboard.press("KeyZ"); // dismiss the ask dialogue
    await sleep(200);

    // 5. East → north via the col-7 leg (the slime's registered tile (5,5) is a
    // permanent event collider, so the corridor bypasses it) to the cave mouth.
    if ((await walkTo(page, "ArrowRight", 1, "7,5", "walk to (7,5)")) === false) {
      throw new Error("walk (slime corridor)");
    }
    if ((await walkTo(page, "ArrowUp", 3, "7,2", "walk to (7,2)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowRight", 5, "12,2", "walk to (12,2)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowUp", "12,2", "face the cave mouth at (12,1)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_cave", "transfer: forest → cave")) === false) {
      throw new Error("transfer");
    }

    // 6. Crate at (3,2): (6,7) → up×4 → (6,3) → left×3 → (3,3), face up, talk.
    if ((await walkTo(page, "ArrowUp", 4, "6,3", "walk to (6,3)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowLeft", 3, "3,3", "walk to (3,3)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowUp", "3,3", "face the crate at (3,2)")) === false)
      throw new Error("face");
    if (
      (await talk(
        page,
        "Here! The elder's missing shipment, stamp still fresh — sealed and safe.",
        "crate: shipment found (sw_crate_found)",
      )) === false
    ) {
      throw new Error("crate");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);

    // 7. Exit: back to (6,7), face down at the exit (6,8), transfer → forest (12,2).
    if ((await walkTo(page, "ArrowRight", 3, "6,3", "walk to (6,3)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowDown", 4, "6,7", "walk to (6,7)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowDown", "6,7", "face the cave exit at (6,8)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_forest", "transfer: cave → forest")) === false) {
      throw new Error("transfer");
    }

    // 8. Return: row 2 west, col-7 leg south, then row 5 → col 6 south.
    if ((await walkTo(page, "ArrowLeft", 5, "7,2", "walk to (7,2)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowDown", 3, "7,5", "walk to (7,5)")) === false) {
      throw new Error("walk (return corridor)");
    }
    if ((await walkTo(page, "ArrowLeft", 1, "6,5", "walk to (6,5)")) === false) {
      throw new Error("walk (return corridor)");
    }
    if ((await walkTo(page, "ArrowDown", 3, "6,8", "walk to (6,8)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowDown", "6,8", "face the road south at (6,9)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_village", "transfer: forest → village")) === false) {
      throw new Error("transfer");
    }

    // 9. Reward: (5,2) → left left → (3,2), down → (3,3), talk → reward, then done page.
    if ((await walkTo(page, "ArrowLeft", 2, "3,2", "walk to (3,2)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowDown", 1, "3,3", "walk to (3,3)")) === false)
      throw new Error("walk");
    if (
      (await talk(
        page,
        "The shipment! Sealed and sound — you have my thanks, and the village's coin.",
        "elder: reward (+25 gold, sw_quest_done)",
      )) === false
    ) {
      throw new Error("reward");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);
    if (
      (await talk(
        page,
        "Rest now, courier. Riverside owes you a debt.",
        "elder: quest-done page",
      )) === false
    ) {
      throw new Error("done page");
    }
  } catch (error) {
    exitCode = 1;
    console.error(`[quest-e2e] aborted: ${error.message}`);
  } finally {
    const failed = results.filter((r) => r.status === "FAIL").length;
    const skipped = results.filter((r) => r.status === "SKIP").length;
    console.log(
      `E2E done: ${results.length - failed - skipped} pass, ${failed} fail, ${skipped} skipped`,
    );
    if (failed > 0) {
      exitCode = 1;
    }
    await browser?.close();
    server?.close();
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
