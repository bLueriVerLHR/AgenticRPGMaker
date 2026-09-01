/**
 * MapScene (P1c, Q6; docs/06-architecture.md §3/§7).
 *
 * The playable map scene: builds the scene graph from a core map document
 * (`SceneGraph.fromMap`), wires input → movement → collision → dialogue through
 * the shared core event bus, and renders through the `Renderer` interface.
 *
 * - **Movement**: grid/tile steps (tile units, per core Transform), sub-tile
 *   interpolation for smooth rendering.
 * - **Collision**: core Collider AABB vs map collider layers and solid NPC
 *   entities (`movement.ts`); blocked steps emit `collide` on the bus.
 * - **Dialogue**: confirm while facing an NPC runs the core event
 *   interpreter's active page (showText/setVariable/setSwitch/playSound/walk),
 *   and `dialogue` bus events are queued into a DOM dialogue box
 *   (advance/close with confirm). Task 23: the box anchors just above the
 *   speaker's on-screen tile (flips below near the screen top, clamped
 *   on-screen); with no anchor it falls back to the bottom-center spot.
 * - **Interaction targeting (task 19)**: the faced tile hits the event whose
 *   1x1 body at its LIVE transform position strictly overlaps it — the same
 *   rule collision uses — so a patrolling NPC is interactable from exactly the
 *   tiles it currently blocks (deterministic patrol + talk).
 * - **Choices**: a `showChoices` command opens a selectable option list
 *   (up/down to move, confirm to answer, cancel for `-1`); the chosen index is
 *   written into the prompt's variable so pages can branch on it (task 16).
 * - **Saves**: `save()`/`load()` via the Storage adapter (core `save` schema).
 * - **Network**: forwards local state (players only, D16) and renders remote
 *   players with interpolation.
 * - **Input**: keyboard (arrows/WASD + Z/Enter/Esc) and an on-screen D-pad +
 *   A/B for touch (JoiPlay, docs/08 §4.4).
 */
import type {
  BehaviorContext,
  BehaviorDecision,
  Direction,
  EventInterpreter,
  GameEventBus,
  GameObject,
  GameState,
  MapData,
  MapEvent,
  SaveData,
  SceneGraph,
  TileLayer,
  TilesetData,
  Transform,
  Vec2,
} from "@agenticrpg/core";
import { Collider, PLAYER_ENTITY_ID, type AABB } from "@agenticrpg/core";
import type { Renderer } from "@agenticrpg/renderer";
import { isTileMapRenderer } from "@agenticrpg/renderer";
import type { TileMapRenderer } from "@agenticrpg/renderer";

import { Input } from "./input.js";
import type { InputDirection } from "./input.js";
import { DIRECTION_VECTORS } from "./input.js";
import type { Logger } from "./logger.js";
import type { NetworkClient, RemotePlayer } from "./network-client.js";
import type { Scene, SceneContext } from "./scene.js";
import type { Storage } from "./storage.js";
import {
  buildCollisionGrid,
  checkStep,
  aabbsOverlapStrict,
  type SolidTileGrid,
} from "./movement.js";

/** Options for building a MapScene. */ export interface MapSceneOptions {
  map: MapData;
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  bus: GameEventBus;
  state: GameState;
  sceneGraph: SceneGraph;
  interpreter: EventInterpreter;
  storage: Storage;
  logger: Logger;
  /**
   * DOM root for the HUD, dialogue box, and virtual controls. Optional for
   * headless use (tests): when omitted no DOM is created and dialogue is
   * observable via `currentDialogueText` / the bus.
   */
  uiRoot?: HTMLElement;
  /**
   * Injected input. When omitted, keyboard + virtual controls are built from
   * `uiRoot` at enter (browser only).
   */
  input?: Input;
  /** Multiplayer client, or null for a single-player session. */
  network?: NetworkClient | null;
  /** Optional tilesets to draw tile layers (requires a TileMapRenderer). */
  tilesets?: ReadonlyMap<string, TilesetData>;
  /** Seconds per tile step. Default 0.15. */
  stepDuration?: number;
  /** Automatically load the latest save on enter. Default true. */
  autoLoad?: boolean;
}

/** A step in progress: from → to over `stepDuration` seconds. */
interface Step {
  from: Vec2;
  to: Vec2;
  t: number;
}

/**
 * A `showChoices` prompt awaiting the player's answer (task 16). The runtime
 * writes the chosen index into `variable` (or `-1` on cancel); pages branch on
 * that variable via variable conditions (task 15) on the NEXT interaction.
 */
interface ChoicePrompt {
  variable: string;
  options: string[];
  selected: number;
}

/** A queued dialogue line, with the speaker entity when known (task 23). */
export interface DialogueLine {
  text: string;
  speakerId?: string;
}

/** World-space camera snapshot used to anchor overlay boxes (task 23). */
export interface CameraView {
  viewport: { x: number; y: number; width: number; height: number };
  zoom: number;
}

/** A box's on-screen CSS rectangle (page coordinates, `position:fixed`). */
export interface CssRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Inputs for the pure dialogue placement math (task 23). */
export interface DialoguePlacementInput {
  /** The speaker's 1x1 body tile, world pixels. */
  tileWorld: AABB;
  camera: CameraView;
  /** Canvas backing-store size (`canvas.width`/`height`). */
  backing: { width: number; height: number };
  /** Canvas CSS size (`clientWidth`/`clientHeight`). */
  css: { width: number; height: number };
  /** Canvas CSS offset (`getBoundingClientRect()` left/top). */
  offset: { x: number; y: number };
  /** Dialogue box CSS size (`offsetWidth`/`offsetHeight`). */
  box: { width: number; height: number };
  /** Gap between the box and the speaker tile, CSS px. */
  gap: number;
}

/** Where to put an anchored dialogue box (task 23). */
export interface DialoguePlacement {
  /** Box top-left in page CSS px (the boxes are `position:fixed`). */
  left: number;
  top: number;
  /** False → no usable anchor; the caller keeps the screen-space fallback. */
  anchored: boolean;
  /** The anchor tile's on-screen CSS rect (set when `anchored`). */
  anchorRect?: CssRect;
}

/** Side margin kept between an anchored box and the canvas edge (CSS px). */
const DIALOGUE_EDGE_MARGIN_PX = 8;

/** Gap between an anchored box and the speaker tile (CSS px). */
const DIALOGUE_ANCHOR_GAP_PX = 8;

/**
 * Where a dialogue box goes for a given speaker (task 23): just above the
 * speaker's on-screen tile, flipping below it when there is no room on top,
 * clamped inside the canvas, in *page CSS px* (the canvas may be CSS-scaled
 * and centered, so backing px are converted with the CSS scale + rect offset).
 * Pure so it stays unit-testable in the node (DOM-less) test environment.
 */
export function computeDialoguePlacement(input: DialoguePlacementInput): DialoguePlacement {
  const { tileWorld, camera, backing, css, offset, box, gap } = input;
  const degenerate: DialoguePlacement = { left: offset.x, top: offset.y, anchored: false };
  if (
    backing.width <= 0 ||
    backing.height <= 0 ||
    css.width <= 0 ||
    css.height <= 0 ||
    camera.zoom <= 0
  ) {
    return degenerate;
  }
  const scaleX = css.width / backing.width;
  const scaleY = css.height / backing.height;
  // Anchor points in backing px (world → viewport-relative → × zoom)...
  const anchorX = (tileWorld.x + tileWorld.width / 2 - camera.viewport.x) * camera.zoom;
  const tileLeft = (tileWorld.x - camera.viewport.x) * camera.zoom;
  const tileRight = (tileWorld.x + tileWorld.width - camera.viewport.x) * camera.zoom;
  const tileTop = (tileWorld.y - camera.viewport.y) * camera.zoom;
  const tileBottom = (tileWorld.y + tileWorld.height - camera.viewport.y) * camera.zoom;
  // The speaker must be fully on screen — a box clamped to an edge pointing
  // at nothing reads worse than the plain fallback.
  if (anchorX < 0 || anchorX > backing.width || tileTop < 0 || tileBottom > backing.height) {
    return degenerate;
  }
  // ...then to page CSS px.
  const anchorCssX = offset.x + anchorX * scaleX;
  const topCss = offset.y + tileTop * scaleY;
  const bottomCss = offset.y + tileBottom * scaleY;

  const margin = DIALOGUE_EDGE_MARGIN_PX;
  const maxLeft = offset.x + css.width - box.width - margin;
  const left =
    maxLeft >= offset.x + margin
      ? Math.min(Math.max(anchorCssX - box.width / 2, offset.x + margin), maxLeft)
      : offset.x;

  const above = topCss - gap - box.height;
  let top: number;
  if (above >= offset.y + margin) {
    top = above; // preferred: above the speaker's head
  } else {
    const below = bottomCss + gap; // flip below the tile near the screen top
    top =
      below + box.height + margin <= offset.y + css.height
        ? below
        : Math.min(
            Math.max(above, offset.y),
            Math.max(offset.y, offset.y + css.height - box.height),
          );
  }
  return {
    left,
    top,
    anchored: true,
    anchorRect: {
      left: offset.x + tileLeft * scaleX,
      top: topCss,
      right: offset.x + tileRight * scaleX,
      bottom: bottomCss,
    },
  };
}

/** Held-key repeat delay for continuous movement (seconds). */
const REPEAT_DELAY_SECONDS = 0.25;

/** The scene's on-screen HUD (DOM overlay). */
interface HudElements {
  root: HTMLElement;
  position: HTMLElement;
  status: HTMLElement;
  backend: HTMLElement;
}

export class MapScene implements Scene {
  readonly id = "map";

  private readonly map: MapData;
  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly bus: GameEventBus;
  private readonly state: GameState;
  private readonly sceneGraph: SceneGraph;
  private readonly interpreter: EventInterpreter;
  private readonly storage: Storage;
  private readonly logger: Logger;
  private readonly uiRoot: HTMLElement | null;
  private readonly network: NetworkClient | null;
  private readonly tilesets: ReadonlyMap<string, TilesetData> | undefined;
  private readonly stepDuration: number;
  private readonly autoLoad: boolean;
  private readonly injectedInput: Input | null;

  private readonly grid: SolidTileGrid;
  private readonly npcBlockers: GameObject[] = [];
  /** Per-entity behavior elapsed seconds (task 09; feeds `BehaviorContext.elapsed`). */
  private readonly behaviorElapsed = new Map<string, number>();
  /**
   * Renderable (sprite) and behavior entities, resolved ONCE at scene entry
   * (task 12): map events are static after load — behaviors move entities,
   * they never add/remove sprite/behavior components — so the per-frame
   * `findEntitiesByComponent` tree walk + array allocation is avoided.
   */
  private spriteEntities: GameObject[] = [];
  private behaviorEntities: GameObject[] = [];

  private input: Input | null = null;
  private step: Step | null = null;
  private lastStepDir: InputDirection | null = null;
  private transferEventIds: string[] = [];
  private repeatAccum = 0;
  private dialogueQueue: DialogueLine[] = [];
  /** Last line's speaker, remembered so a choice box can anchor too (task 23). */
  private lastDialogueSpeakerId: string | null = null;
  /** Camera snapshot from the last rendered frame (dialogue anchoring, task 23). */
  private cameraView: CameraView | null = null;
  /** Whether the dialogue box currently sits above the speaker (task 23). */
  private dialogueAnchored = false;
  /** The anchor tile's on-screen rect while anchored (task 23, tests/E2E). */
  private speakerAnchorCss: CssRect | null = null;
  /** Last style signature written per overlay box (cached writes, task 23). */
  private readonly boxStyleKeys = new WeakMap<HTMLElement, string>();
  private dialogueEl: HTMLElement | null = null;
  private pendingChoice: ChoicePrompt | null = null;
  private choiceEl: HTMLElement | null = null;
  private hud: HudElements | null = null;
  private saveToastEl: HTMLElement | null = null;
  private entered = false;

  private readonly busUnsubscribers: Array<() => void> = [];
  private readonly domCleanup: Array<() => void> = [];

  constructor(options: MapSceneOptions) {
    this.map = options.map;
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.bus = options.bus;
    this.state = options.state;
    this.sceneGraph = options.sceneGraph;
    this.interpreter = options.interpreter;
    this.storage = options.storage;
    this.logger = options.logger;
    this.uiRoot = options.uiRoot ?? null;
    this.injectedInput = options.input ?? null;
    this.network = options.network ?? null;
    this.tilesets = options.tilesets;
    this.stepDuration = options.stepDuration ?? 0.15;
    this.autoLoad = options.autoLoad ?? true;

    this.grid = buildCollisionGrid(this.map);
    this.collectNpcBlockers();
  }

  // ------------------------------------------------------------------
  // Scene lifecycle
  // ------------------------------------------------------------------

  enter(_context: SceneContext): void {
    if (this.entered) {
      return;
    }
    this.entered = true;
    // Door markers (task 22): events whose pages contain a transfer — the
    // map is static during a scene life, so resolve the list once.
    this.transferEventIds = this.map.events
      .filter((event) =>
        event.pages.some((page) => page.commands.some((line) => line.cmd === "transfer")),
      )
      .map((event) => event.id);
    // Resolve the entity lists once (task 12): map events are static during a
    // scene life, so sprite/behavior lookups are cached instead of re-walking
    // the whole tree every frame.
    this.spriteEntities = this.sceneGraph.findEntitiesByComponent("sprite");
    this.behaviorEntities = this.sceneGraph.findEntitiesByComponent("behavior");
    this.addNpcColliders();
    this.addBusSubscriptions();
    this.createUi();
    this.createInput();
    this.logger.info("scene: map entered", {
      map: this.map.id,
      events: this.map.events.length,
      network: this.network !== null ? "online" : "offline",
      headless: this.uiRoot === null,
    });
    if (this.autoLoad) {
      void this.load().then((loaded) => {
        if (loaded) {
          this.logger.info("scene: auto-loaded save", { mapId: this.map.id });
        }
      });
    }
  }

  update(dt: number): void {
    this.advanceStep(dt);
    if (this.pendingChoice !== null) {
      // While a choice is open, input routes to the choice list and
      // movement/dialogue are frozen (task 16).
      this.handleChoiceInput();
    } else {
      this.handleMovement(dt);
      this.handleConfirm();
      this.handleCancel();
    }
    this.updateBehaviors(dt);
    this.network?.update(dt);
    if (this.network !== null) {
      this.sendLocalState();
    }
    this.updateHud();
  }

  /**
   * Choice-list input (task 16): up/down wrap the selection, confirm writes
   * the selected index into the prompt's variable, cancel writes `-1`.
   */
  private handleChoiceInput(): void {
    const prompt = this.pendingChoice;
    if (prompt === null) {
      return;
    }
    const edge = this.consumeDirectionEdge();
    if (edge === "up" || edge === "down") {
      const delta = edge === "up" ? -1 : 1;
      prompt.selected = (prompt.selected + delta + prompt.options.length) % prompt.options.length;
      this.renderChoice();
      return;
    }
    if (this.consumeConfirm()) {
      this.answerChoice(prompt.selected);
      return;
    }
    if (this.consumeCancel()) {
      this.answerChoice(-1);
    }
  }

  /** Writes the answer into the prompt's variable and closes the list. */
  private answerChoice(index: number): void {
    const prompt = this.pendingChoice;
    if (prompt === null) {
      return;
    }
    this.pendingChoice = null;
    this.state.setVariable(prompt.variable, index);
    this.renderChoice();
    this.logger.info("choice: answered", { variable: prompt.variable, index });
  }

  /**
   * Drives every entity that carries a behavior component (task 09, D24): the
   * declared strategy runs one tick and its decision is applied. Deterministic
   * given the same tick sequence (core guarantees strategy determinism).
   */
  private updateBehaviors(dt: number): void {
    for (const entity of this.behaviorEntities) {
      const component = entity.getComponent("behavior");
      if (component === null) {
        continue;
      }
      const elapsed = (this.behaviorElapsed.get(entity.id) ?? 0) + dt;
      this.behaviorElapsed.set(entity.id, elapsed);
      const ctx: BehaviorContext = {
        entity,
        bus: this.bus,
        state: this.state,
        dt,
        elapsed,
      };
      const decision = component.update(ctx);
      if (decision !== null) {
        this.applyBehaviorDecision(entity, decision);
      }
    }
  }

  /** Applies a behavior decision to the entity (move/face/say; idle = no-op). */
  private applyBehaviorDecision(entity: GameObject, decision: BehaviorDecision): void {
    const transform = entity.getComponent("transform");
    if (transform === null) {
      return;
    }
    switch (decision.action) {
      case "move":
        transform.translate(decision.dx ?? 0, decision.dy ?? 0);
        break;
      case "face":
        transform.setDirection(decision.direction ?? "down");
        break;
      case "say":
        if (decision.text !== undefined) {
          this.bus.emit("dialogue", { text: decision.text, speakerId: entity.id });
        }
        break;
      case "idle":
        break;
    }
  }

  render(_alpha: number): void {
    this.renderScene();
  }

  exit(): void {
    if (!this.entered) {
      return;
    }
    this.entered = false;
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
    this.dialogueQueue = [];
    this.lastDialogueSpeakerId = null;
    this.dialogueAnchored = false;
    this.speakerAnchorCss = null;
    this.pendingChoice = null;
    this.step = null;
    this.lastStepDir = null;
    this.repeatAccum = 0;
    this.logger.info("scene: map exited", { map: this.map.id });
  }

  // ------------------------------------------------------------------
  // Public accessors (HUD, E2E, save/load)
  // ------------------------------------------------------------------

  /** The player's current integer tile position. */
  get playerPosition(): Vec2 {
    const t = this.playerTransform;
    return t !== null ? { x: t.x, y: t.y } : { x: 0, y: 0 };
  }

  /** The player's current facing direction. */
  get playerDirection(): Direction {
    return this.playerTransform?.direction ?? "down";
  }

  /** True while a dialogue box is showing. */
  get isDialogueOpen(): boolean {
    return this.dialogueQueue.length > 0;
  }

  /** The current dialogue line (or null). */
  get currentDialogueText(): string | null {
    return this.dialogueQueue.length > 0 ? (this.dialogueQueue[0]?.text ?? null) : null;
  }

  /** The current line's speaker entity id (task 23), or null when unknown. */
  get currentDialogueSpeakerId(): string | null {
    return this.dialogueQueue[0]?.speakerId ?? null;
  }

  /**
   * Task 23: "speaker" while the dialogue box is anchored above the speaker's
   * on-screen tile, "fallback" otherwise (bottom-center placement — headless,
   * unknown/off-screen speaker).
   */
  get dialogueAnchorMode(): "speaker" | "fallback" {
    return this.dialogueEl !== null && this.dialogueAnchored ? "speaker" : "fallback";
  }

  /** The anchor tile's on-screen CSS rect while anchored, else null (task 23). */
  get speakerAnchorRect(): CssRect | null {
    return this.dialogueAnchorMode === "speaker" ? this.speakerAnchorCss : null;
  }

  /** True while a choice list is showing (task 16). */
  get isChoiceOpen(): boolean {
    return this.pendingChoice !== null;
  }

  /**
   * The faced interactable's event id (task 22 affordance hint) — null while
   * a dialogue/choice is open or the faced event has no active page. Same
   * task-19 live-body resolution as interaction itself.
   */
  get interactionHintEventId(): string | null {
    if (this.isDialogueOpen || this.isChoiceOpen) {
      return null;
    }
    const event = this.facedInteractable();
    if (event === null) {
      return null;
    }
    return this.interpreter.selectPage(event.pages) !== null ? event.id : null;
  }

  /** Ids of events whose pages contain a transfer (task 22 door markers). */
  get transferTileEventIds(): readonly string[] {
    return this.transferEventIds;
  }

  /** The open choice prompt (variable/options/selected), or null (headless tests). */
  get currentChoice(): { variable: string; options: string[]; selected: number } | null {
    return this.pendingChoice !== null
      ? {
          variable: this.pendingChoice.variable,
          options: [...this.pendingChoice.options],
          selected: this.pendingChoice.selected,
        }
      : null;
  }

  /** The scene's renderer backend label (HUD). */
  get backendLabel(): string {
    const backend = (this.renderer as { getBackend?: () => string }).getBackend?.();
    return backend ?? "unknown";
  }

  /**
   * Serialize the current session to the core `save` schema and persist it.
   * Returns false when no player/storage.
   */
  async save(): Promise<boolean> {
    const transform = this.playerTransform;
    if (transform === null) {
      return false;
    }
    const snapshot = this.state.snapshot();
    const data: SaveData = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      mapId: this.map.id,
      player: {
        x: transform.x,
        y: transform.y,
        direction: transform.direction,
      },
      variables: snapshot.variables,
      switches: snapshot.switches,
    };
    await this.storage.save(data);
    this.showToast("saved");
    this.logger.info("save: written", {
      mapId: data.mapId,
      player: data.player,
      variables: Object.keys(data.variables).length,
      switches: Object.keys(data.switches).length,
    });
    return true;
  }

  /**
   * Load the latest save and restore player + variables/switches. Returns
   * false when there is no save, it is for a different map, or storage fails.
   */
  async load(): Promise<boolean> {
    const data = await this.storage.load();
    if (data === null) {
      return false;
    }
    if (data.mapId !== this.map.id) {
      this.logger.warn("load: save is for a different map; ignored", {
        saveMap: data.mapId,
        currentMap: this.map.id,
      });
      return false;
    }
    const transform = this.playerTransform;
    if (transform !== null) {
      transform.setPosition(data.player.x, data.player.y);
      transform.setDirection(data.player.direction);
    }
    this.state.load({ variables: data.variables, switches: data.switches });
    this.showToast("loaded");
    this.logger.info("load: applied", {
      mapId: data.mapId,
      player: data.player,
    });
    return true;
  }

  /** Trigger dialogue with the NPC being faced (used by tests/E2E). */
  interact(): boolean {
    return this.tryInteract();
  }

  // ------------------------------------------------------------------
  // Movement / collision / dialogue internals
  // ------------------------------------------------------------------

  private get playerTransform(): Transform | null {
    const entity = this.sceneGraph.getEntityById(PLAYER_ENTITY_ID);
    return entity?.getComponent("transform") ?? null;
  }

  private get playerCollider(): Collider | null {
    const entity = this.sceneGraph.getEntityById(PLAYER_ENTITY_ID);
    return entity?.getComponent("collider") ?? null;
  }

  private collectNpcBlockers(): void {
    this.npcBlockers.length = 0;
    for (const entity of this.sceneGraph.findEntitiesByComponent("collider")) {
      if (entity.id !== PLAYER_ENTITY_ID) {
        this.npcBlockers.push(entity);
      }
    }
  }

  private addNpcColliders(): void {
    for (const event of this.map.events) {
      if (event.sprite === undefined) {
        continue; // triggers have no body
      }
      const entity = this.sceneGraph.getEntityById(event.id);
      if (entity === null || entity.hasComponent("collider")) {
        continue;
      }
      entity.addComponent(
        new Collider({
          shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
          solid: true,
        }),
      );
      this.npcBlockers.push(entity);
    }
  }

  private addBusSubscriptions(): void {
    this.busUnsubscribers.push(
      this.bus.on("dialogue", (event) => {
        // Task 23: keep the speaker with the line — the interpreter emits the
        // actor event id, behaviors the entity id — so the box can anchor
        // above the speaker's on-screen tile instead of bottom-center.
        this.dialogueQueue.push({ text: event.text, speakerId: event.speakerId });
        if (event.speakerId !== undefined) {
          this.lastDialogueSpeakerId = event.speakerId;
        }
        this.renderDialogue();
        this.logger.debug("dialogue: queued", { text: event.text, speakerId: event.speakerId });
      }),
      this.bus.on("choice", (event) => {
        // The core declares the question only; the runtime shows the options
        // and answers by writing the variable (task 16).
        this.pendingChoice = { variable: event.variable, options: [...event.options], selected: 0 };
        this.renderChoice();
        this.logger.debug("choice: opened", { variable: event.variable });
      }),
      this.bus.on("sound", (event) => {
        this.logger.debug("sound: requested (no audio in MVP)", { ref: event.ref });
      }),
      this.bus.on("variable_changed", (event) => {
        this.logger.debug("variable_changed", {
          name: event.name,
          value: event.value,
          op: event.op,
        });
      }),
      this.bus.on("switch_changed", (event) => {
        this.logger.debug("switch_changed", {
          name: event.name,
          value: event.value,
        });
      }),
    );
  }

  private createUi(): void {
    if (this.uiRoot === null) {
      return; // headless (tests): no DOM, dialogue observable via the bus
    }
    // HUD
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
    status.dataset.testid = "hud-status";
    status.textContent = "online" in (this.network ?? {}) ? "" : "";
    status.textContent = this.network !== null ? "network: connecting" : "network: offline";
    const sep = (): HTMLElement => {
      const s = document.createElement("span");
      s.textContent = " · ";
      return s;
    };
    hud.append(backend, sep(), position, sep(), status);
    this.uiRoot.appendChild(hud);
    this.hud = { root: hud, position, status, backend };

    // Dialogue box
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

    // Choice list (task 16) — dialogue-box styling, one entry per option.
    const choice = document.createElement("div");
    choice.dataset.testid = "choice-box";
    choice.className = "agenticrpg-choice";
    choice.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:13rem",
      "transform:translateX(-50%)",
      "min-width:12rem",
      "padding:0.4rem 0.8rem",
      "background:rgba(20,20,30,0.92)",
      "color:#fff",
      "border:1px solid #888",
      "border-radius:0.5rem",
      "font:14px/1.5 system-ui,sans-serif",
      "z-index:70",
      "display:none",
    ].join(";");
    this.uiRoot.appendChild(choice);
    this.choiceEl = choice;
    this.domCleanup.push(() => choice.remove());

    // Save/load toast
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

  private createInput(): void {
    if (this.injectedInput !== null) {
      this.input = this.injectedInput;
      this.logger.debug("scene: using injected input");
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
        if (e.code === "KeyS") {
          void this.save();
        } else if (e.code === "KeyL") {
          void this.load();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      this.domCleanup.push(() => window.removeEventListener("keydown", onKeyDown));
    }
  }

  private virtualInput: Input | null = null;

  private currentDirection(): InputDirection | null {
    const primary = this.input?.direction ?? null;
    return primary ?? this.virtualInput?.direction ?? null;
  }

  private consumeDirectionEdge(): InputDirection | null {
    const edge = this.input?.consumeDirectionEdge() ?? null;
    if (edge !== null) {
      return edge;
    }
    return this.virtualInput?.consumeDirectionEdge() ?? null;
  }

  private consumeConfirm(): boolean {
    if (this.input?.consumeConfirm() === true) {
      return true;
    }
    return this.virtualInput?.consumeConfirm() === true;
  }

  private consumeCancel(): boolean {
    if (this.input?.consumeCancel() === true) {
      return true;
    }
    return this.virtualInput?.consumeCancel() === true;
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
    }
  }

  /**
   * Movement is edge-triggered: one step per direction press (keyboard key,
   * D-pad tap). Holding a direction repeats steps so hold-to-walk works
   * (grid/tile movement, Q6). Task 22 feel fix: the repeat delay gates only
   * the FIRST repeat of a held direction (tap/hold disambiguation) and time
   * keeps accumulating while a step animates — after that, steps chain
   * back-to-back at `stepDuration` cadence. Before, every held step paid the
   * full 0.25 s delay again, making held walking visibly stuttery.
   */
  private handleMovement(dt: number): void {
    if (this.isDialogueOpen) {
      return;
    }
    const edge = this.step === null ? this.consumeDirectionEdge() : null;
    if (edge !== null) {
      this.lastStepDir = edge;
      this.repeatAccum = 0;
      this.tryStep(edge);
      return;
    }
    const held = this.currentDirection();
    if (held === null) {
      this.repeatAccum = 0;
      this.lastStepDir = null;
      return;
    }
    if (held !== this.lastStepDir) {
      // Direction changed while held (e.g. right → down with both keys down):
      // start moving in the new direction immediately.
      this.lastStepDir = held;
      this.repeatAccum = 0;
      if (this.step === null) {
        this.tryStep(held);
      }
      return;
    }
    // Same direction still held — accumulate through the step animation too.
    this.repeatAccum += dt;
    if (this.repeatAccum >= REPEAT_DELAY_SECONDS && this.step === null) {
      this.tryStep(held);
    }
  }

  private tryStep(direction: InputDirection): void {
    const transform = this.playerTransform;
    if (transform === null) {
      return;
    }
    const vector = DIRECTION_VECTORS[direction];
    const from = { x: transform.x, y: transform.y };
    const to = { x: from.x + vector.x, y: from.y + vector.y };

    transform.setDirection(direction as Direction);

    const result = checkStep({
      from,
      to,
      grid: this.grid,
      blockers: this.npcBlockers,
      selfId: PLAYER_ENTITY_ID,
      collider: this.playerCollider ?? undefined,
    });
    if (result.blocked) {
      this.bus.emit("collide", {
        entityId: PLAYER_ENTITY_ID,
        otherId: result.blockerId ?? "map",
        blocked: true,
      });
      this.logger.debug("movement: blocked", { from, to, by: result.blockerId });
      return;
    }
    this.step = { from, to, t: 0 };
    this.bus.emit("walk", { entityId: PLAYER_ENTITY_ID, from, to });
    this.logger.debug("movement: step", { from, to });
  }

  private handleConfirm(): void {
    if (!this.consumeConfirm()) {
      return;
    }
    if (this.isDialogueOpen) {
      this.advanceDialogue();
      return;
    }
    if (this.step !== null) {
      return;
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
    const line = this.dialogueQueue[0];
    const text = line?.text ?? null;
    const textEl = this.dialogueEl.querySelector('[data-testid="dialogue-text"]');
    if (textEl !== null) {
      textEl.textContent = text;
    }
    this.dialogueEl.style.display = text === null ? "none" : "block";
    this.layoutDialogueBoxes();
  }

  /** Renders the open choice list (or hides it when none is pending; task 16). */
  private renderChoice(): void {
    if (this.choiceEl === null) {
      return;
    }
    this.choiceEl.replaceChildren();
    const prompt = this.pendingChoice;
    if (prompt === null) {
      this.choiceEl.style.display = "none";
      return;
    }
    prompt.options.forEach((option, index) => {
      const entry = document.createElement("div");
      entry.dataset.testid = "choice-option";
      entry.dataset.index = String(index);
      entry.textContent = `${index === prompt.selected ? "▶" : "　"} ${option}`;
      this.choiceEl?.appendChild(entry);
    });
    this.choiceEl.style.display = "block";
    this.layoutDialogueBoxes();
  }

  // ------------------------------------------------------------------
  // Overlay placement (task 23): anchor dialogue above the speaker
  // ------------------------------------------------------------------

  /**
   * Repositions the dialogue and choice boxes. Called when a line/choice
   * opens AND every rendered frame — NPC behaviors can move a speaker while
   * a dialogue is open, and box sizes change per line. Style writes are
   * cached, so an unchanged placement costs one read and no writes.
   */
  private layoutDialogueBoxes(): void {
    const dialogueOpen = this.isDialogueOpen;
    const choiceOpen = this.isChoiceOpen;
    const atRest = (el: HTMLElement | null): boolean =>
      el === null || this.boxStyleKeys.get(el) === "fallback";
    if (!dialogueOpen && !choiceOpen && atRest(this.dialogueEl) && atRest(this.choiceEl)) {
      return; // closed and parked at the fallback spot — nothing to do
    }
    if (this.dialogueEl !== null) {
      this.placeDialogueBox();
    }
    if (this.choiceEl !== null) {
      this.placeChoiceBox(dialogueOpen);
    }
  }

  private placeDialogueBox(): void {
    const el = this.dialogueEl;
    if (el === null) {
      return;
    }
    const placement = this.speakerPlacement(this.currentDialogueSpeakerId, el);
    this.applyBoxPlacement(el, placement, "10rem");
    this.dialogueAnchored = placement.anchored;
    this.speakerAnchorCss = placement.anchorRect ?? null;
  }

  /**
   * The choice box follows the dialogue (task 23): stacked just above it —
   * today's relative order — while a dialogue is open; a choice with no
   * dialogue open anchors to the last speaker's tile itself. No anchor →
   * fallback (bottom-center, `bottom:13rem`).
   */
  private placeChoiceBox(dialogueOpen: boolean): void {
    const el = this.choiceEl;
    if (el === null) {
      return;
    }
    let placement: DialoguePlacement = { left: 0, top: 0, anchored: false };
    const dialogue = this.dialogueEl;
    if (dialogueOpen && dialogue !== null && this.dialogueAnchored) {
      const rect = this.canvasRect();
      const dRect = dialogue.getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const margin = DIALOGUE_EDGE_MARGIN_PX;
      const maxLeft = rect.left + this.canvas.clientWidth - width - margin;
      const left =
        maxLeft >= rect.left + margin
          ? Math.min(
              Math.max(dRect.left + dRect.width / 2 - width / 2, rect.left + margin),
              maxLeft,
            )
          : rect.left;
      const top = Math.max(rect.top + margin, dRect.top - DIALOGUE_ANCHOR_GAP_PX - height);
      placement = { left, top, anchored: true };
    } else {
      placement = this.speakerPlacement(this.lastDialogueSpeakerId, el);
    }
    this.applyBoxPlacement(el, placement, "13rem");
  }

  /** Placement of a box anchored to a speaker entity's tile (task 23). */
  private speakerPlacement(speakerId: string | null, el: HTMLElement): DialoguePlacement {
    const tileWorld = speakerId !== null ? this.speakerTileWorld(speakerId) : null;
    if (tileWorld === null || this.cameraView === null) {
      return { left: 0, top: 0, anchored: false };
    }
    const rect = this.canvasRect();
    return computeDialoguePlacement({
      tileWorld,
      camera: this.cameraView,
      backing: { width: this.canvas.width, height: this.canvas.height },
      css: { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
      offset: { x: rect.left, y: rect.top },
      box: { width: el.offsetWidth, height: el.offsetHeight },
      gap: DIALOGUE_ANCHOR_GAP_PX,
    });
  }

  /** The speaker's 1x1 body tile in world px (task-19 live-transform rule). */
  private speakerTileWorld(speakerId: string): AABB | null {
    const transform = this.sceneGraph.getEntityById(speakerId)?.getComponent("transform") ?? null;
    if (transform === null) {
      return null;
    }
    const tileSize = this.map.tileSize;
    return {
      x: Math.round(transform.x) * tileSize,
      y: Math.round(transform.y) * tileSize,
      width: tileSize,
      height: tileSize,
    };
  }

  private canvasRect(): { left: number; top: number } {
    // Guarded: JoiPlay-type WebViews and test stubs may lack the API.
    const rect =
      typeof this.canvas.getBoundingClientRect === "function"
        ? this.canvas.getBoundingClientRect()
        : { left: 0, top: 0 };
    return { left: rect.left, top: rect.top };
  }

  /** Writes a placement into the box's style; fallback restores today's CSS. */
  private applyBoxPlacement(
    el: HTMLElement,
    placement: DialoguePlacement,
    fallbackBottom: string,
  ): void {
    const key = placement.anchored
      ? `anchor:${placement.left.toFixed(1)},${placement.top.toFixed(1)}`
      : "fallback";
    if (this.boxStyleKeys.get(el) === key) {
      return;
    }
    this.boxStyleKeys.set(el, key);
    if (placement.anchored) {
      el.style.left = `${placement.left}px`;
      el.style.top = `${placement.top}px`;
      el.style.right = "";
      el.style.bottom = "";
      el.style.transform = "none";
    } else {
      el.style.left = "50%";
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = fallbackBottom;
      el.style.transform = "translateX(-50%)";
    }
  }

  private tryInteract(): boolean {
    const event = this.facedInteractable();
    if (event === null) {
      return false;
    }
    const result = this.interpreter.runEvent(event, { actorId: event.id });
    if (result.ran) {
      this.logger.info("interaction: event ran", {
        event: event.id,
        page: result.page !== null ? "selected" : "none",
        effects: result.effects.length,
      });
      return true;
    }
    this.logger.debug("interaction: event has no active page", { event: event.id });
    return true;
  }

  /**
   * The event the player is facing and could interact with, if any: first
   * event (authoring order) whose live body overlaps the faced tile.
   */
  private facedInteractable(): MapEvent | null {
    const transform = this.playerTransform;
    if (transform === null) {
      return null;
    }
    const vector = DIRECTION_VECTORS[transform.direction as InputDirection];
    const facing = { x: Math.round(transform.x) + vector.x, y: Math.round(transform.y) + vector.y };
    for (const event of this.map.events) {
      // Task 19: interaction follows the body. The faced tile hits when it
      // strictly overlaps the event's 1x1 body AABB at its LIVE transform
      // position — the same rule `checkStep()` applies to solid bodies, so an
      // NPC is interactable from exactly the tiles it currently blocks, and
      // patrol + talk on one NPC is deterministic. Static events (triggers,
      // doors, crates) never move: their body stays at the authored tile, which
      // is byte-for-byte the previous exact-tile behavior.
      const body = this.eventBodyAABB(event);
      if (aabbsOverlapStrict({ x: facing.x, y: facing.y, width: 1, height: 1 }, body)) {
        return event;
      }
    }
    return null;
  }

  /**
   * The event's 1x1 body AABB at its live world position (task 19): behaviors
   * move the entity's transform, so the body — and with it interaction —
   * follows. Falls back to the authored tile when the scene has no entity for
   * the event (defensive; `SceneGraph.fromMap` builds one per event). Events
   * are tested in map authoring order and the first hit runs its page
   * (unchanged first-match semantics).
   */
  private eventBodyAABB(event: MapEvent): AABB {
    const transform = this.sceneGraph.getEntityById(event.id)?.getComponent("transform") ?? null;
    const x = transform !== null ? transform.x : event.x;
    const y = transform !== null ? transform.y : event.y;
    return { x, y, width: 1, height: 1 };
  }

  // ------------------------------------------------------------------
  // Network
  // ------------------------------------------------------------------

  private sendLocalState(): void {
    const transform = this.playerTransform;
    if (transform === null || this.network === null) {
      return;
    }
    this.network.setLocalState({
      x: transform.x,
      y: transform.y,
      direction: transform.direction,
      animation: this.step !== null ? "walk" : "idle",
    });
  }

  private remotePlayerPixel(player: RemotePlayer, tileSize: number): { x: number; y: number } {
    return { x: player.x * tileSize, y: player.y * tileSize };
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
    const tileSize = this.map.tileSize;
    const mapPx = { x: this.map.width * tileSize, y: this.map.height * tileSize };

    renderer.beginFrame();
    const viewport = this.computeCameraViewport(mapPx);
    renderer.setCamera(viewport, viewport.zoom);
    // Remembered for overlay anchoring (task 23): dialogue/choice boxes
    // convert world anchors through this exact viewport each frame.
    this.cameraView = { viewport, zoom: viewport.zoom };

    // Ground.
    renderer.drawRect(0, 0, mapPx.x, mapPx.y, "#22332a");

    // Optional tile layers (only when tilesets + TileMapRenderer available).
    if (this.tilesets !== undefined && isTileMapRenderer(renderer)) {
      const tilemap = renderer as TileMapRenderer;
      for (const tileset of this.tilesets.values()) {
        tilemap.registerTileset(tileset);
      }
      for (const layer of this.map.layers) {
        if (isColliderLayer(layer)) {
          continue;
        }
        tilemap.drawTileLayer(layer, this.map.tileset, tileSize);
      }
    }

    // Collider tiles (readable "can't walk here", task 22).
    this.drawColliders(renderer, viewport, tileSize);

    // Transfer tiles (task 22): mark doors/gates so exits are findable.
    for (const eventId of this.transferEventIds) {
      const entity = this.sceneGraph.getEntityById(eventId);
      const transform = entity?.getComponent("transform") ?? null;
      if (transform === null) {
        continue;
      }
      this.drawTransferMarker(renderer, Math.round(transform.x), Math.round(transform.y), tileSize);
    }

    // NPCs.
    this.drawNpcs(renderer, tileSize);

    // Remote players.
    if (this.network !== null) {
      for (const player of this.network.remotePlayers.values()) {
        const p = this.remotePlayerPixel(player, tileSize);
        renderer.drawRect(p.x, p.y, tileSize, tileSize, "#3b6fd8");
      }
    }

    // Player.
    const pos = this.renderPosition();
    const px = pos.x * tileSize;
    const py = pos.y * tileSize;
    renderer.drawRect(px, py, tileSize, tileSize, "#4caf50");
    renderer.drawRect(px + 2, py - 2, tileSize - 4, 2, "#c8e6c9");

    // Interaction affordance (task 22): a bobbing "!" above the faced
    // interactable, suppressed while a dialogue or choice is open.
    const hintEventId = this.interactionHintEventId;
    if (hintEventId !== null) {
      const entity = this.sceneGraph.getEntityById(hintEventId);
      const transform = entity?.getComponent("transform") ?? null;
      if (transform !== null) {
        const bob = 2 + Math.sin(Date.now() / 180) * 2;
        renderer.drawText(
          "!",
          transform.x * tileSize + tileSize / 2,
          transform.y * tileSize - 4 + bob,
          { color: "#ffecb3", font: "bold 14px system-ui, sans-serif", align: "center" },
        );
      }
    }

    // Overlay placement runs after the camera each frame (task 23): the
    // speaker may have moved (behaviors) and box sizes change per line.
    this.layoutDialogueBoxes();

    renderer.endFrame();
  }

  /**
   * Corner-bracket frame on a transfer tile (task 22): "this tile takes you
   * somewhere". Pulses gently so it reads as an affordance, not terrain.
   */
  private drawTransferMarker(renderer: Renderer, tx: number, ty: number, tileSize: number): void {
    const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 300);
    const inset = 2;
    const len = Math.max(3, Math.floor(tileSize / 4));
    const x = tx * tileSize + inset;
    const y = ty * tileSize + inset;
    const s = tileSize - inset * 2 - 1;
    const color = `rgba(255, 213, 79, ${pulse.toFixed(3)})`;
    // Four corner brackets.
    renderer.drawRect(x, y, len, 2, color);
    renderer.drawRect(x, y, 2, len, color);
    renderer.drawRect(x + s - len, y, len, 2, color);
    renderer.drawRect(x + s - 1, y, 2, len, color);
    renderer.drawRect(x, y + s - 1, len, 2, color);
    renderer.drawRect(x, y + s - len, 2, len, color);
    renderer.drawRect(x + s - len, y + s - 1, len, 2, color);
    renderer.drawRect(x + s - 1, y + s - len, 2, len, color);
  }

  private computeCameraViewport(mapPx: Vec2): {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
  } {
    // Integer zoom keeps pixels crisp under `image-rendering: pixelated`
    // (task 22): ~14 tiles visible vertically, clamped to a sane range. The
    // viewport shrinks by the zoom factor; the center-on-player + clamp below
    // is the camera follow.
    const zoom = this.computeCameraZoom();
    const width = (this.canvas.width > 0 ? this.canvas.width : 320) / zoom;
    const height = (this.canvas.height > 0 ? this.canvas.height : 240) / zoom;
    const pos = this.renderPosition();
    const tileSize = this.map.tileSize;
    let x = pos.x * tileSize - width / 2;
    let y = pos.y * tileSize - height / 2;
    x = clampCamera(x, width, mapPx.x);
    y = clampCamera(y, height, mapPx.y);
    return { x, y, width, height, zoom };
  }

  /** Integer camera zoom from the backing-store height (task 22). */
  private computeCameraZoom(): number {
    const height = this.canvas.height > 0 ? this.canvas.height : 240;
    const raw = Math.floor(height / (this.map.tileSize * 14));
    return Math.min(16, Math.max(2, raw));
  }

  private drawColliders(
    renderer: Renderer,
    viewport: { x: number; y: number; width: number; height: number },
    tileSize: number,
  ): void {
    const minX = Math.max(0, Math.floor(viewport.x / tileSize));
    const maxX = Math.min(this.map.width, Math.ceil((viewport.x + viewport.width) / tileSize));
    const minY = Math.max(0, Math.floor(viewport.y / tileSize));
    const maxY = Math.min(this.map.height, Math.ceil((viewport.y + viewport.height) / tileSize));
    for (let ty = minY; ty < maxY; ty++) {
      for (let tx = minX; tx < maxX; tx++) {
        if (this.grid.isSolid(tx, ty)) {
          // Readable "can't walk here" (task 22): a translucent dark fill so
          // the terrain stays visible, plus a solid edge border for contrast.
          renderer.drawRect(
            tx * tileSize,
            ty * tileSize,
            tileSize,
            tileSize,
            "rgba(10, 14, 12, 0.55)",
          );
          renderer.drawRect(tx * tileSize, ty * tileSize, tileSize, 1, "#0a0e0c");
          renderer.drawRect(tx * tileSize, ty * tileSize + tileSize - 1, tileSize, 1, "#0a0e0c");
          renderer.drawRect(tx * tileSize, ty * tileSize, 1, tileSize, "#0a0e0c");
          renderer.drawRect(tx * tileSize + tileSize - 1, ty * tileSize, 1, tileSize, "#0a0e0c");
        }
      }
    }
  }

  private drawNpcs(renderer: Renderer, tileSize: number): void {
    for (const entity of this.spriteEntities) {
      if (entity.id === PLAYER_ENTITY_ID) {
        continue;
      }
      const transform = entity.getComponent("transform");
      if (transform === null) {
        continue;
      }
      renderer.drawRect(
        transform.x * tileSize,
        transform.y * tileSize,
        tileSize,
        tileSize,
        "#c9a227",
      );
    }
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
    if (this.network !== null) {
      const state = this.network.connected ? "connected" : "connecting";
      if (this.hud.status.textContent !== `network: ${state}`) {
        this.hud.status.textContent = `network: ${state}`;
      }
    }
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
}

/** Whether a layer marks collider tiles (sample-map convention). */
function isColliderLayer(layer: TileLayer): boolean {
  return /collider/i.test(layer.id) || /collider/i.test(layer.name);
}

function clampCamera(value: number, view: number, map: number): number {
  if (view >= map) {
    return (map - view) / 2;
  }
  return Math.min(Math.max(value, 0), map - view);
}
