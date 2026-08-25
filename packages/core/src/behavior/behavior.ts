/**
 * Rule-based behavior strategy (Q4/D5, ADR-001).
 *
 * The MVP's NPC intelligence: a deterministic waypoint-patrol state machine
 * with an idle pause at each waypoint and an optional switch-triggered
 * "reactive" mode (stop patrolling, face the trigger). It implements the
 * `Behavior` interface — the LLM strategy (future, Q4) replaces it by
 * implementing the same interface.
 *
 * Determinism: `update` is a pure function of the entity's current transform
 * position and the tick sequence (`dt`), so editor preview and runtime behave
 * identically.
 */
import type { Vec2 } from "../entity/transform.js";
import type { Behavior, BehaviorContext, BehaviorDecision } from "./types.js";

export interface RuleBasedBehaviorConfig {
  /**
   * Patrol route in tile units (world space, absolute coordinates). An entity
   * that starts elsewhere first moves toward `waypoints[0]`.
   */
  waypoints: Vec2[];
  /** Patrol speed in tiles per second. */
  speed?: number;
  /** Seconds to idle at each waypoint before moving on. */
  idleSeconds?: number;
  /**
   * When this switch is true, patrolling stops and the entity faces
   * `faceDirection` instead (e.g. an NPC greeting the player after a flag).
   */
  triggerSwitch?: string;
  /** Direction to face while the trigger switch is true. */
  faceDirection?: BehaviorDecision["direction"];
}

/** No movement this tick. */
export function idleDecision(direction?: BehaviorDecision["direction"]): BehaviorDecision {
  return direction === undefined ? { action: "idle" } : { action: "idle", direction };
}

export class RuleBasedBehavior implements Behavior {
  readonly id: string;

  private readonly waypoints: Vec2[];
  private readonly speed: number;
  private readonly idleSeconds: number;
  private readonly triggerSwitch: string | undefined;
  private readonly faceDirection: BehaviorDecision["direction"];

  /** Index of the waypoint currently being approached. */
  private targetIndex: number;
  /** "moving" while approaching `waypoints[targetIndex]`, "idle" during a pause. */
  private phase: "moving" | "idle";
  /** Seconds left in the current idle pause (0 while moving). */
  private phaseTimeLeft: number;
  /** Total seconds this behavior has been updating. */
  private elapsedSeconds: number;

  constructor(config: RuleBasedBehaviorConfig) {
    if (config.waypoints.length === 0) {
      throw new Error("RuleBasedBehavior requires at least one waypoint");
    }
    this.waypoints = config.waypoints.map((p) => ({ x: p.x, y: p.y }));
    this.speed = config.speed ?? 1;
    this.idleSeconds = config.idleSeconds ?? 0;
    this.triggerSwitch = config.triggerSwitch;
    this.faceDirection = config.faceDirection;
    this.targetIndex = 0;
    this.phase = "moving";
    this.phaseTimeLeft = 0;
    this.elapsedSeconds = 0;
    this.id = "rule-based";
  }

  reset(): void {
    this.targetIndex = 0;
    this.phase = "moving";
    this.phaseTimeLeft = 0;
    this.elapsedSeconds = 0;
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  update(ctx: BehaviorContext): BehaviorDecision {
    this.elapsedSeconds += ctx.dt;

    const position = this.readPosition(ctx);

    // Reactive mode: a set switch freezes the patrol and faces the trigger.
    if (this.triggerSwitch !== undefined && ctx.state.getSwitch(this.triggerSwitch)) {
      return idleDecision(this.faceDirection);
    }

    if (this.waypoints.length === 1 && this.samePosition(position, this.waypoints[0]!)) {
      return idleDecision();
    }

    // Idle pause at a waypoint.
    if (this.phase === "idle") {
      this.phaseTimeLeft -= ctx.dt;
      if (this.phaseTimeLeft > 0) {
        return idleDecision();
      }
      this.phase = "moving";
      this.targetIndex = (this.targetIndex + 1) % this.waypoints.length;
    }

    const target = this.waypoints[this.targetIndex]!;
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.hypot(dx, dy);
    const step = this.speed * ctx.dt;

    if (distance === 0 || distance <= step) {
      // Arrived at the waypoint: begin the idle pause.
      this.phase = "idle";
      this.phaseTimeLeft = this.idleSeconds;
      return { action: "move", dx, dy };
    }

    // One step toward the waypoint (unit vector scaled by the step).
    return { action: "move", dx: (dx / distance) * step, dy: (dy / distance) * step };
  }

  private readPosition(ctx: BehaviorContext): Vec2 {
    const transform = ctx.entity.getComponent("transform");
    return transform !== null ? { x: transform.x, y: transform.y } : { x: 0, y: 0 };
  }

  private samePosition(a: Vec2, b: Vec2): boolean {
    return a.x === b.x && a.y === b.y;
  }
}
