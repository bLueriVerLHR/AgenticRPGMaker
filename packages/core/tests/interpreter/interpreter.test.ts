/**
 * Event interpreter tests (ADR-001 / ADR-003, P1a DoD).
 *
 * A fixture event page — walk → dialogue → move-block — executed by the
 * interpreter must produce the expected, deterministic effects. Also covers
 * variable/switch conditions, page selection, and the command set.
 */
import { describe, expect, it } from "vitest";

import {
  EventInterpreter,
  GameState,
  SceneGraph,
  TypedEventBus,
  UnknownCommandError,
  evaluateCondition,
  type GameEffect,
  type MapEvent,
} from "../../src/index.js";

import { makeMap } from "../schema/fixtures.js";

/**
 * The P1a DoD fixture: an NPC event whose active page runs
 *   walk (player steps toward the NPC) → showText (dialogue) →
 *   move-block (a composite of move commands) → playSound.
 */
function makeFixtureEvent(): MapEvent {
  return {
    id: "evt_inn_owner",
    name: "Inn Owner",
    x: 3,
    y: 2,
    sprite: "characters/npc_innkeeper",
    pages: [
      {
        condition: { switchId: "sw_met_inn_owner", value: true },
        commands: [
          { cmd: "setVariable", args: ["gold", "add", 50] },
          { cmd: "setSwitch", args: ["sw_talked_to_inn_owner", true] },
        ],
      },
      {
        condition: null,
        commands: [
          // walk: the player takes a step toward the NPC
          { cmd: "walk", args: [0, 1] },
          // dialogue
          { cmd: "showText", args: ["Welcome to the inn!"] },
          // move-block: a composite of move commands — the NPC walks up, right, down
          { cmd: "move", args: [0, -1] },
          { cmd: "move", args: [1, 0] },
          { cmd: "move", args: [0, 1] },
          // and a sound effect
          { cmd: "playSound", args: ["audio/coin.ogg"] },
        ],
      },
    ],
  };
}

describe("event interpreter (P1a DoD fixture)", () => {
  it("walks, shows dialogue, and runs the move-block with expected effects", () => {
    const map = makeMap({ events: [makeFixtureEvent()] });
    const scene = SceneGraph.fromMap(map, { playerPosition: { x: 3, y: 1 } });
    const interpreter = new EventInterpreter({ scene });

    const result = interpreter.runEvent(map.events[0]!);
    expect(result.ran).toBe(true);

    // Deterministic effect log, in order.
    const kinds = result.effects.map((e) => e.kind);
    expect(kinds).toEqual(["walk", "dialogue", "move", "move", "move", "sound"]);

    // walk: the player moved from (3,1) to (3,2).
    const walk = result.effects.find(
      (e): e is Extract<GameEffect, { kind: "walk" }> => e.kind === "walk",
    );
    expect(walk?.entityId).toBe("player");
    expect(walk?.from).toEqual({ x: 3, y: 1 });
    expect(walk?.to).toEqual({ x: 3, y: 2 });

    // dialogue
    const dialogue = result.effects.find(
      (e): e is Extract<GameEffect, { kind: "dialogue" }> => e.kind === "dialogue",
    );
    expect(dialogue?.text).toBe("Welcome to the inn!");

    // move-block: the NPC (actor = event id) moved up, right, down → net (1,0).
    const moves = result.effects.filter(
      (e): e is Extract<GameEffect, { kind: "move" }> => e.kind === "move",
    );
    expect(moves).toHaveLength(3);
    expect(moves.map((m) => m.entityId)).toEqual([
      "evt_inn_owner",
      "evt_inn_owner",
      "evt_inn_owner",
    ]);
    expect(moves[0]?.from).toEqual({ x: 3, y: 2 });
    expect(moves[moves.length - 1]?.to).toEqual({ x: 4, y: 2 });

    // sound
    const sound = result.effects.find(
      (e): e is Extract<GameEffect, { kind: "sound" }> => e.kind === "sound",
    );
    expect(sound?.ref).toBe("audio/coin.ogg");

    // The scene reflects the moves: player and NPC transforms updated.
    expect(scene.getEntityById("player")?.getComponent("transform")?.position).toEqual({
      x: 3,
      y: 2,
    });
    expect(scene.getEntityById("evt_inn_owner")?.getComponent("transform")?.position).toEqual({
      x: 4,
      y: 2,
    });
  });

  it("publishes gameplay events on the bus (walk + dialogue + sound)", () => {
    const map = makeMap({ events: [makeFixtureEvent()] });
    const scene = SceneGraph.fromMap(map, { playerPosition: { x: 3, y: 1 } });
    const bus = new TypedEventBus();
    const interpreter = new EventInterpreter({ scene, bus });

    const walked: string[] = [];
    const dialogue: string[] = [];
    const sounds: string[] = [];
    bus.on("walk", (e) => walked.push(e.entityId));
    bus.on("dialogue", (e) => dialogue.push(e.text));
    bus.on("sound", (e) => sounds.push(e.ref));

    interpreter.runEvent(map.events[0]!);
    expect(walked).toEqual(["player"]);
    expect(dialogue).toEqual(["Welcome to the inn!"]);
    expect(sounds).toEqual(["audio/coin.ogg"]);
  });

  it("is deterministic: the same page + state + scene produce identical effects", () => {
    const map = makeMap({ events: [makeFixtureEvent()] });

    const run = () => {
      const scene = SceneGraph.fromMap(map, { playerPosition: { x: 3, y: 1 } });
      const interpreter = new EventInterpreter({ scene });
      const result = interpreter.runEvent(map.events[0]!);
      return JSON.stringify(result.effects);
    };

    const first = run();
    for (let i = 0; i < 5; i += 1) {
      expect(run()).toBe(first);
    }
  });
});

describe("event interpreter conditions and page selection", () => {
  it("selects the first page whose condition is true (default = the always-active page)", () => {
    const event = makeFixtureEvent();
    const interpreter = new EventInterpreter();
    const page = interpreter.selectPage(event.pages);
    // sw_met_inn_owner is false by default → the fallback page (condition null) wins.
    expect(page).toBe(event.pages[1]);
  });

  it("switches the active page when the condition switch becomes true", () => {
    const event = makeFixtureEvent();
    const state = new GameState({ variables: {}, switches: { sw_met_inn_owner: true } });
    const interpreter = new EventInterpreter({ state });
    const page = interpreter.selectPage(event.pages);
    expect(page).toBe(event.pages[0]);
  });

  it("runs the switch-conditioned page (setVariable add + setSwitch) with effects", () => {
    const event = makeFixtureEvent();
    const state = new GameState({ variables: { gold: 0 }, switches: { sw_met_inn_owner: true } });
    const interpreter = new EventInterpreter({ state });

    const result = interpreter.runEvent(event);
    expect(result.ran).toBe(true);
    expect(result.effects.map((e) => e.kind)).toEqual(["variable", "switch"]);
    expect(state.getVariable("gold")).toBe(50);
    expect(state.getSwitch("sw_talked_to_inn_owner")).toBe(true);
  });

  it("does not run any page when no condition matches", () => {
    const event: MapEvent = {
      id: "evt_gated",
      name: "Gated",
      x: 0,
      y: 0,
      pages: [
        {
          condition: { switchId: "sw_never", value: true },
          commands: [{ cmd: "showText", args: ["nope"] }],
        },
      ],
    };
    const interpreter = new EventInterpreter();
    const result = interpreter.runEvent(event);
    expect(result.ran).toBe(false);
    expect(result.page).toBeNull();
    expect(result.effects).toEqual([]);
  });

  it("evaluates conditions against the current switch state", () => {
    const state = new GameState({ variables: {}, switches: { sw_a: true } });
    expect(evaluateCondition(null, state)).toBe(true);
    expect(evaluateCondition({ switchId: "sw_a", value: true }, state)).toBe(true);
    expect(evaluateCondition({ switchId: "sw_a", value: false }, state)).toBe(false);
    expect(evaluateCondition({ switchId: "sw_missing", value: false }, state)).toBe(true);
  });

  it("setVariable supports both set and add", () => {
    const state = new GameState({ variables: { gold: 10 }, switches: {} });
    const interpreter = new EventInterpreter({ state });
    const event: MapEvent = {
      id: "evt_vars",
      name: "Vars",
      x: 0,
      y: 0,
      pages: [
        {
          condition: null,
          commands: [
            { cmd: "setVariable", args: ["gold", "add", 5] },
            { cmd: "setVariable", args: ["gold", "set", 100] },
          ],
        },
      ],
    };
    interpreter.runEvent(event);
    expect(state.getVariable("gold")).toBe(100);
  });
});

describe("event interpreter robustness", () => {
  it("throws UnknownCommandError for an unknown command name", () => {
    const interpreter = new EventInterpreter();
    const event: MapEvent = {
      id: "evt_bad",
      name: "Bad",
      x: 0,
      y: 0,
      pages: [{ condition: null, commands: [{ cmd: "teleportToMars", args: [] }] }],
    };
    expect(() => interpreter.runEvent(event)).toThrow(UnknownCommandError);
  });

  it("moves an explicit target with the move command's third argument", () => {
    const map = makeMap();
    const scene = SceneGraph.fromMap(map);
    const interpreter = new EventInterpreter({ scene });
    const event: MapEvent = {
      id: "evt_push",
      name: "Push",
      x: 1,
      y: 1,
      pages: [{ condition: null, commands: [{ cmd: "move", args: [0, 2, "player"] }] }],
    };
    interpreter.runEvent(event, { actorId: "evt_push" });
    expect(scene.getEntityById("player")?.getComponent("transform")?.position).toEqual({
      x: 0,
      y: 2,
    });
  });
});

describe("event interpreter transfer command (task 14)", () => {
  it("emits a transfer event and records a transfer effect with position/direction", () => {
    const bus = new TypedEventBus();
    const interpreter = new EventInterpreter({ bus, scene: new SceneGraph() });
    const transfers: Array<{
      mapId: string;
      x?: number;
      y?: number;
      direction?: string;
    }> = [];
    bus.on("transfer", (e) => transfers.push(e));

    const event: MapEvent = {
      id: "evt_door",
      name: "Door",
      x: 3,
      y: 0,
      pages: [{ condition: null, commands: [{ cmd: "transfer", args: ["house", 2, 3, "up"] }] }],
    };
    const result = interpreter.runEvent(event);

    expect(transfers).toEqual([{ mapId: "house", x: 2, y: 3, direction: "up" }]);
    expect(result.effects).toContainEqual({
      kind: "transfer",
      mapId: "house",
      x: 2,
      y: 3,
      direction: "up",
    });
  });

  it("transfer without position or direction emits the map id only", () => {
    const bus = new TypedEventBus();
    const interpreter = new EventInterpreter({ bus });
    const transfers: Array<{ mapId: string; x?: number; y?: number; direction?: string }> = [];
    bus.on("transfer", (e) => transfers.push(e));

    const event: MapEvent = {
      id: "evt_door",
      name: "Door",
      x: 3,
      y: 0,
      pages: [{ condition: null, commands: [{ cmd: "transfer", args: ["house"] }] }],
    };
    interpreter.runEvent(event);
    expect(transfers).toEqual([{ mapId: "house" }]);
  });
});
