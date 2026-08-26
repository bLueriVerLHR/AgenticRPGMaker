/**
 * WorldScene — the seamless multi-chunk map scene (ADR-008 §4, S3c part 2).
 *
 * The world equivalent of MapScene: the player transform holds **global**
 * tile coordinates; collision, interaction and rendering resolve through the
 * resident chunk pool (ChunkStore). Movement is the same edge-triggered grid
 * walk (0.15 s/step, ADR-009); stepping into a chunk that is not resident yet
 * blocks the step with a warning (prefetch radius 1 makes this unreachable in
 * practice). Dialogue, HUD, toasts, audio cues and save-v2 live here; the
 * intro CG and event-triggered CGs hand their presentation script to
 * `onOpenCg` (the game assembly switches to CgScene, which freezes this scene
 * by construction while it is current — the ADR-009 freeze gate).
 *
 * Scope note (S4): on-map combat (sword, contact damage, turret projectiles,
 * death → respawn) is wired through the CombatSystem (world-combat.js); this
 * scene ships movement/collision/dialogue/interaction/CG/audio/save-v2 and
 * the combat integration. The world runs single-player (multiplayer stays on
 * the mapData path, ADR-008 §5).
 */
import type {
  Direction,
  EventInterpreter,
  GameEventBus,
  GameObject,
  GameState,
  MapEvent,
  SaveDataV2,
  SceneGraph,
  TilesetData,
  Transform,
  Vec2,
  WorldData,
} from "@agenticrpg/core";
import {
  Collider,
  GameObject as GameObjectClass,
  PLAYER_ENTITY_ID,
  Sprite,
  Transform as TransformClass,
  chunkCellAt,
  toChunkLocal,
  toGlobal,
  type ChunkCell,
} from "@agenticrpg/core";
import type { Renderer } from "@agenticrpg/renderer";
import { isTileMapRenderer, type TileMapRenderer } from "@agenticrpg/renderer";

import type { AudioManager } from "./audio.js";
import type { CgScript } from "./cg.js";
import { buildCgScript } from "./cg.js";
import type { ChunkStore } from "./chunk-store.js";
import { Input, DIRECTION_VECTORS, type InputDirection } from "./input.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import { buildCollisionGrid, type SolidTileGrid } from "./movement.js";
import type { Scene, SceneContext } from "./scene.js";
import { CombatSystem } from "./world-combat.js";
import {
  drawBeacon,
  drawChest,
  drawHero,
  drawSignpost,
  drawSlime,
  drawTurret,
  drawVillager,
} from "./world-sprites.js";
import type { WorldStorage } from "./world-storage.js";

export interface WorldSceneOptions {
  world: WorldData;
  chunkStore: ChunkStore;
  sceneGraph: SceneGraph;
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  bus: GameEventBus;
  state: GameState;
  interpreter: EventInterpreter;
  storage: WorldStorage;
  logger?: Logger;
  uiRoot?: HTMLElement | null;
  input?: Input;
  tilesets?: ReadonlyMap<string, TilesetData>;
  audio?: AudioManager | null;
  /** Seconds per tile step. Default 0.15. */
  stepDuration?: number;
  /** Auto-load the latest save on enter. Default true. */
  autoLoad?: boolean;
  /** Called once whenever a page produced CG presentation effects. */
  onOpenCg?: (script: CgScript) => void;
  /** Initial player HP (a loaded save overrides it). Default 3 (ADR-009). */
  playerHp?: number;
}

/** A tile step in progress (global coordinates). */
interface Step {
  from: Vec2;
  to: Vec2;
  t: number;
}

const DEFAULT_STEP_DURATION = 0.09;
/** Retry cadence while a held direction is blocked (seconds). */
const BLOCKED_RETRY_SECONDS = 0.12;
/** World-view zoom: the camera keeps the character readable on screen. */
const CAMERA_ZOOM = 3;
/** Camera follow smoothing (higher = snappier). */
const CAMERA_LERP_RATE = 8;
const PLAYER_MAX_HP = 3;
/** Chunk-local event entity id prefix: `${chunkId}:${event.id}`. */
const ENTITY_SEP = ":";
/** How long the sword slash mark is visible after a swing (seconds). */
const SWING_FLASH_SECONDS = 0.14;
/** Player hit-flash (red) duration in seconds. */
const PLAYER_HIT_FLASH_SECONDS = 0.25;
/** Bright crest color for wall-face tiles (top edge of a solid run). */
const WALL_CREST = "#aeb6c4";
/** Ground tile values from the generator that read as liquid, not wall. */
const GROUND_WATER = 3;

/** Commands whose presence marks a page as a CG presentation (ADR-010 §6). */
const CG_COMMAND_NAMES = new Set(["showCg", "fadeOut", "fadeIn", "cg_end"]);

interface HudElements {
  root: HTMLElement;
  position: HTMLElement;
  status: HTMLElement;
  gold: HTMLElement;
  objective: HTMLElement;
}

function isColliderLayer(layer: { id: string; name: string }): boolean {
  return /collider/i.test(layer.id) || /collider/i.test(layer.name);
}

export class WorldScene implements Scene {
  readonly id = "world";

  private readonly world: WorldData;
  private readonly chunkStore: ChunkStore;
  private readonly sceneGraph: SceneGraph;
  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly bus: GameEventBus;
  private readonly state: GameState;
  private readonly interpreter: EventInterpreter;
  private readonly storage: WorldStorage;
  private readonly logger: Logger;
  private readonly uiRoot: HTMLElement | null;
  private readonly injectedInput: Input | null;
  private readonly tilesets: ReadonlyMap<string, TilesetData> | undefined;
  private readonly audio: AudioManager | null;
  private readonly stepDuration: number;
  private readonly autoLoad: boolean;
  private readonly onOpenCg?: (script: CgScript) => void;

  private readonly grids = new Map<string, SolidTileGrid>();
  private readonly chunkEvents = new Map<string, MapEvent[]>();
  private readonly blockByEntity = new Map<string, GameObject>();
  private readonly entityChunk = new Map<string, string>();
  private readonly defeatedByChunk = new Map<string, Set<string>>();

  private input: Input | null = null;
  private virtualInput: Input | null = null;
  private step: Step | null = null;
  /** Direction of the most recent attempt (fresh-press detection). */
  private lastStepDir: InputDirection | null = null;
  private blockedWait = 0;
  /** Camera top-left in world pixels (null until the first frame). */
  private cameraX: number | null = null;
  private cameraY: number | null = null;
  private dialogueQueue: string[] = [];
  private dialogueEl: HTMLElement | null = null;
  private hud: HudElements | null = null;
  private saveToastEl: HTMLElement | null = null;
  private entered = false;
  private ready = false;
  private hp = PLAYER_MAX_HP;
  private playerIframes = 0;
  private playerHitFlash = 0;
  private swingFlash = 0;
  private swingDir: InputDirection | null = null;
  private dead = false;
  private deathTimer = 0;
  private tilesetsRegistered = false;
  /** Bus dialogue is suppressed while a CG-marked page runs (its lines replay inside the CG). */
  private suppressingDialogueForCg = false;
  /** The intro CG triggers once, on the first world update (post-title). */
  private introTriggered = false;
  /** On-map combat (ADR-009, S4): enemies, projectiles, the player sword. */
  private readonly combat: CombatSystem;

  private readonly busUnsubscribers: Array<() => void> = [];
  private readonly domCleanup: Array<() => void> = [];

  constructor(options: WorldSceneOptions) {
    this.world = options.world;
    this.chunkStore = options.chunkStore;
    this.sceneGraph = options.sceneGraph;
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.bus = options.bus;
    this.state = options.state;
    this.interpreter = options.interpreter;
    this.storage = options.storage;
    this.logger = options.logger ?? createNoopLogger();
    this.uiRoot = options.uiRoot ?? null;
    this.injectedInput = options.input ?? null;
    this.tilesets = options.tilesets;
    this.audio = options.audio ?? null;
    this.stepDuration = options.stepDuration ?? DEFAULT_STEP_DURATION;
    this.autoLoad = options.autoLoad ?? true;
    this.onOpenCg = options.onOpenCg;
    this.hp = options.playerHp ?? PLAYER_MAX_HP;
    this.combat = new CombatSystem({
      world: this.world,
      sceneGraph: this.sceneGraph,
      logger: this.logger,
      playerTile: () => this.playerPosition,
      playerDirection: () => this.playerDirection as InputDirection,
      isTileBlocked: (tile) => this.isBlocked(tile),
      applyDamageToPlayer: (amount) => this.applyDamageToPlayer(amount),
      onCombatantDefeated: (chunkId, combatantId) => this.onCombatantDefeated(chunkId, combatantId),
      sfx: (ref) => this.audio?.playSfx(ref),
    });
  }

  // ------------------------------------------------------------------
  // Public accessors (HUD, E2E, save/load)
  // ------------------------------------------------------------------

  /** The player's current global tile position. */
  get playerPosition(): Vec2 {
    const t = this.playerTransform;
    return t !== null ? { x: t.x, y: t.y } : { x: this.world.spawn.x, y: this.world.spawn.y };
  }

  /** The player's current HP (hearts in HUD; save-v2 persists it). */
  get playerHp(): number {
    return this.hp;
  }

  /** True while the player is down (before the respawn fade completes). */
  get isDead(): boolean {
    return this.dead;
  }

  /** The on-map combat system (enemies, projectiles, sword). */
  get combatSystem(): CombatSystem {
    return this.combat;
  }

  /** The player's current facing direction. */
  get playerDirection(): Direction {
    return this.playerTransform?.direction ?? "down";
  }

  /** True once the initial chunk setup finished. */
  get isReady(): boolean {
    return this.ready;
  }

  /** True while a dialogue box is showing. */
  get isDialogueOpen(): boolean {
    return this.dialogueQueue.length > 0;
  }

  /** The current dialogue line (or null). */
  get currentDialogueText(): string | null {
    return this.dialogueQueue.length > 0 ? this.dialogueQueue[0]! : null;
  }

  /** The scene's renderer backend label (HUD). */
  get backendLabel(): string {
    const backend = (this.renderer as { getBackend?: () => string }).getBackend?.();
    return backend ?? "unknown";
  }

  /** The world manifest this scene runs (HUD/logging/tests). */
  get worldData(): WorldData {
    return this.world;
  }

  /** Story switch value (E2E assertions, debug). */
  getSwitch(name: string): boolean {
    return this.state.getSwitch(name);
  }

  /** Story variable value (E2E assertions, debug). */
  getVariable(name: string): number {
    return this.state.getVariable(name);
  }

  /** Current objective hint text (guidance; E2E/tests). */
  get objectiveHint(): string {
    return this.objectiveText();
  }

  /** The live input instance (the CG scene reuses it during handoff). */
  get inputInstance(): Input | null {
    return this.input;
  }

  /** Drop queued input edges (called when returning from a CG). */
  clearInput(): void {
    this.input?.clear();
    this.virtualInput?.clear();
  }

  // ------------------------------------------------------------------
  // Scene lifecycle
  // ------------------------------------------------------------------

  enter(_context: SceneContext): void {
    if (this.entered) {
      return;
    }
    this.entered = true;
    this.addBusSubscriptions();
    this.chunkStore.onLoaded = (chunkId) => this.handleChunkLoaded(chunkId);
    this.chunkStore.onEvicted = (chunkId) => this.handleChunkEvicted(chunkId);
    this.createUi();
    this.createInput();
    this.logger.info("scene: world entered", {
      world: this.world.id,
      chunks: this.world.chunks.length,
      headless: this.uiRoot === null,
    });
    void this.startup();
  }

  update(dt: number): void {
    if (!this.ready) {
      return;
    }
    if (!this.introTriggered) {
      this.introTriggered = true;
      this.playIntroIfDue(); // world is current → the opening CG may fire now
    }
    this.advanceStep(dt);
    this.handleMovement(dt);
    this.handleConfirm();
    this.handleCancel();
    this.playerIframes = Math.max(0, this.playerIframes - dt);
    this.playerHitFlash = Math.max(0, this.playerHitFlash - dt);
    this.swingFlash = Math.max(0, this.swingFlash - dt);
    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.respawnAtSpawn();
        this.resetCamera();
      }
    } else if (!this.isDialogueOpen) {
      this.combat.update(dt); // frozen during dialogue/CG (ADR-009 §5.5)
    }
    this.updateCamera(dt);
    this.updateHud();
  }

  render(): void {
    this.renderScene();
  }

  exit(): void {
    // The world is only ever backgrounded (title/CG handoff) or disposed via
    // `dispose()`; it is never permanently left through exit(). So exit() is
    // a pause: it must NOT destroy input, HUD, or bus subscriptions, because
    // re-enter() is a no-op and the scene simply resumes when it becomes the
    // current scene again. Full teardown happens in `dispose()`.
    this.logger.debug("scene: world backgrounded (paused)", { world: this.world.id });
  }

  /** Full teardown (game dispose): unsubscribes, removes DOM, frees input. */
  dispose(): void {
    if (!this.entered) {
      return;
    }
    this.entered = false;
    this.chunkStore.onLoaded = undefined;
    this.chunkStore.onEvicted = undefined;
    for (const unsubscribe of this.busUnsubscribers) {
      unsubscribe();
    }
    this.busUnsubscribers.length = 0;
    for (const cleanup of this.domCleanup) {
      cleanup();
    }
    this.domCleanup.length = 0;
    if (this.injectedInput === null) {
      this.input?.dispose();
    }
    this.input = null;
    this.virtualInput?.dispose();
    this.virtualInput = null;
    this.combat.clear();
    this.dialogueQueue = [];
    this.step = null;
    this.lastStepDir = null;
    this.blockedWait = 0;
    this.logger.info("scene: world disposed", { world: this.world.id });
  }

  /**
   * Serialize the world session to the core save-v2 schema and persist it
   * (ADR-008 §7: chunk + local pos, HP, globals, per-chunk defeated ids).
   */
  async save(): Promise<boolean> {
    const transform = this.playerTransform;
    if (transform === null) {
      return false;
    }
    const chunkSize = this.world.chunkSize;
    const gx = Math.round(transform.x);
    const gy = Math.round(transform.y);
    const cell = chunkCellAt(gx, gy, chunkSize);
    const chunk = this.chunkStore.chunkAtCell(cell);
    const chunkId = chunk?.id ?? this.world.spawn.chunkId;
    const local = toChunkLocal({ x: gx, y: gy }, chunkSize);
    const snapshot = this.state.snapshot();
    const chunkState: SaveDataV2["chunkState"] = {};
    for (const [id, defeated] of this.defeatedByChunk) {
      chunkState[id] = { defeatedIds: [...defeated] };
    }
    const data: SaveDataV2 = {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      worldId: this.world.id,
      player: {
        chunkId,
        x: local.x,
        y: local.y,
        direction: transform.direction,
        hp: this.hp,
      },
      variables: snapshot.variables,
      switches: snapshot.switches,
      chunkState,
    };
    await this.storage.save(data);
    this.showToast("saved");
    this.logger.info("save: written (world)", { worldId: data.worldId, hp: data.player.hp });
    return true;
  }

  /** Load the latest world save and restore player/globals/HP/chunk state. */
  async load(): Promise<boolean> {
    const data = await this.storage.load();
    if (data === null) {
      return false;
    }
    if (data.worldId !== this.world.id) {
      this.logger.warn("load: save is for a different world; ignored", {
        saveWorld: data.worldId,
        currentWorld: this.world.id,
      });
      return false;
    }
    const chunk = this.chunkStore.getWorldChunk(data.player.chunkId);
    const cell: ChunkCell =
      chunk !== null ? { col: chunk.col, row: chunk.row } : { col: 0, row: 0 };
    const global = toGlobal(cell, { x: data.player.x, y: data.player.y }, this.world.chunkSize);
    const transform = this.playerTransform;
    transform?.setPosition(global.x, global.y);
    transform?.setDirection(data.player.direction);
    this.hp = data.player.hp;
    this.state.load({ variables: data.variables, switches: data.switches });
    this.defeatedByChunk.clear();
    for (const [chunkId, chunkState] of Object.entries(data.chunkState)) {
      this.defeatedByChunk.set(chunkId, new Set(chunkState.defeatedIds));
    }
    this.showToast("loaded");
    this.logger.info("load: applied (world)", {
      worldId: data.worldId,
      chunk: data.player.chunkId,
    });
    return true;
  }

  /** Trigger dialogue with the NPC being faced (tests/E2E). */
  interact(): boolean {
    return this.tryInteract();
  }

  // ------------------------------------------------------------------
  // Startup: resident chunks, spawn placement, autoload, intro CG
  // ------------------------------------------------------------------

  private async startup(): Promise<void> {
    const spawn = { x: this.world.spawn.x, y: this.world.spawn.y };
    await this.chunkStore.updateTo(chunkCellAt(spawn.x, spawn.y, this.world.chunkSize));
    const transform = this.playerTransform;
    transform?.setPosition(spawn.x, spawn.y);
    transform?.setDirection(this.world.spawn.direction);
    if (this.autoLoad) {
      const loaded = await this.load();
      if (loaded) {
        this.logger.info("scene: auto-loaded world save", { worldId: this.world.id });
      }
    }
    this.ready = true;
    this.updateHud();
    // The intro is NOT played here: it must wait until the world scene is
    // actually current (a title screen may precede it), so it triggers on the
    // first world update instead.
  }

  /** The world's `intro` commands run once, gated by `sw_intro_done`. */
  private playIntroIfDue(): void {
    if (this.world.intro.length === 0 || this.state.getSwitch("sw_intro_done")) {
      return;
    }
    const introEvent: MapEvent = {
      id: "world:intro",
      name: "Opening",
      x: 0,
      y: 0,
      pages: [{ condition: null, commands: this.world.intro }],
    };
    this.logger.info("scene: playing intro CG", { world: this.world.id });
    // The intro's dialogue lines replay inside the CgScene; suppress the
    // world dialogue queue so no stray box stays open after the CG ends.
    const wasSuppressing = this.suppressingDialogueForCg;
    this.suppressingDialogueForCg = true;
    const result = this.interpreter.runEvent(introEvent, { actorId: "world:intro" });
    this.suppressingDialogueForCg = wasSuppressing;
    const script = buildCgScript(result.effects);
    if (script.length > 0) {
      this.onOpenCg?.(script);
    }
  }

  // ------------------------------------------------------------------
  // Chunk wiring (entities, collision grids, event indexes)
  // ------------------------------------------------------------------

  /** A resident chunk entered memory: build its collision grid + entities. */
  private handleChunkLoaded(chunkId: string): void {
    const map = this.chunkStore.getChunk(chunkId);
    if (map === null) {
      return;
    }
    const chunk = this.chunkStore.getWorldChunk(chunkId);
    if (chunk === null) {
      return;
    }
    this.grids.set(chunkId, buildCollisionGrid(map));
    this.chunkEvents.set(chunkId, map.events);
    for (const event of map.events) {
      const entityId = `${chunkId}${ENTITY_SEP}${event.id}`;
      if (this.sceneGraph.getEntityById(entityId) !== null) {
        continue;
      }
      const entity = new GameObjectClass({ id: entityId, name: event.name, layer: 2 });
      entity.addComponent(
        new TransformClass({
          x: chunk.col * this.world.chunkSize + event.x,
          y: chunk.row * this.world.chunkSize + event.y,
        }),
      );
      if (event.sprite !== undefined) {
        entity.addComponent(new Sprite({ texture: event.sprite }));
        entity.addComponent(
          new Collider({
            shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
            solid: true,
          }),
        );
        this.blockByEntity.set(entityId, entity);
      }
      this.sceneGraph.addEntity(entity);
      this.entityChunk.set(entityId, chunkId);
    }
    this.combat.spawnForChunk(chunkId);
    this.logger.debug("world: chunk entities wired", { chunkId, events: map.events.length });
  }

  /** A chunk left memory: remove its entities, grid, and event index. */
  private handleChunkEvicted(chunkId: string): void {
    for (const [entityId, owner] of [...this.entityChunk.entries()]) {
      if (owner === chunkId) {
        this.sceneGraph.removeEntity(entityId);
        this.entityChunk.delete(entityId);
        this.blockByEntity.delete(entityId);
      }
    }
    this.grids.delete(chunkId);
    this.chunkEvents.delete(chunkId);
    this.combat.despawnForChunk(chunkId);
    this.logger.debug("world: chunk entities removed", { chunkId });
  }

  // ------------------------------------------------------------------
  // Movement
  // ------------------------------------------------------------------

  private get playerTransform(): Transform | null {
    return this.sceneGraph.getEntityById(PLAYER_ENTITY_ID)?.getComponent("transform") ?? null;
  }

  private advanceStep(dt: number): void {
    if (this.step === null) {
      return;
    }
    this.step.t += dt / this.stepDuration;
    if (this.step.t >= 1) {
      const to = this.step.to;
      this.playerTransform?.setPosition(to.x, to.y);
      this.step = null;
      this.syncChunks();
    }
  }

  private syncChunks(): void {
    const pos = this.playerPosition;
    void this.chunkStore.updateTo(chunkCellAt(pos.x, pos.y, this.world.chunkSize));
  }

  private handleMovement(dt: number): void {
    if (this.isDialogueOpen || this.step !== null) {
      return;
    }
    // A tap shorter than one simulation frame (keydown+keyup between fixed
    // updates) still has to move the player: Input queues direction edges,
    // so a fresh edge starts a step even though nothing is held anymore.
    const held = this.currentDirection();
    const direction = this.consumeDirectionEdge() ?? held;
    if (direction === null) {
      this.blockedWait = 0;
      this.lastStepDir = null;
      return;
    }
    // Continuous walking (playtest feedback): while a direction stays held,
    // each completed glide flows straight into the next step with no forced
    // pause. A fresh press always attempts immediately; a blocked facing tile
    // retries on a small cadence instead of hammering collision every frame.
    const fresh = direction !== this.lastStepDir;
    this.lastStepDir = direction;
    if (!fresh && this.blockedWait > 0) {
      this.blockedWait = Math.max(0, this.blockedWait - dt);
      if (this.blockedWait > 0) {
        return;
      }
    }
    if (this.tryStep(direction)) {
      this.blockedWait = 0;
    } else {
      this.blockedWait = BLOCKED_RETRY_SECONDS;
    }
  }

  private tryStep(direction: InputDirection): boolean {
    const transform = this.playerTransform;
    if (transform === null) {
      return false;
    }
    const vector = DIRECTION_VECTORS[direction];
    const from = { x: transform.x, y: transform.y };
    const to = { x: from.x + vector.x, y: from.y + vector.y };
    transform.setDirection(direction as Direction);

    if (this.isBlocked(to)) {
      this.logger.debug("movement: blocked", { from, to });
      return false;
    }
    this.step = { from, to, t: 0 };
    this.bus.emit("walk", { entityId: PLAYER_ENTITY_ID, from, to });
    this.logger.debug("movement: step", { from, to });
    return true;
  }

  /** World-bounds, residency, tile-solidity, and NPC occupancy at a global tile. */
  private isBlocked(at: Vec2): boolean {
    const worldWidth = this.world.grid.cols * this.world.chunkSize;
    const worldHeight = this.world.grid.rows * this.world.chunkSize;
    if (at.x < 0 || at.y < 0 || at.x >= worldWidth || at.y >= worldHeight) {
      return true; // world edge
    }
    const cell = chunkCellAt(at.x, at.y, this.world.chunkSize);
    const chunk = this.chunkStore.chunkAtCell(cell);
    if (chunk === null) {
      return true;
    }
    const map = this.chunkStore.getChunk(chunk.id);
    if (map === null) {
      this.logger.warn("movement: target chunk not resident", { at, chunkId: chunk.id });
      return true; // prefetch radius 1 makes this unreachable in practice
    }
    const local = toChunkLocal(at, this.world.chunkSize);
    const grid = this.grids.get(chunk.id);
    if (grid?.isSolid(local.x, local.y) === true) {
      return true;
    }
    for (const blocker of this.blockByEntity.values()) {
      const t = blocker.getComponent("transform");
      if (t !== null && t.x === at.x && t.y === at.y) {
        return true;
      }
    }
    if (this.combat.atTile(at) !== null) {
      return true; // enemies are solid (contact happens when THEY step in)
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Input plumbing (shared with dialogue + CG handoff)
  // ------------------------------------------------------------------

  private createInput(): void {
    if (this.injectedInput !== null) {
      this.input = this.injectedInput;
      return;
    }
    const keyboard = new Input({
      keyboard: typeof window !== "undefined",
      target: typeof window !== "undefined" ? window : undefined,
      logger: this.logger,
    });
    this.input = keyboard;
    if (this.uiRoot !== null) {
      const virtual = new Input({
        root: this.uiRoot,
        keyboard: false,
        virtualControls: true,
        logger: this.logger,
      });
      this.virtualInput = virtual;
      const onKeyDown = (event: Event): void => {
        const e = event as KeyboardEvent;
        if (e.code === "F5") {
          e.preventDefault();
          void this.save();
        } else if (e.code === "F9") {
          e.preventDefault();
          void this.load();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      this.domCleanup.push(() => window.removeEventListener("keydown", onKeyDown));
    }
  }

  private currentDirection(): InputDirection | null {
    return this.input?.direction ?? this.virtualInput?.direction ?? null;
  }

  private consumeDirectionEdge(): InputDirection | null {
    return this.input?.consumeDirectionEdge() ?? this.virtualInput?.consumeDirectionEdge() ?? null;
  }

  private consumeConfirm(): boolean {
    return this.input?.consumeConfirm() === true || this.virtualInput?.consumeConfirm() === true;
  }

  private consumeCancel(): boolean {
    return this.input?.consumeCancel() === true || this.virtualInput?.consumeCancel() === true;
  }

  private handleConfirm(): void {
    if (!this.consumeConfirm()) {
      return;
    }
    if (this.isDialogueOpen) {
      this.advanceDialogue();
      return;
    }
    if (this.dead) {
      return;
    }
    if (this.step !== null) {
      return;
    }
    if (this.combat.attack()) {
      // A real sword swing: show the slash and remember its direction.
      // (combat.attack() already plays the sword sfx.)
      this.swingDir = this.playerDirection as InputDirection;
      this.swingFlash = SWING_FLASH_SECONDS;
      return; // a sword swing happened — no interaction this press
    }
    this.tryInteract();
  }

  private handleCancel(): void {
    if (!this.consumeCancel()) {
      return;
    }
    if (this.isDialogueOpen) {
      this.closeDialogue();
    }
  }

  // ------------------------------------------------------------------
  // Interaction
  // ------------------------------------------------------------------

  private tryInteract(): boolean {
    const transform = this.playerTransform;
    if (transform === null) {
      return false;
    }
    const vector = DIRECTION_VECTORS[transform.direction as InputDirection];
    const facing = {
      x: Math.round(transform.x) + vector.x,
      y: Math.round(transform.y) + vector.y,
    };
    const cell = chunkCellAt(facing.x, facing.y, this.world.chunkSize);
    const chunk = this.chunkStore.chunkAtCell(cell);
    const map = chunk === null ? null : this.chunkStore.getChunk(chunk.id);
    if (chunk === null || map === null) {
      return false;
    }
    const local = toChunkLocal(facing, this.world.chunkSize);
    const events = this.chunkEvents.get(chunk.id) ?? [];
    const event = events.find((e) => e.x === local.x && e.y === local.y);
    if (event === undefined) {
      return false;
    }
    const actorId = `${chunk.id}${ENTITY_SEP}${event.id}`;
    const isCgPage = event.pages.some((page) =>
      page.commands.some((command) => CG_COMMAND_NAMES.has(command.cmd)),
    );
    const wasSuppressing = this.suppressingDialogueForCg;
    this.suppressingDialogueForCg = isCgPage;
    const result = this.interpreter.runEvent(event, { actorId });
    this.suppressingDialogueForCg = wasSuppressing;
    if (result.ran) {
      this.logger.info("interaction: event ran", {
        event: event.id,
        page: "selected",
        effects: result.effects.length,
      });
      if (isCgPage) {
        const script = buildCgScript(result.effects);
        if (script.length > 0) {
          this.onOpenCg?.(script);
        }
      }
      return true;
    }
    return true; // facing an event with no active page still consumes the press
  }

  // ------------------------------------------------------------------
  // Combat integration (ADR-009 §5, S4)
  // ------------------------------------------------------------------

  /** The combat system asks the scene to damage the player (i-frames/HP/death). */
  private applyDamageToPlayer(amount: number): void {
    if (this.dead || this.playerIframes > 0) {
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.playerIframes = 0.5;
    this.playerHitFlash = PLAYER_HIT_FLASH_SECONDS;
    this.audio?.playSfx("hit");
    this.updateHud();
    this.logger.warn("combat: player hit", { hp: this.hp, amount });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deathTimer = 1.2;
      this.step = null;
      this.dialogueQueue.length = 0;
      this.renderDialogue();
      this.logger.warn("combat: player defeated", {});
    }
  }

  /** A combatant died: remember it (save-v2 delta), fire its story switch, autosave. */
  private onCombatantDefeated(chunkId: string, combatantId: string): void {
    const set = this.defeatedByChunk.get(chunkId) ?? new Set<string>();
    set.add(combatantId);
    this.defeatedByChunk.set(chunkId, set);
    const chunk = this.world.chunks.find((c) => c.id === chunkId);
    const def = chunk?.combatants.find((c) => c.id === combatantId);
    if (def?.onDefeatSwitch !== undefined) {
      this.state.setSwitch(def.onDefeatSwitch, true);
      this.logger.info("combat: story switch set", { switch: def.onDefeatSwitch });
    }
    void this.save().then((ok) => {
      if (ok) {
        this.logger.info("combat: victory autosave", { combatantId, chunkId });
      }
    });
  }

  /** Death flow (ADR-009 §5.4): back to the spawn, full HP, progress kept. */
  private respawnAtSpawn(): void {
    this.dead = false;
    this.hp = PLAYER_MAX_HP;
    this.playerIframes = 1.0;
    const transform = this.playerTransform;
    const spawn = this.world.spawn;
    transform?.setPosition(spawn.x, spawn.y);
    transform?.setDirection(spawn.direction);
    this.step = null;
    this.clearInput();
    void this.chunkStore.updateTo(chunkCellAt(spawn.x, spawn.y, this.world.chunkSize));
    this.updateHud();
    this.showToast("respawning");
    this.logger.info("combat: player respawned", { spawn });
  }

  // ------------------------------------------------------------------
  // Bus + UI
  // ------------------------------------------------------------------

  private addBusSubscriptions(): void {
    this.busUnsubscribers.push(
      this.bus.on("dialogue", (event) => {
        if (this.suppressingDialogueForCg) {
          return; // the lines replay inside the CgScene presentation
        }
        this.dialogueQueue.push(event.text);
        this.renderDialogue();
        this.logger.debug("dialogue: queued", { text: event.text });
      }),
      this.bus.on("sound", (event) => {
        this.audio?.playSfx(event.ref);
      }),
      this.bus.on("bgm", (event) => {
        this.audio?.startBgm(event.ref);
      }),
      this.bus.on("variable_changed", (event) => {
        this.logger.debug("variable_changed", { name: event.name });
        this.updateHud();
      }),
      this.bus.on("switch_changed", (event) => {
        this.logger.debug("switch_changed", { name: event.name, value: event.value });
      }),
    );
  }

  private createUi(): void {
    if (this.uiRoot === null) {
      return; // headless (tests): no DOM, dialogue observable via getters
    }
    const hud = document.createElement("div");
    hud.dataset.testid = "hud";
    hud.className = "agenticrpg-hud";
    hud.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "padding:0.4rem 0.6rem",
      "background:rgba(0,0,0,0.55)",
      "color:#fff",
      "font:12px/1.4 monospace",
      "z-index:60",
      "pointer-events:none",
    ].join(";");
    const backend = document.createElement("span");
    backend.dataset.testid = "hud-backend";
    backend.textContent = `backend: ${this.backendLabel}`;
    const position = document.createElement("span");
    position.dataset.testid = "hud-position";
    position.textContent = "0,0";
    const status = document.createElement("span");
    status.dataset.testid = "hud-hp";
    status.textContent = this.heartsLabel();
    const gold = document.createElement("span");
    gold.dataset.testid = "hud-gold";
    gold.textContent = "gold: 0";
    const hint = document.createElement("span");
    hint.dataset.testid = "hud-hint";
    hint.textContent = "Arrows/WASD move · Z/Enter talk/attack · X/Esc close · F5 save · F9 load";
    const objective = document.createElement("div");
    objective.dataset.testid = "hud-objective";
    objective.style.cssText = [
      "position:fixed",
      "left:0.6rem",
      "top:2.2rem",
      "padding:0.3rem 0.6rem",
      "background:rgba(0,0,0,0.5)",
      "color:#ffe082",
      "font:12px/1.5 system-ui,sans-serif",
      "z-index:61",
      "pointer-events:none",
    ].join(";");
    const sep = (): HTMLElement => {
      const s = document.createElement("span");
      s.textContent = " · ";
      return s;
    };
    hud.append(backend, sep(), position, sep(), status, sep(), gold, sep(), hint);
    this.uiRoot.appendChild(hud);
    this.uiRoot.appendChild(objective);
    this.hud = { root: hud, position, status, gold, objective };

    const dialogue = document.createElement("div");
    dialogue.dataset.testid = "dialogue-box";
    dialogue.className = "agenticrpg-dialogue";
    dialogue.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:10rem",
      "transform:translateX(-50%)",
      "min-width:16rem",
      "max-width:80vw",
      "padding:0.8rem 1rem",
      "background:rgba(20,20,30,0.92)",
      "color:#fff",
      "border:1px solid #666",
      "border-radius:0.5rem",
      "font:14px/1.5 system-ui,sans-serif",
      "z-index:70",
      "display:none",
      "cursor:pointer",
    ].join(";");
    const text = document.createElement("div");
    text.dataset.testid = "dialogue-text";
    dialogue.appendChild(text);
    dialogue.addEventListener("pointerdown", () => this.advanceDialogue());
    this.uiRoot.appendChild(dialogue);
    this.dialogueEl = dialogue;
    this.domCleanup.push(() => {
      dialogue.remove();
      hud.remove();
    });

    const toast = document.createElement("div");
    toast.dataset.testid = "save-toast";
    toast.style.cssText = [
      "position:fixed",
      "bottom:1rem",
      "left:50%",
      "transform:translateX(-50%)",
      "padding:0.4rem 0.8rem",
      "background:rgba(0,0,0,0.7)",
      "color:#7f7",
      "font:12px/1.4 monospace",
      "z-index:80",
      "opacity:0",
      "transition:opacity 0.3s",
    ].join(";");
    this.uiRoot.appendChild(toast);
    this.saveToastEl = toast;
    this.domCleanup.push(() => toast.remove());
  }

  private heartsLabel(): string {
    const filled = Math.max(0, Math.min(PLAYER_MAX_HP, this.hp));
    return `${"♥".repeat(filled)}${"♡".repeat(PLAYER_MAX_HP - filled)}`;
  }

  private advanceDialogue(): void {
    if (this.dialogueQueue.length === 0) {
      return;
    }
    this.dialogueQueue.shift();
    this.renderDialogue();
  }

  private closeDialogue(): void {
    this.dialogueQueue.length = 0;
    this.renderDialogue();
  }

  private renderDialogue(): void {
    if (this.dialogueEl === null) {
      return;
    }
    const text = this.dialogueQueue[0] ?? null;
    const textEl = this.dialogueEl.querySelector('[data-testid="dialogue-text"]');
    if (textEl !== null) {
      textEl.textContent = text;
    }
    this.dialogueEl.style.display = text === null ? "none" : "block";
  }

  private updateHud(): void {
    if (this.hud === null) {
      return;
    }
    const pos = this.playerPosition;
    const label = `${pos.x},${pos.y}`;
    if (this.hud.position.textContent !== label) {
      this.hud.position.textContent = label;
    }
    const hearts = this.heartsLabel();
    if (this.hud.status.textContent !== hearts) {
      this.hud.status.textContent = hearts;
    }
    const gold = `gold: ${this.state.getVariable("gold")}`;
    if (this.hud.gold.textContent !== gold) {
      this.hud.gold.textContent = gold;
    }
    const objective = this.objectiveText();
    if (this.hud.objective.textContent !== objective) {
      this.hud.objective.textContent = objective;
    }
  }

  /**
   * Current objective text (demo content), driven by the story switches so the
   * player always knows the next goal (guidance, feedback item 7).
   */
  private objectiveText(): string {
    if (this.state.getSwitch("sw_boss_defeated")) {
      return "任务:北关已照亮 —— THE END(按 F5 存档后可重新开始)";
    }
    if (this.state.getSwitch("sw_wilds_cleared")) {
      return "任务:向东进入要塞,击败哨兵,点亮烽火";
    }
    return "任务:先和村里的长老对话,再向北穿过荒野,点亮北关的烽火";
  }

  private showToast(text: string): void {
    if (this.saveToastEl === null) {
      return;
    }
    this.saveToastEl.textContent = text;
    this.saveToastEl.style.opacity = "1";
    setTimeout(() => {
      if (this.saveToastEl !== null) {
        this.saveToastEl.style.opacity = "0";
      }
    }, 1200);
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  private renderPosition(): Vec2 {
    const transform = this.playerTransform;
    if (transform === null) {
      return { x: 0, y: 0 };
    }
    if (this.step !== null) {
      const t = this.step.t;
      return {
        x: this.step.from.x + (this.step.to.x - this.step.from.x) * t,
        y: this.step.from.y + (this.step.to.y - this.step.from.y) * t,
      };
    }
    return { x: transform.x, y: transform.y };
  }

  private renderScene(): void {
    const renderer = this.renderer;
    const tileSize = this.world.tilesets.length > 0 ? this.chunkTileSize() : 16;
    const chunkPx = this.world.chunkSize * tileSize;
    const worldPx = {
      x: this.world.grid.cols * chunkPx,
      y: this.world.grid.rows * chunkPx,
    };

    const viewW = Math.max(1, Math.round(this.canvas.width / CAMERA_ZOOM));
    const viewH = Math.max(1, Math.round(this.canvas.height / CAMERA_ZOOM));
    renderer.beginFrame();
    // Zoomed world camera (playtest feedback: the character was too small).
    // The top-left is rounded to whole WORLD pixels so integer zoom keeps
    // every rect on integer screen pixels - no shimmer, no seams.
    renderer.setCamera(
      {
        x: Math.round(this.cameraX ?? 0),
        y: Math.round(this.cameraY ?? 0),
        width: viewW,
        height: viewH,
      },
      CAMERA_ZOOM,
    );
    renderer.drawRect(0, 0, worldPx.x, worldPx.y, "#22332a");

    if (this.tilesets !== undefined && isTileMapRenderer(renderer)) {
      const tilemap = renderer as TileMapRenderer;
      if (!this.tilesetsRegistered) {
        this.tilesetsRegistered = true;
        for (const tileset of this.tilesets.values()) {
          tilemap.registerTileset(tileset);
        }
      }
      for (const chunkId of this.chunkStore.residentIds()) {
        const chunk = this.chunkStore.getWorldChunk(chunkId);
        const map = this.chunkStore.getChunk(chunkId);
        if (chunk === null || map === null) {
          continue;
        }
        const ox = chunk.col * chunkPx;
        const oy = chunk.row * chunkPx;
        renderer.pushTransform({
          translateX: ox,
          translateY: oy,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        });
        renderer.drawRect(0, 0, chunkPx, chunkPx, "#22332a");
        for (const layer of map.layers) {
          if (isColliderLayer(layer)) {
            continue;
          }
          tilemap.drawTileLayer(layer, map.tileset, tileSize);
        }
        // Solid tiles: the ground atlas already paints water (liquid) and
        // rock/masonry (walls) distinctly, so only a bright crest is added on
        // wall-face tiles (solid with an open tile above) — water stays bare.
        const grid = this.grids.get(chunkId);
        if (grid !== undefined) {
          const groundData = this.groundLayerOf(map);
          for (let ly = 0; ly < map.height; ly++) {
            for (let lx = 0; lx < map.width; lx++) {
              if (!grid.isSolid(lx, ly)) {
                continue;
              }
              if (
                groundData !== undefined &&
                groundData[ly]?.[lx] === GROUND_WATER &&
                !grid.isSolid(lx, ly - 1)
              ) {
                continue; // open water reads as impassable on its own
              }
              if (!grid.isSolid(lx, ly - 1)) {
                // Wall crest: the top-facing edge of a solid run.
                renderer.drawRect(
                  lx * tileSize,
                  ly * tileSize,
                  tileSize,
                  Math.max(2, Math.round(tileSize * 0.22)),
                  WALL_CREST,
                );
              }
            }
          }
        }

        // Event props (signposts, chests, beacons) — drawn inside this chunk's
        // transform using chunk-local coordinates.
        for (const event of map.events) {
          if (event.sprite !== undefined) {
            continue; // blocking NPCs draw in the global NPC pass below
          }
          const ex = event.x * tileSize;
          const ey = event.y * tileSize;
          switch (event.name.toLowerCase()) {
            case "signpost":
              drawSignpost(renderer, ex, ey, tileSize);
              break;
            case "chest":
              drawChest(renderer, ex, ey, tileSize);
              break;
            case "beacon":
              drawBeacon(renderer, ex, ey, tileSize, this.state.getSwitch("sw_boss_defeated"));
              break;
            default:
              break; // unknown sprite-less events stay invisible (as before)
          }
        }
        renderer.popTransform();
      }
    }

    // NPCs (global coordinates, no transform): villagers as little people,
    // tinted by their sprite role ("characters/elder" → elder tunic).
    for (const blocker of this.blockByEntity.values()) {
      const t = blocker.getComponent("transform");
      if (t === null) {
        continue;
      }
      const sprite = blocker.getComponent("sprite");
      drawVillager(
        renderer,
        t.x * tileSize,
        t.y * tileSize,
        tileSize,
        sprite?.texture ?? "characters/villager",
      );
    }

    // Combatants (ADR-009): chasers render as slimes, turrets as sentry
    // cannons; recently-hit ones flash white; turret cores telegraph the next
    // shot (drawn inside drawTurret).
    for (const enemy of this.combat.views()) {
      const flash = this.combat.flashOf(enemy.entityId) > 0;
      if (enemy.behavior === "turret") {
        drawTurret(
          renderer,
          enemy.x * tileSize,
          enemy.y * tileSize,
          tileSize,
          this.combat.chargeOf(enemy.entityId),
          flash,
        );
      } else {
        drawSlime(renderer, enemy.x * tileSize, enemy.y * tileSize, tileSize, flash);
      }
    }
    // Projectiles: bright red bolts (bigger than before) with a white core.
    for (const projectile of this.combat.projectiles()) {
      renderer.drawRect(
        projectile.x * tileSize + 2,
        projectile.y * tileSize + 2,
        tileSize - 4,
        tileSize - 4,
        "#ff5252",
      );
      renderer.drawRect(
        projectile.x * tileSize + tileSize / 2 - 2,
        projectile.y * tileSize + tileSize / 2 - 2,
        5,
        5,
        "#ffffff",
      );
    }

    // Sword slash mark on the facing tile while the swing is visible.
    if (this.swingFlash > 0 && this.swingDir !== null) {
      const v = DIRECTION_VECTORS[this.swingDir];
      const tx = Math.round(this.renderPosition().x) + v.x;
      const ty = Math.round(this.renderPosition().y) + v.y;
      renderer.drawRect(tx * tileSize, ty * tileSize, tileSize, tileSize, "#fff3b0");
    }

    // Player (red flash when hit, blink while the post-hit i-frames last):
    // a little hero sprite — tunic, sword hilt, face — plus the facing
    // chevron that always points where the player looks.
    const pos = this.renderPosition();
    const px = pos.x * tileSize;
    const py = pos.y * tileSize;
    const blink = this.playerIframes > 0 && Math.floor(this.playerIframes * 8) % 2 === 0;
    if (!blink) {
      drawHero(renderer, px, py, tileSize, { flashing: this.playerHitFlash > 0 });
      // Facing indicator: a small white chevron points where the player looks.
      const dir = this.playerDirection as InputDirection;
      const facing = DIRECTION_VECTORS[dir];
      const cx = px + tileSize / 2;
      const cy = py + tileSize / 2;
      if (facing.y === -1) {
        renderer.drawRect(cx - 2, py - 3, 5, 4, "#ffffff");
      } else if (facing.y === 1) {
        renderer.drawRect(cx - 2, py + tileSize - 1, 5, 4, "#ffffff");
      } else if (facing.x === -1) {
        renderer.drawRect(px - 3, cy - 2, 4, 5, "#ffffff");
      } else {
        renderer.drawRect(px + tileSize - 1, cy - 2, 4, 5, "#ffffff");
      }
    }

    // Death fade (black ramp while down; the respawn happens in update()).
    // Drawn in SCREEN space: reset the camera so the overlay covers the whole
    // canvas regardless of zoom/pan.
    if (this.dead) {
      renderer.setCamera({ x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }, 1);
      const alpha = Math.min(1, Math.max(0, (1.2 - this.deathTimer) / 1.2 + 0.05));
      renderer.drawRect(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        `rgba(0,0,0,${alpha.toFixed(3)})`,
      );
    }

    renderer.endFrame();
  }

  /** Tile size: the first registered tileset's (map documents share it). */
  private chunkTileSize(): number {
    const first = this.tilesets?.values().next().value;
    return (first as TilesetData | undefined)?.tileSize ?? 16;
  }

  /**
   * The first visible tile layer of a chunk map (the generator's "ground"
   * layer) — used to tell water solids from wall solids when drawing crests.
   */
  private groundLayerOf(map: { layers: ReadonlyArray<unknown> }): number[][] | undefined {
    for (const layer of map.layers) {
      const candidate = layer as { type?: string; data?: unknown };
      if (candidate.type === "tile" && Array.isArray(candidate.data)) {
        return candidate.data as number[][];
      }
    }
    return undefined;
  }

  /**
   * Camera follow: ease the zoomed view toward the player (in world pixels),
   * clamped to the world bounds so the void outside never shows.
   */
  private updateCamera(dt: number): void {
    const tile = this.chunkTileSize();
    const viewW = this.canvas.width / CAMERA_ZOOM;
    const viewH = this.canvas.height / CAMERA_ZOOM;
    const worldW = this.world.grid.cols * this.world.chunkSize * tile;
    const worldH = this.world.grid.rows * this.world.chunkSize * tile;
    const pos = this.renderPosition();
    let targetX = pos.x * tile - viewW / 2;
    let targetY = pos.y * tile - viewH / 2;
    targetX =
      worldW <= viewW ? (worldW - viewW) / 2 : Math.min(Math.max(targetX, 0), worldW - viewW);
    targetY =
      worldH <= viewH ? (worldH - viewH) / 2 : Math.min(Math.max(targetY, 0), worldH - viewH);
    if (this.cameraX === null || this.cameraY === null) {
      this.cameraX = targetX;
      this.cameraY = targetY;
      return;
    }
    const alpha = Math.min(1, dt * CAMERA_LERP_RATE);
    this.cameraX += (targetX - this.cameraX) * alpha;
    this.cameraY += (targetY - this.cameraY) * alpha;
  }

  /** Snap the camera back onto the player (respawn / first frame). */
  private resetCamera(): void {
    this.cameraX = null;
    this.cameraY = null;
  }
}
