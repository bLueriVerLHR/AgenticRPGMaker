/**
 * AgenticRPGMaker — Vertical-slice quest E2E (tasks 18/20/21, D24 acceptance).
 *
 * Serves the prebuilt `www/` folder (the shipped artifact) and walks "The Lost
 * Shipment" end to end in a real browser:
 *
 *   1. boot www → title screen (task 21): Continue disabled on a fresh
 *      profile → New Game → HUD visible, initial map = Riverside Village
 *   2. talk to Elder Rowan → quest started (switch flips via dialogue)
 *   3. North Gate transfer → Old Forest Road (boot loadMap seam, task 17)
 *   4. talk to the patrolling Road Slime → showChoices → answer "Flee past it"
 *      (choice UI + variable write, task 16)
 *   5. Cave Mouth transfer → Whisper Cave (transfer autosave, task 21)
 *   6. reload → title screen (Continue enabled) → Continue restores the cave
 *      session across maps (save on the cave, boot map is the village)
 *   7. find the Sealed Crate → sw_crate_found flips
 *   8. walk back: Cave → Forest → Village (transfers both directions, state
 *      carried across maps)
 *   9. talk to the elder → reward page (+25 gold, sw_quest_done)
 *  10. chapter 2 (task 20): east gate sealed text → elder hook → east
 *      transfer → Riverbank Landing
 *  11. Old Pol: choice "Offer to work it off" → ledger + 20 coin on re-talk,
 *      one-shot guard on third talk
 *  12. patrolling Dock Worker talk (bounded retry, task 19) → west transfer
 *  13. Herbalist Mira: remedy offer (gold gte 10) → buy (gold −10) → owned
 *  14. elder: worked-branch thanks (ferry_choice eq 1), repeated on re-talk
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
    // 1. Boot the shipped www build → title screen (task 21), then New Game.
    await page.goto(BASE_URL, { waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="title-screen"]').count()) > 0, {
      timeoutMs: 10000,
      label: "title screen (boot)",
    });
    const continueDisabled = await page.locator('[data-testid="title-continue"]').isDisabled();
    report(
      "boot www → title (Continue disabled on a fresh profile)",
      continueDisabled ? "PASS" : "FAIL",
    );
    await page.locator('[data-testid="title-new-game"]').click();
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 10000,
      label: "HUD (New Game)",
    });
    await page.mouse.click(360, 280); // focus so keyboard reaches the game
    const mapId = await currentMap(page);
    report(
      "title: New Game → village",
      mapId === "map_quest_village" ? "PASS" : "FAIL",
      `map=${String(mapId)}`,
    );

    // 2. Elder Rowan at (3,4): spawn (1,2) → right right → (3,2), down → (3,3), face down, talk.
    if ((await walkTo(page, "ArrowRight", 2, "3,2", "walk to (3,2)")) === false)
      throw new Error("walk");
    if ((await walkTo(page, "ArrowDown", 1, "3,3", "walk to (3,3)")) === false)
      throw new Error("walk");
    if ((await faceOnly(page, "ArrowDown", "3,3", "face the elder at (3,4)")) === false)
      throw new Error("face");
    // Task 22: the faced interactable is advertised before you press Z.
    const hintBefore = await page.evaluate(
      () => globalThis.window.__game?.scene?.interactionHintEventId ?? null,
    );
    report(
      "interaction hint on the faced elder",
      hintBefore === "evt_elder" ? "PASS" : "FAIL",
      String(hintBefore),
    );
    if ((await talk(page, "autumn shipment", "elder: quest text")) === false) {
      throw new Error("elder talk");
    }
    const hintDuring = await page.evaluate(() => {
      const value = globalThis.window.__game?.scene?.interactionHintEventId;
      return value === undefined ? "unset" : value;
    });
    report(
      "hint suppressed while talking",
      hintDuring === null ? "PASS" : "FAIL",
      String(hintDuring),
    );
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

    // 4. Forest: (6,8) → up up up → (6,5). The Road Slime patrols (5,5)↔(4,5)
    // and — since task 19 — interaction follows its live body, so facing left
    // from (6,5) opens the ask page whenever its body spans (5,5): every
    // instant except the ≤1-tick rest exactly on (4,5). Bounded retry covers it.
    const upToRow5 = await walkTo(page, "ArrowUp", 3, "6,5", "walk to (6,5)");
    if (!upToRow5) throw new Error("walk (slime corridor)");
    let slimeTalked = false;
    let slimeAttempts = 0;
    for (let attempt = 0; attempt < 4 && !slimeTalked; attempt++) {
      slimeAttempts = attempt + 1;
      await page.keyboard.press("ArrowLeft"); // face the corridor (usually a blocked step)
      await sleep(400);
      if ((await hudPosition(page)) !== "6,5") {
        // The slime rested exactly on (4,5) and the step went through; the
        // retreat can never be blocked (its body never spans (6,5)). Step back
        // and retry from the canonical spot.
        await page.keyboard.press("ArrowRight");
        await sleep(400);
        continue;
      }
      await page.keyboard.press("KeyZ");
      try {
        await waitFor(
          async () => {
            const box = page.locator('[data-testid="choice-box"]');
            return (await box.count()) > 0 && (await box.isVisible());
          },
          { timeoutMs: 900, label: `choice box (attempt ${attempt + 1})` },
        );
        slimeTalked = true;
      } catch {
        // No body on the faced tile this instant — retry.
      }
    }
    report(
      "face the patrolling slime (task 19)",
      slimeTalked ? "PASS" : "FAIL",
      `interact attempts: ${slimeAttempts}`,
    );
    try {
      if (!slimeTalked) throw new Error("no attempt opened the choice box");
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

    // 5. East → north via the col-7 leg to the cave mouth. The slime patrols
    // (5,5)↔(4,5), so its body never spans (6,5)/(7,5) — this leg stays clear.
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

    // 5.5. Reload mid-quest (task 21): the cave arrival autosaved, so after a
    // reload the title screen offers Continue — and the save is cross-map
    // (made on the cave, boot map is the village).
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="title-screen"]').count()) > 0, {
      timeoutMs: 10000,
      label: "title screen (reload)",
    });
    const continueEnabled = !(await page.locator('[data-testid="title-continue"]').isDisabled());
    report("reload → title (Continue enabled by autosave)", continueEnabled ? "PASS" : "FAIL");
    await page.locator('[data-testid="title-continue"]').click();
    await waitFor(async () => (await page.locator('[data-testid="hud"]').count()) > 0, {
      timeoutMs: 10000,
      label: "HUD (Continue)",
    });
    await page.mouse.click(360, 280); // re-focus after the overlay is gone
    // The click handler applies the save asynchronously (start → swap →
    // load), so wait for the restored cave session instead of reading once.
    let restoredMap = null;
    let restoredPos = null;
    try {
      await waitFor(
        async () =>
          (await currentMap(page)) === "map_quest_cave" && (await hudPosition(page)) === "6,7",
        { timeoutMs: 8000, label: "cave session restored" },
      );
      restoredMap = "map_quest_cave";
      restoredPos = "6,7";
    } catch {
      restoredMap = await currentMap(page);
      restoredPos = await hudPosition(page);
    }
    report(
      "continue → cave session restored (cross-map)",
      restoredMap === "map_quest_cave" && restoredPos === "6,7" ? "PASS" : "FAIL",
      `map=${String(restoredMap)}, pos=${String(restoredPos)} (expected cave, 6,7)`,
    );

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

    // 8. Exit: back to (6,7), face down at the exit (6,8), transfer → forest (12,2).
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

    // 9. Return: row 2 west, col-7 leg south, then row 5 → col 6 south.
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

    // 10. Reward: (5,2) → left left → (3,2), down → (3,3), talk → reward, then done page.
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

    // 10. Chapter 2 (task 20). The second elder talk now hits the chapter-2
    // hook page, not a thanks page. First: the east gate is still sealed
    // (checked before the hook flips sw_ch2_started).
    if ((await walkTo(page, "ArrowRight", 1, "4,3", "walk to (4,3)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowDown", 1, "4,4", "walk to (4,4)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowRight", 6, "10,4", "walk to (10,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowRight", "10,4", "face the east gate at (11,4)")) === false) {
      throw new Error("face");
    }
    if (
      (await talk(page, "flood wall still seals", "east gate: sealed before chapter 2")) === false
    ) {
      throw new Error("sealed");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);

    // 11. Elder hook: back west along row 4 to (4,4), face the elder, talk.
    if ((await walkTo(page, "ArrowLeft", 6, "4,4", "walk to (4,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowLeft", "4,4", "face the elder at (3,4)")) === false) {
      throw new Error("face");
    }
    if ((await talk(page, "One more errand", "elder: chapter-2 hook (sw_ch2_started)")) === false) {
      throw new Error("hook");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);

    // 12. East transfer: back to (10,4), face the gate, talk → Riverbank.
    if ((await walkTo(page, "ArrowRight", 6, "10,4", "walk to (10,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowRight", "10,4", "face the east gate at (11,4)")) === false) {
      throw new Error("face");
    }
    // Task 22: transfer tiles carry a visible door marker.
    const markers = await page.evaluate(
      () => globalThis.window.__game?.scene?.transferTileEventIds ?? [],
    );
    report(
      "door marker on the east gate",
      Array.isArray(markers) && markers.includes("evt_village_east") ? "PASS" : "FAIL",
      JSON.stringify(markers),
    );
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_river", "transfer: village → river")) === false) {
      throw new Error("transfer");
    }

    // 13. Old Pol at (8,3): row 4 east to (8,4), face up, ask → choices.
    if ((await walkTo(page, "ArrowRight", 7, "8,4", "walk to (8,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowUp", "8,4", "face Old Pol at (8,3)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    try {
      await waitFor(
        async () => {
          const box = page.locator('[data-testid="choice-box"]');
          return (await box.count()) > 0 && (await box.isVisible());
        },
        { timeoutMs: 4000, label: "Pol choice box" },
      );
      report("pol: choice box opens", "PASS", "Demand / Offer");
    } catch (error) {
      report("pol: choice box opens", "FAIL", error.message);
      throw new Error("choice");
    }
    // Answer "Offer to work it off" (index 1): down then confirm.
    await page.keyboard.press("ArrowDown");
    await sleep(150);
    await page.keyboard.press("KeyZ");
    await sleep(200);
    await page.keyboard.press("KeyZ"); // dismiss the ask dialogue
    await sleep(200);

    // 14. Re-talk: the work-branch page pays 20 coin, hands over the ledger
    // and settles the debt (guarded one-shot by sw_debt_settled).
    if ((await talk(page, "take my ledger", "pol: worked off — 20 coin + ledger")) === false) {
      throw new Error("pol pay");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);
    if ((await talk(page, "We're square", "pol: settled guard (paid once)")) === false) {
      throw new Error("pol guard");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);

    // 15. Detour: the patrolling Dock Worker on row 6 — bounded face/interact
    // retry from (6,5) (task-19 pattern, body spans two tiles mid-move).
    if ((await walkTo(page, "ArrowLeft", 2, "6,4", "walk to (6,4)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowDown", 1, "6,5", "walk to (6,5)")) === false) {
      throw new Error("walk");
    }
    let handTalked = false;
    let handAttempts = 0;
    for (let attempt = 0; attempt < 6 && !handTalked; attempt++) {
      handAttempts = attempt + 1;
      await page.keyboard.press("ArrowDown"); // face row 6 (usually blocked)
      await sleep(400);
      if ((await hudPosition(page)) !== "6,5") {
        // The worker rested exactly on (4,6) and the step went through; step
        // back and retry from the canonical spot.
        await page.keyboard.press("ArrowUp");
        await sleep(400);
        continue;
      }
      await page.keyboard.press("KeyZ");
      try {
        await waitFor(
          async () => {
            const box = page.locator('[data-testid="dialogue-box"]');
            if ((await box.count()) === 0 || !(await box.isVisible())) {
              return null;
            }
            const text = (
              await page.locator('[data-testid="dialogue-text"]').textContent()
            )?.trim();
            return text !== undefined && text.includes("Tide's turning") ? text : null;
          },
          { timeoutMs: 900, label: `dock hand talk (attempt ${attempt + 1})` },
        );
        handTalked = true;
      } catch {
        // No body on the faced tile this instant — retry.
      }
    }
    report(
      "face the patrolling dock worker (task 19)",
      handTalked ? "PASS" : "FAIL",
      `interact attempts: ${handAttempts}`,
    );
    if (!handTalked) throw new Error("dock hand");
    await page.keyboard.press("KeyZ"); // dismiss
    await sleep(200);

    // 16. West transfer: row 5 is clear of the patrol — up, then west to (1,4).
    if ((await walkTo(page, "ArrowUp", 1, "6,4", "walk to (6,4)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowLeft", 5, "1,4", "walk to (1,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowLeft", "1,4", "face the west road at (0,4)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    if ((await expectMap(page, "map_quest_village", "transfer: river → village")) === false) {
      throw new Error("transfer");
    }

    // 17. Mira at (9,6): south side of the road (never block the only east
    // lane). (10,4) → down×2 → (10,6), face left. Offer → Buy → owned.
    if ((await walkTo(page, "ArrowDown", 2, "10,6", "walk to (10,6)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowLeft", "10,6", "face Mira at (9,6)")) === false) {
      throw new Error("face");
    }
    await page.keyboard.press("KeyZ");
    try {
      await waitFor(
        async () => {
          const box = page.locator('[data-testid="choice-box"]');
          return (await box.count()) > 0 && (await box.isVisible());
        },
        { timeoutMs: 4000, label: "Mira choice box" },
      );
      report("mira: remedy offer (gold gte 10)", "PASS", "Buy / Not now");
    } catch (error) {
      report("mira: remedy offer (gold gte 10)", "FAIL", error.message);
      throw new Error("choice");
    }
    await page.keyboard.press("KeyZ"); // confirm "Buy the remedy" (index 0)
    await sleep(200);
    await page.keyboard.press("KeyZ"); // dismiss the offer dialogue
    await sleep(200);
    if ((await talk(page, "Pleasure doing business", "mira: purchase (gold −10)")) === false) {
      throw new Error("mira buy");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);
    if ((await talk(page, "pride of Riverside", "mira: owned page")) === false) {
      throw new Error("mira owned");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);

    // 18. Elder close: round Mira via row 7, then up to (4,4), talk — the
    // worked-branch thanks, repeated verbatim on re-talk (first-match).
    if ((await walkTo(page, "ArrowDown", 1, "10,7", "walk to (10,7)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowLeft", 6, "4,7", "walk to (4,7)")) === false) {
      throw new Error("walk");
    }
    if ((await walkTo(page, "ArrowUp", 3, "4,4", "walk to (4,4)")) === false) {
      throw new Error("walk");
    }
    if ((await faceOnly(page, "ArrowLeft", "4,4", "face the elder at (3,4)")) === false) {
      throw new Error("face");
    }
    if (
      (await talk(page, "Millbrook one day", "elder: worked-branch thanks (sw_ch2_done)")) === false
    ) {
      throw new Error("elder close");
    }
    await page.keyboard.press("KeyZ");
    await sleep(200);
    if ((await talk(page, "Millbrook one day", "elder: thanks repeats (first-match)")) === false) {
      throw new Error("elder close repeat");
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
