/**
 * Event interpreter command-cache tests (task 10).
 *
 * Covers: the schema→Command factory runs ONCE for the same event page across
 * repeated executions (cache hit); a different page parses its own commands;
 * `clearCommandCache()` forces re-parsing (picks up late registry changes).
 */
import { describe, expect, it, vi } from "vitest";

import { TypedEventBus } from "../../src/events/event-bus.js";
import { GameState } from "../../src/interpreter/index.js";
import { EventInterpreter, CommandRegistry } from "../../src/interpreter/index.js";
import type { CommandContext } from "../../src/interpreter/index.js";
import type { MapEvent } from "../../src/schema/index.js";
import { SceneGraph } from "../../src/scene/index.js";

function eventWithDialogues(texts: string[]): MapEvent {
  return {
    id: "evt-talk",
    name: "Talker",
    x: 1,
    y: 1,
    pages: [
      {
        condition: null,
        commands: texts.map((text) => ({ cmd: "showText", args: [text] })),
      },
    ],
  } as MapEvent;
}

describe("EventInterpreter command cache (task 10)", () => {
  it("parses a page's commands only once across repeated executions", () => {
    const spy = vi.fn();
    const registry = new CommandRegistry();
    registry.register("showText", (command) => {
      spy(command.cmd);
      return {
        cmd: "showText",
        execute(ctx: CommandContext): void {
          ctx.effects.push({ kind: "dialogue", text: String(command.args[0]) });
        },
      };
    });

    const interpreter = new EventInterpreter({
      state: new GameState(),
      bus: new TypedEventBus(),
      scene: new SceneGraph(),
      registry,
    });
    const event = eventWithDialogues(["hi"]);

    interpreter.runEvent(event);
    interpreter.runEvent(event); // second run — cache hit

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("parses each distinct page separately", () => {
    const spy = vi.fn();
    const registry = new CommandRegistry();
    registry.register("showText", (command) => {
      spy();
      return {
        cmd: "showText",
        execute(ctx: CommandContext): void {
          ctx.effects.push({ kind: "dialogue", text: String(command.args[0]) });
        },
      };
    });

    const interpreter = new EventInterpreter({ registry });
    interpreter.runEvent(eventWithDialogues(["a"]));
    interpreter.runEvent(eventWithDialogues(["b"])); // different page object

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("clearCommandCache() forces re-parsing (picks up late registrations)", () => {
    const spy = vi.fn();
    const registry = new CommandRegistry();
    registry.register("showText", (command) => {
      spy();
      return {
        cmd: "showText",
        execute(ctx: CommandContext): void {
          ctx.effects.push({ kind: "dialogue", text: String(command.args[0]) });
        },
      };
    });

    const interpreter = new EventInterpreter({ registry });
    const event = eventWithDialogues(["x"]);
    interpreter.runEvent(event);
    interpreter.runEvent(event); // cache hit
    expect(spy).toHaveBeenCalledTimes(1);

    interpreter.clearCommandCache();
    interpreter.runEvent(event);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
