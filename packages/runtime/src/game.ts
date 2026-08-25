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
import type { Renderer } from "@agenticrpg/renderer";

import { GameLoop } from "./game-loop.js";
import { hasAnimationFrame } from "./game-loop.js";
import type { Input } from "./input.js";
import type { Logger } from "./logger.js";
import { MapScene } from "./map-scene.js";
import type { NetworkClient } from "./network-client.js";
import { SceneManager } from "./scene.js";
import type { Storage } from "./storage.js";

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
    autoLoad: options.autoLoad ?? true,
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

  const game: Game = {
    bus,
    state,
    sceneManager,
    scene: mapScene,
    renderer: options.renderer,
    logger,
    network: options.network ?? null,
    loop,

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
      return mapScene.save();
    },

    async load(): Promise<boolean> {
      return mapScene.load();
    },
  };

  return game;
}
