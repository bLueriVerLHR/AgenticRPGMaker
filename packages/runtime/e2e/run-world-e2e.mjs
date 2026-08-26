/**
 * AgenticRPGMaker — open-world golden-path E2E (ADR-008 §1, S5b).
 *
 * Drives the real "The Crossroads" world demo through Playwright and asserts
 * the acceptance golden path:
 *
 *   1. boot → title screen; press → opening CG → skip → village HUD (spawn)
 *   2. open the village chest (+50 gold) and talk to the elder
 *   3. walk north across the chunk boundary into the wilds (seamless)
 *   4. defeat the two wilds slimes → sw_wilds_cleared
 *   5. reach the fortress, the guard now admits passage (dialogue branch)
 *   6. defeat the turret sentinel → sw_boss_defeated (F5 checkpoint + F9
 *      retry if the player dies — death no longer loses progress)
 *   7. light the beacon → ending CG ("THE END")
 *   8. F5 → reload → re-enter (no intro replay) → state persisted
 *
 * Every step is reported PASS/FAIL; a failure exits non-zero (the QA gate).
 * Robustness helpers walk by polling the HUD position and poll the scene
 * state via globalThis.__game instead of trusting fixed timings.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(__dirname, "..");
const PORT = 4181;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function report(step, status, detail = "") {
  results.push({ step, status, detail });
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ""}`;
  if (status === "FAIL") console.error(line);
  else console.log(line);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 12000, intervalMs = 80, label = "condition" } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last)})`);
}

let browser;
let server;
let exitCode = 0;

async function main() {
  console.log("=== AgenticRPGMaker world golden-path E2E ===");

  report("build world-demo", "RUN");
  const buildCode = await runSync(
    "npx",
    ["vite", "build", "--config", "world-demo/vite.config.ts"],
    RUNTIME_DIR,
  );
  if (buildCode !== 0) {
    fail("build world-demo", new Error("vite build failed"));
    process.exit(1);
  }
  report("build world-demo", "PASS");

  report("start vite preview", "RUN");
  const { chromium } = await import("playwright");
  server = spawn(
    "npx",
    [
      "vite",
      "preview",
      "--config",
      "world-demo/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: RUNTIME_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${BASE}/`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, label: "preview ready" },
  ).catch((error) => {
    fail("start vite preview", error);
    process.exit(1);
  });
  report("start vite preview", "PASS", BASE);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on("pageerror", (err) => console.error(`  [pageerror] ${err.message}`));

  // ------------------------------------------------------------------ helpers
  const game = () =>
    page.evaluate(() => {
      const g = globalThis.__game;
      if (!g?.scene) return null;
      return {
        scene: g.scene.id,
        pos: { x: g.scene.playerPosition.x, y: g.scene.playerPosition.y },
        hp: g.scene.playerHp,
        dead: g.scene.isDead,
        ready: g.scene.isReady,
        gold: g.scene.getVariable("gold"),
        swWilds: g.scene.getSwitch("sw_wilds_cleared"),
        swBoss: g.scene.getSwitch("sw_boss_defeated"),
        combatants: g.scene.combatSystem.views().map((c) => c.docId),
      };
    });
  const hudGold = async () =>
    page
      .locator('[data-testid="hud-gold"]')
      .textContent()
      .then((t) => t ?? "")
      .catch(() => "");
  const dialogueText = async () =>
    page
      .locator('[data-testid="dialogue-text"]')
      .textContent()
      .then((t) => t ?? "")
      .catch(() => "");
  const cgText = async () =>
    page
      .locator('[data-testid="cg-text"]')
      .textContent()
      .then((t) => t ?? "")
      .catch(() => "");
  const press = (key) => page.keyboard.press(key);

  async function skipUntilWorld(maxSeconds = 30) {
    const start = Date.now();
    while (Date.now() - start < maxSeconds * 1000) {
      const sceneId = await page.evaluate(
        () => globalThis.__game?.sceneManager?.current?.id ?? "none",
      );
      if (sceneId === "world") {
        // The world can flip to the intro CG on the very next frame; require
        // it to stay current across a settle window before declaring victory.
        await sleep(600);
        const again = await page.evaluate(
          () => globalThis.__game?.sceneManager?.current?.id ?? "none",
        );
        if (again === "world") {
          return;
        }
        continue;
      }
      await press("Enter");
      await sleep(350);
    }
    throw new Error("world scene did not become current after skipping");
  }

  async function walkTo(x, y, { timeoutMs = 90000 } = {}) {
    const start = Date.now();
    let lastPos = null;
    let stuck = 0;
    let preferAxis = "x";
    while (Date.now() - start < timeoutMs) {
      const s = await game();
      if (s === null) throw new Error("game not exposed");
      if (s.pos.x === x && s.pos.y === y) return s;
      if (s.dead) throw new Error("player died mid-walk");
      if (lastPos !== null && lastPos.x === s.pos.x && lastPos.y === s.pos.y) {
        stuck += 1;
      } else {
        stuck = 0;
      }
      if (stuck > 80) throw new Error(`walkTo(${x},${y}) stuck at ${JSON.stringify(s.pos)}`);
      lastPos = s.pos;
      const dx = Math.sign(x - s.pos.x);
      const dy = Math.sign(y - s.pos.y);
      // Prefer the larger delta; if blocked, try the other axis (stair-step
      // around NPCs/rocks). Flip the preference when both axes are blocked.
      const attempts =
        preferAxis === "x"
          ? [
              ["x", dx],
              ["y", dy],
            ]
          : [
              ["y", dy],
              ["x", dx],
            ];
      let moved = false;
      for (const [axis, d] of attempts) {
        if (d === 0) continue;
        const key =
          axis === "x" ? (d > 0 ? "ArrowRight" : "ArrowLeft") : d > 0 ? "ArrowDown" : "ArrowUp";
        await page.keyboard.press(key);
        await sleep(220);
        const after = await game();
        if (after !== null && (after.pos.x !== s.pos.x || after.pos.y !== s.pos.y)) {
          moved = true;
          break;
        }
      }
      if (!moved) {
        preferAxis = preferAxis === "x" ? "y" : "x";
      }
    }
    throw new Error(`walkTo(${x},${y}) timed out (last ${JSON.stringify((await game())?.pos)})`);
  }

  /** Advance a dialogue box with a single confirm (all event pages are one line). */
  async function closeDialogue() {
    const open = await page.evaluate(() => globalThis.__game?.scene?.isDialogueOpen ?? false);
    if (!open) {
      return;
    }
    await press("Enter");
    await sleep(300);
    const still = await page.evaluate(() => globalThis.__game?.scene?.isDialogueOpen ?? false);
    if (still) {
      throw new Error("dialogue did not close after one advance (facing re-triggers it)");
    }
  }

  /**
   * End the player AT (standX, standY) facing `dir` toward (targetX, targetY).
   * Walks one tile behind the stand, then steps into it — so the LAST
   * keypress is `dir` and the player never overlaps the target tile.
   */
  async function approachAndFace(targetX, targetY, dir, standX, standY) {
    const delta = {
      left: [-1, 0],
      right: [1, 0],
      up: [0, -1],
      down: [0, 1],
    }[dir];
    const key = {
      left: "ArrowLeft",
      right: "ArrowRight",
      up: "ArrowUp",
      down: "ArrowDown",
    }[dir];
    await walkTo(standX - delta[0], standY - delta[1]); // one tile behind
    await press(key); // step into the stand, facing `dir`
    await sleep(150);
  }

  async function attackUntilGone(docId, { timeoutMs = 60000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = await game();
      if (s === null) throw new Error("game not exposed");
      if (!s.combatants.includes(docId)) return true;
      if (s.dead) {
        await press("F9"); // reload the checkpoint save (progress kept)
        await sleep(1500);
        continue;
      }
      // Re-aim at the (possibly moving) target before each swing.
      const target = await page.evaluate((id) => {
        const view = globalThis.__game?.scene?.combatSystem?.views()?.find((c) => c.docId === id);
        return view ? { x: view.x, y: view.y } : null;
      }, docId);
      if (target === null) {
        await sleep(100);
        continue;
      }
      const dx = Math.sign(target.x - s.pos.x);
      const dy = Math.sign(target.y - s.pos.y);
      if (dx !== 0) {
        await press(dx > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(120);
      } else if (dy !== 0) {
        await press(dy > 0 ? "ArrowDown" : "ArrowUp");
        await sleep(120);
      }
      await press("z");
      await sleep(450);
    }
    throw new Error(`combatant ${docId} not defeated in time`);
  }

  // ------------------------------------------------------------------- run
  try {
    await page.goto(BASE, { waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="title-screen"]').count()) > 0, {
      label: "title screen",
    });
    report("1 boot → title screen", "PASS");

    await press("Enter");
    await skipUntilWorld();
    const spawn = await game();
    if (spawn?.pos.x !== 96 || spawn?.pos.y !== 96) {
      throw new Error(`spawn ${JSON.stringify(spawn?.pos)}`);
    }
    report("2 opening CG skipped → village spawn (96,96)", "PASS", JSON.stringify(spawn?.pos));

    // Chest at village-local (26,28) → global (90,92). The chest sprite makes
    // its tile solid now, so the player stands at (91,92) facing left — the
    // approach helper must treat (90,92) as occupied and not try to overlap it.
    await approachAndFace(90, 92, "left", 91, 92);
    const atChest = await game();
    if (atChest?.pos.x !== 91 || atChest?.pos.y !== 92) {
      throw new Error(`chest approach landed ${JSON.stringify(atChest?.pos)} (expected 91,92)`);
    }
    await press("Enter");
    await sleep(300);
    const goldAfter = await hudGold();
    if (!goldAfter.includes("50")) throw new Error(`chest gold=${goldAfter}`);
    report("3 village chest → +50 gold", "PASS", goldAfter);
    await closeDialogue();

    // Elder at village-local (36,30) → global (100,94). Stand east facing left.
    await approachAndFace(100, 94, "left", 101, 94);
    await press("Enter");
    await sleep(300);
    const elderLine = await dialogueText();
    if (!elderLine.includes("烽火")) throw new Error(`elder line=${elderLine}`);
    report("4 elder dialogue", "PASS", elderLine);
    await closeDialogue();

    // Walk north to the village edge (global y 64), then one step into wilds.
    await walkTo(96, 65);
    await press("ArrowUp"); // (96,65) → (96,64) village top edge
    await sleep(300);
    await press("ArrowUp"); // (96,64) → (96,63) wilds bottom row (seamless)
    await waitFor(
      async () => {
        const p = await page.evaluate(() => ({
          x: globalThis.__game?.scene?.playerPosition?.x,
          y: globalThis.__game?.scene?.playerPosition?.y,
        }));
        return p?.y === 63;
      },
      { timeoutMs: 8000, label: "cross into wilds (y=63)" },
    );
    const afterCross = await game();
    if (afterCross?.pos.x !== 96 || afterCross?.pos.y !== 63) {
      throw new Error(`crossed=${JSON.stringify(afterCross?.pos)}`);
    }
    report("5 seamless chunk crossing village→wilds", "PASS", JSON.stringify(afterCross.pos));

    // Slimes: a (98,20), b (100,24). Stand west of each, face right, swing.
    await approachAndFace(98, 20, "right", 97, 20);
    await attackUntilGone("slime_a");
    await approachAndFace(100, 24, "right", 99, 24);
    await attackUntilGone("slime_b");
    const wilds = await game();
    if (!wilds?.swWilds) throw new Error("sw_wilds_cleared not set");
    report(
      "6 two wilds slimes defeated → sw_wilds_cleared",
      "PASS",
      `combatants=${wilds.combatants}`,
    );

    // Fortress: guard at (158,104) global (local 30,40), above the corridor.
    // Approach from (158,105) facing up — the lane stays open for the boss.
    await approachAndFace(158, 104, "up", 158, 105);
    await press("Enter");
    await sleep(300);
    const guardLine = await dialogueText();
    if (!guardLine.includes("哨兵")) throw new Error(`guard line=${guardLine}`);
    report("7 fortress guard admits passage", "PASS", guardLine);
    await closeDialogue();

    // Boss sentinel at (168,106) (local 40,42). F5 checkpoint, approach from
    // the west, face right. (The boss arena is east of the guard.)
    await press("F5");
    await sleep(1200);
    await approachAndFace(168, 106, "right", 167, 106);
    await attackUntilGone("sentinel", { timeoutMs: 60000 });
    const boss = await game();
    if (!boss?.swBoss) throw new Error("sw_boss_defeated not set");
    report("8 turret sentinel defeated → sw_boss_defeated", "PASS");

    // Beacon at (160,88): approach from the east, face left, light it.
    await approachAndFace(160, 88, "left", 161, 88);
    await press("Enter");
    await sleep(1600); // ending CG fade + first line
    const endText = await cgText();
    if (!endText.includes("THE END") && !endText.includes("烽火重燃")) {
      throw new Error(`ending line=${endText}`);
    }
    report("9 ending CG at the beacon", "PASS", endText);
    // Skip the rest of the ending back to the world.
    const start = Date.now();
    while (
      Date.now() - start < 20000 &&
      (await page.evaluate(() => globalThis.__game?.sceneManager?.current?.id ?? "none")) !==
        "world"
    ) {
      await press("Enter");
      await sleep(300);
    }

    // Persistence: F5 → reload → re-enter → state kept, no intro replay.
    await press("F5");
    await sleep(1500);
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await page.locator('[data-testid="title-screen"]').count()) > 0, {
      label: "title after reload",
    });
    await press("Enter");
    await skipUntilWorld();
    const restored = await game();
    if (restored?.gold !== 50 || !restored.swBoss || !restored.swWilds) {
      throw new Error(`restored=${JSON.stringify(restored)}`);
    }
    if (restored.pos.x === 32 && restored.pos.y === 32) {
      throw new Error("reload did not restore position");
    }
    report(
      "10 F5 → reload → state persisted (gold/switch/position)",
      "PASS",
      JSON.stringify(restored.pos),
    );
  } catch (error) {
    fail("golden path", error);
  } finally {
    await browser?.close();
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log("---");
  console.log(`World E2E results: ${results.length} steps, ${failed.length} failed`);
  if (failed.length > 0) exitCode = 1;
}

main()
  .catch((error) => {
    console.error("World E2E runner failed:", error);
    exitCode = 1;
  })
  .finally(() => {
    if (server && !server.killed) server.kill("SIGTERM");
    process.exit(exitCode);
  });
