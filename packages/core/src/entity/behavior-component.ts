/**
 * Behavior component (ADR-001, Q4/D5).
 *
 * Hosts a pluggable NPC `Behavior` strategy (Strategy pattern) on an entity.
 * The component is the runtime seam: game code attaches a strategy and drives
 * it each tick; the strategy decides what the NPC does. The LLM strategy is a
 * future option — the core only defines the interface and rule-based
 * implementation (`behavior/behavior.ts`).
 */
import type { Behavior, BehaviorContext, BehaviorDecision } from "../behavior/types.js";
import { Component } from "./component.js";

export const BEHAVIOR_TYPE = "behavior";

export class BehaviorComponent extends Component {
  readonly type: string = BEHAVIOR_TYPE;

  private _behavior: Behavior | null = null;

  /** The currently attached strategy, or null. */
  get behavior(): Behavior | null {
    return this._behavior;
  }

  /** Attaches (or replaces) the strategy. */
  setBehavior(behavior: Behavior): void {
    this._behavior = behavior;
  }

  /** Detaches the strategy, if any. */
  clearBehavior(): void {
    this._behavior = null;
  }

  /** Runs the attached strategy for one tick; returns its decision or null. */
  update(ctx: BehaviorContext): BehaviorDecision | null {
    return this._behavior?.update(ctx) ?? null;
  }
}