/**
 * World game assembly (ADR-008 §4, S3c part 2).
 *
 * `createWorldGame` mirrors `createGame` for the world path: shared core
 * services (bus, GameState seeded from the manifest's global store, one
 * SceneGraph with a single player entity in global coordinates, interpreter),
 * the SceneManager, the WorldScene, and the fixed-step loop. It also owns the
 * world's CG spring: pages that produce presentation effects (or the intro)
 * become a CgScene — while it is current the WorldScene is not updated (the
 * ADR-009 freeze gate) and on end control returns with cleared input.
 */
import type {
  EventInterpreter as EventInterpreterType,
  GameEventBus,
  GameState as GameStateType,
  SceneGraph,
  WorldData,
} from "@agenticrpg/core";
import {
  Collider,
  EventInterpreter as EventInterpreterClass,
  GameObject,
  GameState as GameStateClass,
  PLAYER_ENTITY_ID,
  SceneGraph as SceneGraphClass,
  Sprite,
  Transform,
  TypedEventBus,
  type GameEventMap,
} from "@agenticrpg/core";
import type { Renderer } from "@agenticrpg/renderer";

import type { AudioManager } from "./audio.js";
import type { CgScript } from "./cg.js";
import { CgScene } from "./cg-scene.js";
import type { ChunkStore } from "./chunk-store.js";
import { GameLoop } from "./game-loop.js";
import { hasAnimationFrame } from "./game-loop.js";
import type { Input } from "./input.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import { SceneManager } from "./scene.js";
import type { WorldStorage } from "./world-storage.js";
import { WorldScene } from "./world-scene.js";

export interface CreateWorldGameOptions {
  canvas: HTMLCanvasElement;
  /** DOM root for the HUD, dialogue box, and virtual controls. */
  root?: HTMLElement;
  world: WorldData;
  chunkStore: ChunkStore;
  renderer: Renderer;
  storage: WorldStorage;
  logger?: Logger;
  /** Injected input (tests); otherwise built from `root` at scene enter. */
  input?: Input;
  audio?: AudioManager | null;
  /** Initial player HP (ADR-009: 3). */
  playerHp?: number;
  /** Seconds per tile step. */
  stepDuration?: number;
  /** Auto-load the latest save on enter. Default true. */
  autoLoad?: boolean;
  tilesets?: WorldScene["tilesets"];
  /** Game-loop overrides (tests inject a manual raf/clock). */
  loop?: {
    fixedDt?: number;
    maxFrameDt?: number;
    raf?: (callback: (timeMs: number) => void) => number;
    cancelRaf?: (handle: number) => void;
    now?: () => number;
  };
}

/**
 * The playable world handle, mirroring `Game` for the world path.
 */
export interface WorldGame {
  readonly bus: GameEventBus;
  readonly state: GameStateType;
  readonly sceneManager: SceneManager;
  readonly scene: WorldScene;
  readonly chunkStore: ChunkStore;
  readonly renderer: Renderer;
  readonly logger: Logger;
  readonly loop: GameLoop;
  readonly audio: AudioManager | null;

  /** Enter the scene and start the game loop (no-op if already running). */
  start(): boolean;
  /** Stop the game loop (the scene stays entered). */
  stop(): void;
  /** Advance one manual frame (tests without a browser clock). */
  tick(dt: number, alpha?: number): void;
  /** Stop the loop, exit the scene, and release resources. */
  dispose(): void;
  /**
   * Show/hide the world UI layer (HUD, dialogue, virtual controls, toasts).
   * Hidden while a presentation scene owns the screen (title, CG) so its
   * overlays never float above them (playtest feedback: stray bars).
   */
  setHudVisible(visible: boolean): void;
  /** Save the current world session through the WorldStorage adapter. */
  save(): Promise<boolean>;
  /** Load the latest world save into the current session. */
  load(): Promise<boolean>;
}

/** Runtime world assembly: core services + scene + loop around a world manifest. */
export function createWorldGame(options: CreateWorldGameOptions): WorldGame {
  const logger = options.logger ?? createNoopLogger();
  const bus: GameEventBus = new TypedEventBus<GameEventMap>();
  const state = new GameStateClass(
    {
      variables: options.world.global.variables,
      switches: options.world.global.switches,
    },
    bus,
  );
  const sceneGraph = buildWorldSceneGraph(options.world);
  const interpreter: EventInterpreterType = new EventInterpreterClass({
    state,
    bus,
    scene: sceneGraph,
  });

  const worldScene = new WorldScene({
    world: options.world,
    chunkStore: options.chunkStore,
    sceneGraph,
    renderer: options.renderer,
    canvas: options.canvas,
    bus,
    state,
    interpreter,
    storage: options.storage,
    logger,
    uiRoot: options.root,
    input: options.input,
    tilesets: options.tilesets,
    audio: options.audio ?? null,
    stepDuration: options.stepDuration,
    autoLoad: options.autoLoad ?? true,
    playerHp: options.playerHp,
    onOpenCg: (script: CgScript) => openCg(script),
  });

  const sceneManager = new SceneManager({ bus, state, logger }, { logger });

  /** UI-layer visibility gate (hidden while title/CG own the screen). */
  function setHudVisible(visible: boolean): void {
    const style = options.root?.style;
    if (style !== undefined) {
      style.display = visible ? "" : "none";
    }
  }
  setHudVisible(false); // the boot mounts the world first, then the title

  function openCg(script: CgScript): void {
    setHudVisible(false);
    const input = worldScene.inputInstance ?? undefined;
    const cg = new CgScene({
      script,
      renderer: options.renderer,
      canvas: options.canvas,
      uiRoot: options.root ?? null,
      audio: options.audio ?? null,
      input,
      logger: logger.child("cg"),
      onEnd: () => {
        worldScene.clearInput();
        sceneManager.change(worldScene);
        setHudVisible(true);
      },
    });
    sceneManager.change(cg);
  }

  const loop = new GameLoop({
    fixedDt: options.loop?.fixedDt,
    maxFrameDt: options.loop?.maxFrameDt,
    raf: options.loop?.raf,
    cancelRaf: options.loop?.cancelRaf,
    now: options.loop?.now,
  });

  logger.info("runtime: world game created", {
    world: options.world.id,
    chunks: options.world.chunks.length,
  });

  let running = false;

  const game: WorldGame = {
    bus,
    state,
    sceneManager,
    scene: worldScene,
    chunkStore: options.chunkStore,
    renderer: options.renderer,
    logger,
    loop,
    audio: options.audio ?? null,

    start(): boolean {
      if (running) {
        return true;
      }
      if (sceneManager.current === null) {
        sceneManager.change(worldScene);
        setHudVisible(true); // entering the world directly: own the screen
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
      logger.info("game: loop started (world)");
      return true;
    },

    stop(): void {
      loop.stop();
      running = false;
      logger.info("game: loop stopped (world)");
    },

    tick(dt: number, alpha = 1): void {
      sceneManager.update(dt);
      sceneManager.render(alpha);
    },

    dispose(): void {
      loop.stop();
      running = false;
      sceneManager.clear();
      worldScene.dispose(); // full teardown (exit() is a backgrounding pause)
      logger.info("game: disposed (world)");
    },

    setHudVisible(visible: boolean): void {
      setHudVisible(visible);
    },

    async save(): Promise<boolean> {
      return worldScene.save();
    },

    async load(): Promise<boolean> {
      return worldScene.load();
    },
  };

  return game;
}

/**
 * One global-coordinates scene graph: a player entity at the world spawn.
 * Chunk event entities attach on chunk load (WorldScene wiring).
 */
function buildWorldSceneGraph(world: WorldData): SceneGraph {
  const sceneGraph = new SceneGraphClass();
  const player = new GameObject({ id: PLAYER_ENTITY_ID, name: "Player", layer: 1 });
  player.addComponent(
    new Transform({
      x: world.spawn.x,
      y: world.spawn.y,
      direction: world.spawn.direction,
    }),
  );
  player.addComponent(new Sprite({ texture: "characters/player" }));
  player.addComponent(
    new Collider({
      shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
      solid: true,
    }),
  );
  sceneGraph.addEntity(player);
  return sceneGraph;
}
