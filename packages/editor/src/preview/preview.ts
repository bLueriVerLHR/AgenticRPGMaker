/**
 * Runtime preview embed (P2, ADR-006 §feature 6; docs/06-architecture.md §4).
 *
 * "Preview" is literally the game: the editor boots the real runtime
 * (`@agenticrpg/runtime` `boot`, which builds `createGame` → `MapScene` over
 * the shared core model) on an isolated canvas inside the editor. Because both
 * sides consume the same core `MapData` and the same event interpreter, the
 * preview is WYSIWYG — no export/import round-trip, no drift.
 *
 * Storage is injected as `MemoryStorage` so preview sessions never write save
 * documents into the editor's browser storage. The current map's tilesets are
 * passed to the runtime so tile layers render from the same generated atlas.
 */
import type { MapData, TilesetData } from "@agenticrpg/core";
import { boot, MemoryStorage, type Game, Logger } from "@agenticrpg/runtime";
import type { EditorLogger } from "../logger.js";
import { createNoopLogger } from "../logger.js";

export interface PreviewOptions {
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  map: MapData;
  tilesets: TilesetData[];
  logger?: EditorLogger;
  playerPosition?: { x: number; y: number };
}

/** A running preview: the embedded game + a dispose handle. */
export interface PreviewHandle {
  game: Game;
  dispose(): void;
}

/** Start the embedded runtime over `map` on `canvas`/`root`. */
export async function startPreview(options: PreviewOptions): Promise<PreviewHandle> {
  const logger = options.logger ?? createNoopLogger();
  const tilesets = new Map<string, TilesetData>(options.tilesets.map((t) => [t.id, t]));
  logger.info("preview: booting embedded runtime", { map: options.map.id });

  // The runtime expects its own `Logger`; forward every entry to the editor
  // logger so preview logs flow through the editor's structured seam.
  const runtimeLogger = new Logger({
    scope: "editor.preview",
    sinks: [(entry) => logger.log(entry.level, entry.msg, entry.data)],
  });

  const game = await boot({
    canvas: options.canvas,
    root: options.root,
    mapData: options.map,
    storage: new MemoryStorage(),
    tilesets,
    logger: runtimeLogger,
    playerPosition: options.playerPosition ?? { x: 1, y: 1 },
    playerDirection: "down",
    autoLoad: false,
  });

  logger.info("preview: embedded runtime ready", {
    map: options.map.id,
    backend: game.scene.backendLabel,
  });

  return {
    game,
    dispose() {
      game.dispose();
      logger.debug("preview: embedded runtime disposed", { map: options.map.id });
    },
  };
}
