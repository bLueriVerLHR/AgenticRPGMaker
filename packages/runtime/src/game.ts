/**
 * Game handle + `createGame` (P1c, docs/06-architecture.md §3).
 *
 * `createGame` performs the "runtime init" step: builds the shared core
 * services (event bus, GameState, SceneGraph, EventInterpreter), the
 * SceneManager, the MapScene, and the fixed-step game loop, and returns a
 * `Game` handle with `start()`/`stop()`/`dispose()` and `save()`/`load()`.
 *
 * `boot()` (boot.ts) wraps this with the async parts — map loading, renderer
 * capability detection, storage, network — and starts the loop (§3 order:
 * core.init → detect renderer → runtime.boot → scene.enter → game loop).
 */
import type {
  Direction,
  GameEventBus,
  GameState,
  MapData,
  SaveData,
  TilesetData,
  Vec2,
} from "@agenticrpg/core";
import {
  EventInterpreter as EventInterpreterClass,
  GameState as GameStateClass,
  SceneGraph as SceneGraphClass,
  TypedEventBus,
} from "@agenticrpg/core";
import type { GameEventMap } from "@agenticrpg/core";
import type { TransferEvent } from "@agenticrpg/core";
import type { Renderer } from "@agenticrpg/renderer";

import { GameLoop } from "./game-loop.js";
import { hasAnimationFrame } from "./game-loop.js";
import type { Input } from "./input.js";
import type { Logger } from "./logger.js";
import { MapScene } from "./map-scene.js";
import type { NetworkClient } from "./network-client.js";
import { SceneManager } from "./scene.js";
import type { Storage } from "./storage.js";
import { showTitleScreen } from "./title-screen.js";
import type { TitleScreenHandle } from "./title-screen.js";

export interface CreateGameOptions {
  canvas: HTMLCanvasElement;
  /** DOM root for HUD, dialogue, and virtual controls (optional, headless ok). */
  root?: HTMLElement;
  map: MapData;
  renderer: Renderer;
  storage: Storage;
  logger: Logger;
  /** Multiplayer client, or null for single-player. */
  network?: NetworkClient | null;
  /** Injected input (tests/preview); otherwise built from `root`. */
  input?: Input;
  /** Initial player position in tiles (defaults to map origin). */
  playerPosition?: Vec2;
  /** Initial player facing direction. */
  playerDirection?: Direction;
  /** Player sprite reference. */
  playerSprite?: string;
  /** Auto-load the latest save on scene enter. Default true. */
  autoLoad?: boolean;
  /**
   * Show the title screen (task 21) instead of starting gameplay right away:
   * `Game.title` is attached, auto-load is suppressed, and the loop starts
   * when the player picks New Game or Continue. Default false — the game
   * starts immediately (pre-task-21 behavior).
   */
  titleScreen?: boolean;
  /**
   * Async map loader for transfers (task 14). When provided, a `transfer`
   * gameplay event loads the target map and switches the playable scene to it.
   * Boot injects the real loader; tests inject stubs.
   */
  loadMap?: (mapId: string) => Promise<MapData>;
  /** Seconds per tile step. */
  stepDuration?: number;
  /** Optional tilesets for tile-layer rendering. */
  tilesets?: ReadonlyMap<string, TilesetData>;
  /** Game loop overrides (fixedDt/raf/now — tests inject a manual raf). */
  loop?: {
    fixedDt?: number;
    maxFrameDt?: number;
    raf?: (callback: (timeMs: number) => void) => number;
    cancelRaf?: (handle: number) => void;
    now?: () => number;
  };
}

/**
 * The playable game handle. Owns the loop and the scene stack; created by
 * `createGame`, started/stopped/disposed by the owner.
 */
export interface Game {
  readonly bus: GameEventBus;
  readonly state: GameState;
  readonly sceneManager: SceneManager;
  readonly scene: MapScene;
  readonly renderer: Renderer;
  readonly logger: Logger;
  readonly network: NetworkClient | null;
  readonly loop: GameLoop;
  /** Title-screen overlay (task 21), or null when `titleScreen` is off. */
  readonly title: TitleScreenHandle | null;

  /** Enter the scene and start the game loop (no-op if already running). */
  start(): boolean;
  /** Stop the game loop (the scene stays entered). */
  stop(): void;
  /** Advance one manual frame (tests/preview without a browser clock). */
  tick(dt: number, alpha?: number): void;
  /** Stop the loop, exit the scene, and release resources. */
  dispose(): void;
  /** Save the current session through the Storage adapter. */
  save(): Promise<boolean>;
  /** Load the latest save into the current session. */
  load(): Promise<boolean>;
  /**
   * Resume the latest save (task 21): same-map saves restore in place; saves
   * made on another map swap the playable scene to the saved map first.
   * Resolves false when there is no save or it cannot be applied.
   */
  continue(): Promise<boolean>;
}

/** Runtime init: assemble core services + scene + loop around a resolved map. */
export function createGame(options: CreateGameOptions): Game {
  const logger = options.logger;
  const bus: GameEventBus = new TypedEventBus<GameEventMap>();
  const state = new GameStateClass(
    { variables: options.map.variables, switches: options.map.switches },
    bus,
  );
  const sceneGraph = SceneGraphClass.fromMap(options.map, {
    playerPosition: options.playerPosition,
    playerDirection: options.playerDirection,
    playerSprite: options.playerSprite,
  });
  const interpreter = new EventInterpreterClass({ state, bus, scene: sceneGraph });

  // Title screen (task 21): the first session decision belongs to the player,
  // so the silent auto-load must not fire before they pick New Game/Continue.
  const autoLoad = options.titleScreen === true ? false : (options.autoLoad ?? true);

  const mapScene = new MapScene({
    map: options.map,
    renderer: options.renderer,
    canvas: options.canvas,
    bus,
    state,
    sceneGraph,
    interpreter,
    storage: options.storage,
    logger,
    uiRoot: options.root,
    input: options.input,
    network: options.network ?? null,
    tilesets: options.tilesets,
    stepDuration: options.stepDuration,
    autoLoad,
  });

  const sceneManager = new SceneManager({ bus, state, logger }, { logger });
  const loop = new GameLoop({
    fixedDt: options.loop?.fixedDt,
    maxFrameDt: options.loop?.maxFrameDt,
    raf: options.loop?.raf,
    cancelRaf: options.loop?.cancelRaf,
    now: options.loop?.now,
  });

  logger.info("runtime: game created", {
    map: options.map.id,
    network: options.network !== null ? "online" : "offline",
  });

  let running = false;

  // Map transfers (task 14): a `transfer` gameplay event loads the target map
  // (via the injected loader) and switches the playable scene, carrying the
  // player position/direction over. `currentScene` follows the swap so
  // `game.scene`/`save`/`load` always operate on the live map.
  let currentScene: MapScene = mapScene;
  // Mirrors `currentScene`'s map document (MapScene.map is private to the
  // class); transfer and continue keep it in sync for save-map comparisons.
  let currentMapId: string = options.map.id;
  let transferInFlight = false;
  // Shared by map transfers (task 14) and cross-map continue (task 21): build
  // a playable scene for `nextMap` with auto-load off — the caller's position
  // (transfer target / saved position) always wins over a stored save.
  const buildNextScene = (
    nextMap: MapData,
    position: Vec2 | undefined,
    direction: Direction | undefined,
  ): MapScene => {
    const nextGraph = SceneGraphClass.fromMap(nextMap, {
      playerPosition: position,
      playerDirection: direction,
      playerSprite: options.playerSprite,
    });
    return new MapScene({
      map: nextMap,
      renderer: options.renderer,
      canvas: options.canvas,
      bus,
      state,
      sceneGraph: nextGraph,
      interpreter: new EventInterpreterClass({ state, bus, scene: nextGraph }),
      storage: options.storage,
      logger,
      uiRoot: options.root,
      input: options.input,
      network: options.network ?? null,
      tilesets: options.tilesets,
      stepDuration: options.stepDuration,
      autoLoad: false,
    });
  };
  const handleTransfer = (event: TransferEvent): void => {
    const loader = options.loadMap;
    if (loader === undefined) {
      logger.warn("game: transfer requested but no map loader configured", {
        mapId: event.mapId,
      });
      return;
    }
    if (transferInFlight) {
      logger.debug("game: transfer already in flight", { mapId: event.mapId });
      return;
    }
    transferInFlight = true;
    void loader(event.mapId)
      .then((nextMap) => {
        const nextScene = buildNextScene(
          nextMap,
          event.x !== undefined && event.y !== undefined ? { x: event.x, y: event.y } : undefined,
          event.direction,
        );
        currentScene = nextScene;
        currentMapId = nextMap.id;
        sceneManager.change(nextScene);
        // Autosave (task 21): progress persists at every map boundary, so the
        // title screen's Continue has something meaningful to restore.
        void nextScene.save();
        logger.info("game: transferred", { mapId: nextMap.id });
      })
      .catch((error) => {
        logger.error("game: transfer failed", { mapId: event.mapId, error: String(error) });
      })
      .finally(() => {
        transferInFlight = false;
      });
  };
  bus.on("transfer", handleTransfer);

  // Title screen handle (task 21): null unless `titleScreen` is on; attached
  // after the game literal below so its callbacks can close over `game`.
  let title: TitleScreenHandle | null = null;

  const game: Game = {
    bus,
    state,
    sceneManager,
    get scene(): MapScene {
      return currentScene;
    },
    renderer: options.renderer,
    logger,
    network: options.network ?? null,
    loop,
    get title(): TitleScreenHandle | null {
      return title;
    },

    start(): boolean {
      if (running) {
        return true;
      }
      if (sceneManager.current === null) {
        sceneManager.change(mapScene);
      }
      if (!hasAnimationFrame()) {
        logger.warn(
          "game: no requestAnimationFrame — loop not started; call tick() to drive frames",
        );
        running = true;
        return true;
      }
      loop.start(
        (dt) => sceneManager.update(dt),
        (alpha) => sceneManager.render(alpha),
      );
      running = true;
      logger.info("game: loop started");
      return true;
    },

    stop(): void {
      loop.stop();
      running = false;
      logger.info("game: loop stopped");
    },

    tick(dt: number, alpha = 1): void {
      sceneManager.update(dt);
      sceneManager.render(alpha);
    },

    dispose(): void {
      loop.stop();
      running = false;
      sceneManager.clear();
      options.network?.close();
      logger.info("game: disposed");
    },

    async save(): Promise<boolean> {
      return currentScene.save();
    },

    async load(): Promise<boolean> {
      return currentScene.load();
    },

    async continue(): Promise<boolean> {
      let data: SaveData | null = null;
      try {
        data = await options.storage.load();
      } catch (error) {
        logger.warn("game: continue save read failed", { error: String(error) });
        return false;
      }
      if (data === null) {
        logger.info("game: continue requested but no save exists");
        return false;
      }
      if (data.mapId === currentMapId) {
        return currentScene.load();
      }
      const loader = options.loadMap;
      if (loader === undefined) {
        logger.warn("game: continue needs a map loader for a cross-map save", {
          saveMap: data.mapId,
        });
        return false;
      }
      try {
        const nextMap = await loader(data.mapId);
        const nextScene = buildNextScene(
          nextMap,
          { x: data.player.x, y: data.player.y },
          data.player.direction,
        );
        currentScene = nextScene;
        currentMapId = nextMap.id;
        sceneManager.change(nextScene);
        logger.info("game: continued on the saved map", { mapId: nextMap.id });
        return nextScene.load();
      } catch (error) {
        logger.error("game: continue failed", { saveMap: data.mapId, error: String(error) });
        return false;
      }
    },
  };

  if (options.titleScreen === true) {
    title = showTitleScreen({
      storage: options.storage,
      logger,
      root: options.root ?? null,
      onNewGame: () => {
        game.start();
      },
      onContinue: async () => {
        game.start();
        return game.continue();
      },
    });
  }

  return game;
}
