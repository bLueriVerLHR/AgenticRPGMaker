/**
 * Game state (ADR-003 / ADR-001).
 *
 * The runtime variables and switches evaluated by event-page conditions and
 * mutated by interpreter commands. Every change is emitted on the gameplay
 * event bus (`variable_changed` / `switch_changed`), so systems can react and
 * the change is observable — the bus is optional, which keeps `GameState`
 * usable standalone (e.g. in schema/save code paths).
 */
import type { GameEventBus } from "../events/event-bus.js";

export interface GameStateSnapshot {
  variables: Record<string, number>;
  switches: Record<string, boolean>;
}

/** An empty game-state snapshot (convenience). */
export const EMPTY_SNAPSHOT: GameStateSnapshot = { variables: {}, switches: {} };

export class GameState {
  private readonly variables = new Map<string, number>();
  private readonly switches = new Map<string, boolean>();
  private readonly bus: GameEventBus | undefined;

  constructor(snapshot: GameStateSnapshot = EMPTY_SNAPSHOT, bus?: GameEventBus) {
    this.bus = bus;
    this.load(snapshot);
  }

  /** Current value of a variable (0 when unset). */
  getVariable(name: string): number {
    return this.variables.get(name) ?? 0;
  }

  /** Sets a variable to `value` and emits `variable_changed` (op: "set"). */
  setVariable(name: string, value: number): void {
    const previous = this.getVariable(name);
    this.variables.set(name, value);
    this.bus?.emit("variable_changed", { name, value, op: "set", previous });
  }

  /** Adds `delta` to a variable and emits `variable_changed` (op: "add"). */
  addVariable(name: string, delta: number): void {
    const previous = this.getVariable(name);
    const value = previous + delta;
    this.variables.set(name, value);
    this.bus?.emit("variable_changed", { name, value, op: "add", previous });
  }

  /** Current value of a switch (false when unset). */
  getSwitch(name: string): boolean {
    return this.switches.get(name) ?? false;
  }

  /** Sets a switch and emits `switch_changed`. */
  setSwitch(name: string, value: boolean): void {
    const previous = this.getSwitch(name);
    this.switches.set(name, value);
    this.bus?.emit("switch_changed", { name, value, previous });
  }

  /** A deep copy snapshot of the current state. */
  snapshot(): GameStateSnapshot {
    return {
      variables: Object.fromEntries(this.variables),
      switches: Object.fromEntries(this.switches),
    };
  }

  /** Replaces all state from a snapshot (no change events are emitted). */
  load(snapshot: GameStateSnapshot): void {
    this.variables.clear();
    this.switches.clear();
    for (const [name, value] of Object.entries(snapshot.variables)) {
      this.variables.set(name, value);
    }
    for (const [name, value] of Object.entries(snapshot.switches)) {
      this.switches.set(name, value);
    }
  }
}