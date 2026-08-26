/**
 * World demo harness (ADR-008 §5, S5a).
 *
 * Boots the seamless open-world path: `boot({ worldUrl: "data/world.json" })`
 * → title screen → WorldScene with chunk streaming, combat, dialogue, CGs.
 * The placeholder tileset is loaded from `data/tilesets/` and passed to the
 * boot so tile layers render (the same atlas the editor uses).
 *
 * Vite serves `public/` at the root, so `data/world.json`, `data/chunks/*`,
 * `img/cg/*` are reachable as static assets. The chunk-parser worker is
 * created by the default worker factory (module worker, served by vite).
 */
import { parseTilesetDocument } from "@agenticrpg/core";
import { boot, Logger } from "@agenticrpg/runtime";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const root = document.getElementById("root") as HTMLElement;

const dpr = Math.min(window.devicePixelRatio || 1, 2);
const rect = canvas.getBoundingClientRect();
canvas.width = Math.max(1, Math.round(rect.width * dpr));
canvas.height = Math.max(1, Math.round(rect.height * dpr));

const logger = new Logger({ level: "info" });

async function start(): Promise<void> {
  logger.info("world-demo: booting", { worldUrl: "data/world.json" });
  const tilesetDoc = parseTilesetDocument(
    await (await fetch("data/tilesets/placeholder.tileset.json")).json(),
  );
  const game = await boot({
    canvas,
    root,
    worldUrl: "data/world.json",
    tilesets: new Map([[tilesetDoc.id, tilesetDoc]]),
    logger,
  });
  (window as unknown as { __game?: unknown }).__game = game;
  logger.info("world-demo: ready", { world: game.scene.worldData.id });
}

void start().catch((error: unknown) => {
  console.error("[world-demo] boot failed", error);
  const el = document.createElement("div");
  el.dataset.testid = "boot-error";
  el.textContent = `boot failed: ${String(error)}`;
  document.body.appendChild(el);
});
