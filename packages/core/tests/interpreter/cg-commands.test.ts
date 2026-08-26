/**
 * CG presentation command tests (ADR-010 §2).
 *
 * The new interpreter commands publish typed bus events and record
 * deterministic effects; they never render or play audio (core discipline —
 * the runtime presentation layer consumes the events). `sfx` rides the same
 * sound pipeline as `playSound`.
 */
import { describe, expect, it } from "vitest";

import {
  EventInterpreter,
  GameState,
  SceneGraph,
  TypedEventBus,
  type GameEffect,
  type GameEventMap,
  type MapEvent,
} from "../../src/index.js";

/** Runs a one-page event through the interpreter and captures bus events. */
function runCommands(commands: MapEvent["pages"][number]["commands"]) {
  const bus = new TypedEventBus<GameEventMap>();
  const seen: Array<{ event: string; payload: unknown }> = [];
  for (const event of [
    "cg_show",
    "fade_out",
    "fade_in",
    "letterbox",
    "bgm",
    "sound",
    "cg_end",
  ] as const) {
    const cancel = bus.on(event, (payload) => seen.push({ event, payload }));
    void cancel;
  }
  const event: MapEvent = {
    id: "evt_cg",
    name: "CG Runner",
    x: 0,
    y: 0,
    pages: [{ condition: null, commands }],
  };
  const interpreter = new EventInterpreter({
    state: new GameState(),
    bus,
    scene: new SceneGraph(),
  });
  const result = interpreter.runEvent(event);
  return { effects: result.effects as GameEffect[], seen };
}

describe("CG presentation commands", () => {
  it("showCg publishes cg_show (cover by default)", () => {
    const { effects, seen } = runCommands([{ cmd: "showCg", args: ["img/cg/opening.png"] }]);
    expect(effects).toContainEqual({ kind: "cg_show", image: "img/cg/opening.png", mode: "cover" });
    expect(seen).toContainEqual({
      event: "cg_show",
      payload: { image: "img/cg/opening.png", mode: "cover" },
    });
  });

  it("showCg honors the fit mode", () => {
    const { effects, seen } = runCommands([{ cmd: "showCg", args: ["img/cg/ending.png", "fit"] }]);
    expect(effects).toContainEqual({ kind: "cg_show", image: "img/cg/ending.png", mode: "fit" });
    expect(seen).toContainEqual({
      event: "cg_show",
      payload: { image: "img/cg/ending.png", mode: "fit" },
    });
  });

  it("fadeOut / fadeIn / letterbox / bgm publish their events", () => {
    const { effects, seen } = runCommands([
      { cmd: "fadeOut", args: ["#000000", 400] },
      { cmd: "fadeIn", args: [600] },
      { cmd: "letterbox", args: [true] },
      { cmd: "bgm", args: ["title"] },
    ]);
    expect(effects).toContainEqual({ kind: "fade_out", color: "#000000", durationMs: 400 });
    expect(effects).toContainEqual({ kind: "fade_in", durationMs: 600 });
    expect(effects).toContainEqual({ kind: "letterbox", on: true });
    expect(effects).toContainEqual({ kind: "bgm", ref: "title" });
    expect(seen).toContainEqual({
      event: "fade_out",
      payload: { color: "#000000", durationMs: 400 },
    });
    expect(seen).toContainEqual({ event: "letterbox", payload: { on: true } });
    expect(seen).toContainEqual({ event: "bgm", payload: { ref: "title" } });
  });

  it("endCg publishes cg_end", () => {
    const { effects, seen } = runCommands([{ cmd: "endCg", args: [] }]);
    expect(effects).toContainEqual({ kind: "cg_end" });
    expect(seen).toContainEqual({ event: "cg_end", payload: {} });
  });

  it("sfx rides the playSound pipeline", () => {
    const { effects, seen } = runCommands([{ cmd: "sfx", args: ["sword"] }]);
    expect(effects).toContainEqual({ kind: "sound", ref: "sword" });
    expect(seen).toContainEqual({ event: "sound", payload: { ref: "sword" } });
  });

  it("fails fast on malformed arguments", () => {
    const event: MapEvent = {
      id: "evt_bad",
      name: "Bad",
      x: 0,
      y: 0,
      pages: [{ condition: null, commands: [{ cmd: "showCg", args: [] }] }],
    };
    const interpreter = new EventInterpreter({
      state: new GameState(),
      bus: new TypedEventBus<GameEventMap>(),
      scene: new SceneGraph(),
    });
    expect(() => interpreter.runEvent(event)).toThrow(/expected a string/);
  });
});
