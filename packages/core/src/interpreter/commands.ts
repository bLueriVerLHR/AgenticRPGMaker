/**
 * Event command system (ADR-001 §7 — Command + Composite).
 *
 * Every event-page line from the map schema (`EventCommand`, ADR-003) becomes
 * a `Command` object; a page is a `CompositeCommand` (an ordered command list).
 * Commands are pure data → effects: they mutate `GameState`, move entities in
 * the `SceneGraph`, and publish gameplay events on the bus. The interpreter
 * (`interpreter.ts`) is the **only executor** — nothing else runs commands.
 *
 * Command set (matching the ADR-003 map example, minimal + the DoD fixture):
 * - `showText`       — publish a `dialogue` event
 * - `setVariable`    — `set` or `add` a variable (also `setSwitch`, additive)
 * - `playSound`      — publish a `sound` event (core never plays audio)
 * - `walk`           — move the **player** by a tile delta, publish `walk`
 * - `move`           — move an entity by a tile delta (move routes; no event)
 * Commands are deterministic: the same page + same state + same scene always
 * produce the same effects.
 */
import type { GameEventBus } from "../events/event-bus.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { EventCommand } from "../schema/index.js";
import { PLAYER_ENTITY_ID } from "../scene/scene-graph.js";
import type { GameState } from "./game-state.js";

/** A positional tile coordinate (world space). */
export interface CommandPosition {
  x: number;
  y: number;
}

/** A deterministic, observable effect recorded by command execution. */
export type GameEffect =
  | { kind: "walk"; entityId: string; from: CommandPosition; to: CommandPosition }
  | { kind: "move"; entityId: string; from: CommandPosition; to: CommandPosition }
  | { kind: "dialogue"; text: string; speakerId?: string }
  | { kind: "sound"; ref: string }
  | { kind: "variable"; name: string; op: "set" | "add"; value: number; result: number }
  | { kind: "switch"; name: string; value: boolean };

/** Everything a command may read and mutate while executing. */
export interface CommandContext {
  readonly state: GameState;
  readonly bus: GameEventBus;
  readonly scene: SceneGraph;
  /**
   * The entity that acts as this event's actor (defaults to the event's own
   * entity id). `move` routes act on this id unless given an explicit target.
   */
  readonly actorId: string;
  /** Append-only deterministic effect log. */
  readonly effects: GameEffect[];
}

/** A command line (Command pattern). */
export interface Command {
  /** Command discriminator, matching the map schema's `cmd` field. */
  readonly cmd: string;
  execute(ctx: CommandContext): void;
}

/** An ordered command list (Composite pattern) — a page executes as one. */
export class CompositeCommand implements Command {
  readonly cmd: string = "composite";

  constructor(readonly commands: readonly Command[]) {}

  execute(ctx: CommandContext): void {
    for (const command of this.commands) {
      command.execute(ctx);
    }
  }
}

/** Thrown when an event-page line names an unknown command. */
export class UnknownCommandError extends Error {
  readonly commandName: string;
  constructor(commandName: string) {
    super(`unknown event command "${commandName}"`);
    this.name = "UnknownCommandError";
    this.commandName = commandName;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Applies a tile-space translation to an entity's transform. */
function translateEntity(
  ctx: CommandContext,
  entityId: string,
  dx: number,
  dy: number,
): { from: CommandPosition; to: CommandPosition } {
  const entity = ctx.scene.getEntityById(entityId);
  if (entity === null) {
    throw new Error(`command target: no entity "${entityId}" in the scene`);
  }
  const transform = entity.getComponent("transform");
  if (transform === null) {
    throw new Error(`command target: entity "${entityId}" has no transform`);
  }
  const from: CommandPosition = { x: transform.x, y: transform.y };
  transform.translate(dx, dy);
  return { from, to: { x: transform.x, y: transform.y } };
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`command "${what}": expected a finite number, got ${String(value)}`);
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`command "${what}": expected a string, got ${String(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Concrete commands
// ---------------------------------------------------------------------------

/** `showText "..."` — publishes a dialogue event. */
export class ShowTextCommand implements Command {
  readonly cmd: string = "showText";
  constructor(readonly text: string) {}

  execute(ctx: CommandContext): void {
    ctx.effects.push({ kind: "dialogue", text: this.text, speakerId: ctx.actorId });
    ctx.bus.emit("dialogue", { text: this.text, speakerId: ctx.actorId });
  }
}

/** `setVariable name op value` — `op` is "set" or "add". */
export class SetVariableCommand implements Command {
  readonly cmd: string = "setVariable";
  constructor(
    readonly name: string,
    readonly op: "set" | "add",
    readonly value: number,
  ) {}

  execute(ctx: CommandContext): void {
    if (this.op === "set") {
      ctx.state.setVariable(this.name, this.value);
    } else {
      ctx.state.addVariable(this.name, this.value);
    }
    const result = ctx.state.getVariable(this.name);
    ctx.effects.push({ kind: "variable", name: this.name, op: this.op, value: this.value, result });
  }
}

/** `setSwitch name value` — sets a switch (additive command). */
export class SetSwitchCommand implements Command {
  readonly cmd: string = "setSwitch";
  constructor(
    readonly name: string,
    readonly value: boolean,
  ) {}

  execute(ctx: CommandContext): void {
    ctx.state.setSwitch(this.name, this.value);
    ctx.effects.push({ kind: "switch", name: this.name, value: this.value });
  }
}

/** `playSound "ref"` — publishes a `sound` event (core never plays audio). */
export class PlaySoundCommand implements Command {
  readonly cmd: string = "playSound";
  constructor(readonly ref: string) {}

  execute(ctx: CommandContext): void {
    ctx.effects.push({ kind: "sound", ref: this.ref });
    ctx.bus.emit("sound", { ref: this.ref });
  }
}

/**
 * `walk dx dy` — moves the player entity by a whole-tile delta and publishes
 * a `walk` gameplay event (used for player movement steps).
 */
export class WalkCommand implements Command {
  readonly cmd: string = "walk";
  constructor(
    readonly dx: number,
    readonly dy: number,
  ) {}

  execute(ctx: CommandContext): void {
    const { from, to } = translateEntity(ctx, PLAYER_ENTITY_ID, this.dx, this.dy);
    ctx.effects.push({ kind: "walk", entityId: PLAYER_ENTITY_ID, from, to });
    ctx.bus.emit("walk", { entityId: PLAYER_ENTITY_ID, from, to });
  }
}

/**
 * `move dx dy [targetId?]` — translates the actor (or an explicit target) by
 * a tile delta. Used for NPC move routes / "move blocks"; no public event.
 */
export class MoveCommand implements Command {
  readonly cmd: string = "move";
  constructor(
    readonly dx: number,
    readonly dy: number,
    readonly targetId?: string,
  ) {}

  execute(ctx: CommandContext): void {
    const entityId = this.targetId ?? ctx.actorId;
    const { from, to } = translateEntity(ctx, entityId, this.dx, this.dy);
    ctx.effects.push({ kind: "move", entityId, from, to });
  }
}

// ---------------------------------------------------------------------------
// Factory: map-schema command lines → Command objects
// ---------------------------------------------------------------------------

/**
 * Builds a `Command` from a map-schema command line (ADR-003). Unknown `cmd`
 * names fail fast (mirroring the ADR-003 version/fail-fast philosophy).
 */
export function commandFromSchema(command: EventCommand): Command {
  const args = command.args;
  switch (command.cmd) {
    case "showText":
      return new ShowTextCommand(asString(args[0], "showText"));
    case "setVariable": {
      const name = asString(args[0], "setVariable");
      const op = args[1];
      if (op !== "set" && op !== "add") {
        throw new UnknownCommandError(`setVariable: op must be "set" or "add", got ${String(op)}`);
      }
      return new SetVariableCommand(name, op, asNumber(args[2], "setVariable"));
    }
    case "setSwitch":
      return new SetSwitchCommand(asString(args[0], "setSwitch"), Boolean(args[1]));
    case "playSound":
      return new PlaySoundCommand(asString(args[0], "playSound"));
    case "walk":
      return new WalkCommand(asNumber(args[0], "walk"), asNumber(args[1], "walk"));
    case "move": {
      const targetId = typeof args[2] === "string" ? args[2] : undefined;
      return new MoveCommand(asNumber(args[0], "move"), asNumber(args[1], "move"), targetId);
    }
    default:
      throw new UnknownCommandError(command.cmd);
  }
}
