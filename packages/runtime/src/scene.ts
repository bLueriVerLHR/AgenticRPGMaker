/**
 * Scene/State management (P1c, docs/06-architecture.md §7 "Scene management").
 *
 * The State pattern: the game is always in exactly one `Scene` (map, dialogue,
 * menu, ...). A `SceneManager` owns lifecycle (enter/update/render/exit) and
 * delegates the frame to the current scene. Transitions are explicit
 * `change()` calls, keeping `update/render` delegated to the active scene with
 * no god-object game class.
 */
import type { GameEventBus, GameState } from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

/** The context a scene receives when it is entered (cross-scene services). */
export interface SceneContext {
  /** Shared gameplay event bus (ADR-001 wiring). */
  bus: GameEventBus;
  /** Shared variable/switch state. */
  state: GameState;
  /** Structured logger for the scene. */
  logger: Logger;
}

/** A playable scene state (ADR-001 State pattern). */
export interface Scene {
  /** Stable identifier, e.g. "map" or "menu". */
  readonly id: string;
  /** Called once when the scene becomes current. */
  enter(context: SceneContext): void;
  /** Advance the simulation by `dt` seconds (fixed step). */
  update(dt: number): void;
  /** Draw the frame with interpolation factor `alpha` in [0,1). */
  render(alpha: number): void;
  /** Called once when the scene stops being current. */
  exit(): void;
}

export interface SceneManagerOptions {
  logger?: Logger;
}

/**
 * Holds and switches scenes. Only the current scene receives update/render.
 * `change()` exits the current scene, enters the new one, then swaps.
 */
export class SceneManager {
  private readonly loggerValue: Logger;
  private currentValue: Scene | null = null;
  private contextValue: SceneContext;

  constructor(context: SceneContext, options: SceneManagerOptions = {}) {
    this.contextValue = context;
    this.loggerValue = options.logger ?? context.logger ?? createNoopLogger();
  }

  /** The current scene, or null before the first `change`. */
  get current(): Scene | null {
    return this.currentValue;
  }

  /** The context scenes receive on enter. */
  get context(): SceneContext {
    return this.contextValue;
  }

  /** The logger used by the manager. */
  get logger(): Logger {
    return this.loggerValue;
  }

  /** Exit the current scene and enter `next` (idempotent for the same scene). */
  change(next: Scene): void {
    if (next === this.currentValue) {
      return;
    }
    const previous = this.currentValue;
    previous?.exit();
    this.currentValue = next;
    next.enter(this.contextValue);
    if (previous !== null && previous !== next) {
      this.loggerValue.info("scene changed", { from: previous.id, to: next.id });
    } else {
      this.loggerValue.info("scene entered", { scene: next.id });
    }
  }

  /** Advances the current scene, if any. */
  update(dt: number): void {
    this.currentValue?.update(dt);
  }

  /** Renders the current scene, if any. */
  render(alpha: number): void {
    this.currentValue?.render(alpha);
  }

  /** Exits the current scene and clears the manager. */
  clear(): void {
    this.currentValue?.exit();
    this.currentValue = null;
  }
}
