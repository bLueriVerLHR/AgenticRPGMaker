/**
 * NPC behavior interface (Strategy pattern — Q4/D5, ADR-001).
 *
 * The pluggable seam for NPC intelligence. Game code attaches a `Behavior`
 * strategy to an entity's `BehaviorComponent`; each tick the strategy inspects
 * the world (entity, event bus, variables/switches) and returns a
 * `BehaviorDecision`. The MVP ships only the rule-based strategy
 * (`behavior.ts`); the future LLM strategy (via a C++ server proxy, Q4) slots
 * in by implementing this same interface — no NPC code changes.
 *
 * This module defines types only; it never imports the interpreter or the
 * scene graph, so the interface stays a stable, dependency-light seam.
 */
import type { GameObject } from "../entity/game-object.js";
import type { GameEventBus } from "../events/event-bus.js";
import type { Direction } from "../schema/index.js";

/** Read-only view of world state a behavior may consult. */
export interface WorldStateReader {
  /** Current value of a variable (0 when unset). */
  getVariable(name: string): number;
  /** Current value of a switch (false when unset). */
  getSwitch(name: string): boolean;
}

/** What the behavior asks the engine to do this tick. */
export type BehaviorAction = "idle" | "move" | "face" | "say";

/** A single tick's decision from a behavior strategy. */
export interface BehaviorDecision {
  action: BehaviorAction;
  /** Movement delta in tile units (for `move`). */
  dx?: number;
  /** Movement delta in tile units (for `move`). */
  dy?: number;
  /** Direction to face (for `face`/`idle`). */
  direction?: Direction;
  /** Text to say (for `say`). */
  text?: string;
}

/** Everything a behavior strategy may need for one update tick. */
export interface BehaviorContext {
  /** The entity this behavior drives. */
  readonly entity: GameObject;
  /** The engine's gameplay event bus (may publish walk/collide/...). */
  readonly bus: GameEventBus;
  /** Read-only variables/switches state. */
  readonly state: WorldStateReader;
  /** Seconds elapsed since the previous update call. */
  readonly dt: number;
  /** Total seconds the behavior has been updating. */
  readonly elapsed: number;
}

/**
 * A pluggable NPC intelligence strategy (Strategy pattern).
 *
 * Implementations must be deterministic given the same tick sequence — the
 * core guarantees identical behavior in editor preview and runtime.
 */
export interface Behavior {
  /** Stable strategy identifier (for logs and serialization). */
  readonly id: string;
  /** Computes the decision for this tick. */
  update(ctx: BehaviorContext): BehaviorDecision;
  /** Resets internal state (e.g. on scene (re)entry). Optional. */
  reset?(): void;
}
