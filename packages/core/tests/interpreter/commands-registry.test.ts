/**
 * Command Registry tests (task 08 — custom event commands, RPG-Maker
 * plugin-command model).
 *
 * Covers: default registry seeds the six built-ins and still works through
 * `commandFromSchema`; an author-registered custom command executes through
 * `EventInterpreter` and its effects appear; unknown names still fail fast;
 * a registry can replace a built-in command.
 */
import { describe, expect, it } from "vitest";

import { TypedEventBus } from "../../src/events/event-bus.js";
import { EventInterpreter } from "../../src/interpreter/index.js";
import {
  CommandRegistry,
  commandFromSchema,
  defaultCommandRegistry,
  UnknownCommandError,
  type CommandContext,
  type CommandFactory,
} from "../../src/interpreter/index.js";
import type { MapEvent } from "../../src/schema/index.js";
import { GameState } from "../../src/interpreter/index.js";
import { SceneGraph } from "../../src/scene/index.js";

function eventWithCommands(cmd: string, args: unknown[] = []): MapEvent {
  return {
    id: "evt-custom",
    name: "Custom Event",
    x: 2,
    y: 2,
    pages: [{ condition: null, commands: [{ cmd, args }] }],
  } as MapEvent;
}

describe("CommandRegistry (default)", () => {
  it("seeds the six built-in commands and builds through commandFromSchema", () => {
    for (const name of ["showText", "setVariable", "setSwitch", "playSound", "walk", "move"]) {
      expect(defaultCommandRegistry.has(name)).toBe(true);
    }
    const built = commandFromSchema({ cmd: "showText", args: ["hi"] });
    expect(built.cmd).toBe("showText");
  });

  it("fails fast on unknown commands", () => {
    expect(() => commandFromSchema({ cmd: "nope", args: [] })).toThrow(UnknownCommandError);
    expect(() => defaultCommandRegistry.build({ cmd: "nope", args: [] })).toThrow(
      UnknownCommandError,
    );
  });
});

describe("CommandRegistry (custom commands)", () => {
  it("executes an author-registered command through the interpreter", () => {
    const registry = new CommandRegistry();
    const customFactory: CommandFactory = (command) => {
      const amount = Number(command.args[0]);
      return {
        cmd: "grantGold",
        execute(ctx: CommandContext): void {
          ctx.state.addVariable("gold", amount);
          ctx.effects.push({
            kind: "variable",
            name: "gold",
            op: "add",
            value: amount,
            result: ctx.state.getVariable("gold"),
          });
        },
      };
    };
    registry.register("grantGold", customFactory);

    const interpreter = new EventInterpreter({
      state: new GameState(),
      bus: new TypedEventBus(),
      scene: new SceneGraph(),
      registry,
    });

    const result = interpreter.runEvent(eventWithCommands("grantGold", [100]));
    expect(result.ran).toBe(true);
    const goldEffect = result.effects.find((e) => e.kind === "variable" && e.name === "gold");
    expect(goldEffect).toMatchObject({ kind: "variable", name: "gold", value: 100, result: 100 });
  });

  it("is additive: built-ins are NOT available in a fresh registry (only custom)", () => {
    const registry = new CommandRegistry();
    registry.register("grantGold", () => ({ cmd: "grantGold", execute: () => {} }));
    expect(registry.has("grantGold")).toBe(true);
    expect(registry.has("showText")).toBe(false);
    expect(() => registry.build({ cmd: "showText", args: [] })).toThrow(UnknownCommandError);
  });

  it("can replace a built-in command", () => {
    const registry = new CommandRegistry();
    registry.register("showText", (_command) => {
      return {
        cmd: "showText-custom",
        execute(): void {
          // replacement implementation; the interpreter runs this instead of
          // the built-in dialogue emitter
        },
      };
    });
    const interpreter = new EventInterpreter({ registry });
    const result = interpreter.runEvent(eventWithCommands("showText", ["x"]));
    expect(result.ran).toBe(true);
  });
});

describe("InterpreterDeps.registry plug-in", () => {
  it("defaults to the default registry when omitted (existing behavior)", () => {
    const interpreter = new EventInterpreter();
    const result = interpreter.runEvent(eventWithCommands("showText", ["hello"]));
    expect(result.ran).toBe(true);
    expect(result.effects.some((e) => e.kind === "dialogue" && e.text === "hello")).toBe(true);
  });
});
