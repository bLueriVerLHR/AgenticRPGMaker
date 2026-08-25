/**
 * Event model + visual command catalog (P2, ADR-006 §feature 3, Q4/Q6).
 *
 * The editor places events from a *visual catalog* of commands — the same
 * command set the core event interpreter executes (showText / setVariable /
 * setSwitch / playSound / walk / move — packages/core/src/interpreter). Each
 * catalog entry declares how to edit its arguments in the UI; the editor emits
 * schema-valid `EventCommand` lines that the shared interpreter runs verbatim
 * in the preview and the shipped game (single source of truth).
 */
import type { EventCommand, EventPage, MapEvent } from "@agenticrpg/core";

/** Argument editor type for a command argument. */
export type CommandArgType = "string" | "number" | "boolean" | "select";

export interface CommandArgDef {
  key: string;
  label: string;
  type: CommandArgType;
  options?: { value: string; label: string }[];
  defaultValue: string | number | boolean;
}

export interface CommandDef {
  /** `cmd` value matching the core event command set. */
  cmd: string;
  label: string;
  args: CommandArgDef[];
}

/** The visual event command catalog (matches the core interpreter command set). */
export const COMMAND_CATALOG: readonly CommandDef[] = [
  {
    cmd: "showText",
    label: "Show Text",
    args: [{ key: "text", label: "Text", type: "string", defaultValue: "" }],
  },
  {
    cmd: "setVariable",
    label: "Set Variable",
    args: [
      { key: "name", label: "Variable", type: "string", defaultValue: "var_0" },
      {
        key: "op",
        label: "Operation",
        type: "select",
        options: [
          { value: "set", label: "Set to" },
          { value: "add", label: "Add" },
        ],
        defaultValue: "set",
      },
      { key: "value", label: "Value", type: "number", defaultValue: 0 },
    ],
  },
  {
    cmd: "setSwitch",
    label: "Set Switch",
    args: [
      { key: "name", label: "Switch", type: "string", defaultValue: "sw_0" },
      { key: "value", label: "Value", type: "boolean", defaultValue: true },
    ],
  },
  {
    cmd: "playSound",
    label: "Play Sound",
    args: [{ key: "ref", label: "Sound ref", type: "string", defaultValue: "audio/coin" }],
  },
  {
    cmd: "walk",
    label: "Walk (player)",
    args: [
      { key: "dx", label: "dx", type: "number", defaultValue: 0 },
      { key: "dy", label: "dy", type: "number", defaultValue: 1 },
    ],
  },
  {
    cmd: "move",
    label: "Move (this event)",
    args: [
      { key: "dx", label: "dx", type: "number", defaultValue: 0 },
      { key: "dy", label: "dy", type: "number", defaultValue: 0 },
      { key: "targetId", label: "Target id", type: "string", defaultValue: "" },
    ],
  },
];

/** Look up a catalog entry by `cmd` (undefined for unknown commands). */
export function commandDefFor(cmd: string): CommandDef | undefined {
  return COMMAND_CATALOG.find((def) => def.cmd === cmd);
}

/** Create a schema-valid command line with default arguments. */
export function createCommand(cmd: string): EventCommand {
  const def = commandDefFor(cmd);
  if (def === undefined) {
    return { cmd, args: [] };
  }
  return { cmd, args: def.args.map((arg) => arg.defaultValue) };
}

/** A one-line summary of a command for the event panel list. */
export function commandSummary(command: EventCommand): string {
  const def = commandDefFor(command.cmd);
  const head = def !== undefined ? def.label : command.cmd;
  const args = command.args
    .map((arg) => (typeof arg === "string" ? JSON.stringify(arg) : String(arg)))
    .join(", ");
  return args.length > 0 ? `${head}: ${args}` : head;
}

/** A fresh event page: always-active condition, empty command list. */
export function createPage(): EventPage {
  return { condition: null, commands: [] };
}

export interface CreateEventOptions {
  id: string;
  name: string;
  x: number;
  y: number;
  sprite?: string;
}

/** Create a new map event with a single default page. */
export function createEvent(options: CreateEventOptions): MapEvent {
  return {
    id: options.id,
    name: options.name,
    x: options.x,
    y: options.y,
    sprite: options.sprite,
    pages: [createPage()],
  };
}
