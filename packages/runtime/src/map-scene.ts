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
 *   (advance/close with confirm).
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
import { Collider, PLAYER_ENTITY_ID } from "@agenticrpg/core";
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
import { buildCollisionGrid, checkStep, type SolidTileGrid } from "./movement.js";

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
  private readonly eventById = new Map<string, MapEvent>();
  /** Per-entity behavior elapsed seconds (task 09; feeds `BehaviorContext.elapsed`). */
  private readonly behaviorElapsed = new Map<string, number>();

  private input: Input | null = null;
  private step: Step | null = null;
  private lastStepDir: InputDirection | null = null;
  private repeatAccum = 0;
  private dialogueQueue: string[] = [];
  private dialogueEl: HTMLElement | null = null;
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
    for (const event of this.map.events) {
      this.eventById.set(event.id, event);
    }
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
    this.handleMovement(dt);
    this.handleConfirm();
    this.handleCancel();
    this.updateBehaviors(dt);
    this.network?.update(dt);
    if (this.network !== null) {
      this.sendLocalState();
    }
    this.updateHud();
  }

  /**
   * Drives every entity that carries a behavior component (task 09, D24): the
   * declared strategy runs one tick and its decision is applied. Deterministic
   * given the same tick sequence (core guarantees strategy determinism).
   */
  private updateBehaviors(dt: number): void {
    for (const entity of this.sceneGraph.findEntitiesByComponent("behavior")) {
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
    return this.dialogueQueue.length > 0 ? this.dialogueQueue[0]! : null;
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
        this.dialogueQueue.push(event.text);
        this.renderDialogue();
        this.logger.debug("dialogue: queued", { text: event.text });
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
   * D-pad tap). Holding a direction repeats steps after `repeatDelay` seconds
   * so hold-to-walk also works (grid/tile movement, Q6).
   */
  private handleMovement(dt: number): void {
    if (this.isDialogueOpen || this.step !== null) {
      return;
    }
    const edge = this.consumeDirectionEdge();
    if (edge !== null) {
      this.lastStepDir = edge;
      this.repeatAccum = 0;
      this.tryStep(edge);
      return;
    }
    const held = this.currentDirection();
    if (held !== null && held === this.lastStepDir && this.repeatAccum >= REPEAT_DELAY_SECONDS) {
      this.repeatAccum = 0;
      this.tryStep(held);
      return;
    }
    if (held !== null && held !== this.lastStepDir) {
      this.repeatAccum = 0;
    }
    if (held !== null) {
      this.repeatAccum += dt;
    } else {
      this.repeatAccum = 0;
      this.lastStepDir = null;
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
    const text = this.dialogueQueue[0] ?? null;
    const textEl = this.dialogueEl.querySelector('[data-testid="dialogue-text"]');
    if (textEl !== null) {
      textEl.textContent = text;
    }
    this.dialogueEl.style.display = text === null ? "none" : "block";
  }

  private tryInteract(): boolean {
    const transform = this.playerTransform;
    if (transform === null) {
      return false;
    }
    const vector = DIRECTION_VECTORS[transform.direction as InputDirection];
    const facing = { x: Math.round(transform.x) + vector.x, y: Math.round(transform.y) + vector.y };
    for (const event of this.eventById.values()) {
      if (event.x === facing.x && event.y === facing.y) {
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
    }
    return false;
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
    renderer.setCamera(viewport, 1);

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

    // Collider tiles (visible debug aid).
    this.drawColliders(renderer, viewport, tileSize);

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

    renderer.endFrame();
  }

  private computeCameraViewport(mapPx: Vec2): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const width = this.canvas.width > 0 ? this.canvas.width : 320;
    const height = this.canvas.height > 0 ? this.canvas.height : 240;
    const pos = this.renderPosition();
    const tileSize = this.map.tileSize;
    let x = pos.x * tileSize - width / 2;
    let y = pos.y * tileSize - height / 2;
    x = clampCamera(x, width, mapPx.x);
    y = clampCamera(y, height, mapPx.y);
    return { x, y, width, height };
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
          renderer.drawRect(tx * tileSize, ty * tileSize, tileSize, tileSize, "#1a2a1f");
        }
      }
    }
  }

  private drawNpcs(renderer: Renderer, tileSize: number): void {
    for (const entity of this.sceneGraph.findEntitiesByComponent("sprite")) {
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
