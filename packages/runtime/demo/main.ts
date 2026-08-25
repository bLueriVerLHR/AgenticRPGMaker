/**
 * Runtime demo harness (P1c E2E fixture, docs/07-mvp-plan.md §3.3/§3.4).
 *
 * Boots the playable game in the browser from the `@agenticrpg/runtime`
 * package (the built public surface) with an inline fixture map. Serves as the
 * Playwright E2E target (walk / collide / dialogue / save / reload-restore)
 * and as a manual dev preview. Exposes the game on `window.__game` for E2E
 * assertions.
 *
 * Optional URL query parameters (used by the two-context multiplayer smoke
 * test, P4): `?server=ws://host:port/ws&room=<id>&name=<player>`. When
 * `server` is absent the demo runs single-player (the default P1c scenario).
 */
import { boot, Logger } from "@agenticrpg/runtime";

import demoMap from "./fixtures/demo.map.json";

const params = new URLSearchParams(window.location.search);
const serverUrl = params.get("server") ?? undefined;
const roomId = params.get("room") ?? undefined;
const playerName = params.get("name") ?? "Aria";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const root = document.getElementById("root") as HTMLElement;

// Size the canvas backing store to the device pixel ratio (capped, docs/08
// §4.1) so the viewport math matches the displayed size.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const rect = canvas.getBoundingClientRect();
canvas.width = Math.max(1, Math.round(rect.width * dpr));
canvas.height = Math.max(1, Math.round(rect.height * dpr));

const logger = new Logger({ level: "info" });

async function start(): Promise<void> {
  logger.info("demo: booting", {
    server: serverUrl ?? null,
    room: roomId ?? "default",
    playerName,
  });
  const game = await boot({
    canvas,
    root,
    mapData: demoMap as never,
    logger,
    serverUrl,
    roomId,
    playerName,
    playerPosition: { x: 1, y: 2 },
    playerDirection: "down",
  });
  // Expose for E2E / debugging.
  (window as { __game?: unknown }).__game = game;
  logger.info("demo: ready", { map: game.scene.map.id, backend: game.scene.backendLabel });
}

void start().catch((error: unknown) => {
  console.error("[demo] boot failed", error);
  const el = document.createElement("div");
  el.dataset.testid = "boot-error";
  el.textContent = `boot failed: ${String(error)}`;
  document.body.appendChild(el);
});
