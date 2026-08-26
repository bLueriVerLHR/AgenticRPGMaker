/**
 * World schema v1 tests (ADR-008 §3.1).
 *
 * Covers manifest validation: valid documents parse (with defaults), grid
 * coverage + uniqueness invariants hold, spawn references a real chunk,
 * combatants sit inside their chunk, and the version gate fails fast on an
 * unknown/newer format.
 */
import { describe, expect, it } from "vitest";

import { parseWorldDocument } from "../../src/index.js";

function makeWorld(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    id: "world_test",
    name: "Test World",
    chunkSize: 8,
    grid: { cols: 2, rows: 2 },
    chunks: [
      { id: "c00", file: "data/chunks/c00.json", col: 0, row: 0 },
      { id: "c10", file: "data/chunks/c10.json", col: 1, row: 0 },
      { id: "c01", file: "data/chunks/c01.json", col: 0, row: 1 },
      { id: "c11", file: "data/chunks/c11.json", col: 1, row: 1 },
    ],
    spawn: { chunkId: "c00", x: 4, y: 5, direction: "down" },
    tilesets: ["tilesets/placeholder"],
    ...overrides,
  };
}

describe("worldSchema", () => {
  it("parses a valid manifest and fills defaults", () => {
    const world = parseWorldDocument(makeWorld());
    expect(world.id).toBe("world_test");
    expect(world.chunks).toHaveLength(4);
    expect(world.chunks[0]!.combatants).toEqual([]);
    expect(world.combatTypes).toEqual({});
    expect(world.global).toEqual({ variables: {}, switches: {} });
    expect(world.intro).toEqual([]);
  });

  it("carries the optional intro command list", () => {
    const world = parseWorldDocument(
      makeWorld({
        intro: [
          { cmd: "bgm", args: ["title"] },
          { cmd: "showCg", args: ["img/cg/opening.png"] },
          { cmd: "setSwitch", args: ["sw_intro_done", true] },
        ],
      }),
    );
    expect(world.intro).toEqual([
      { cmd: "bgm", args: ["title"] },
      { cmd: "showCg", args: ["img/cg/opening.png"] },
      { cmd: "setSwitch", args: ["sw_intro_done", true] },
    ]);
  });

  it("keeps combatants and combat types when provided", () => {
    const world = parseWorldDocument(
      makeWorld({
        combatTypes: { slime: { hp: 2, damage: 1, behavior: "chase", speed: 0.6 } },
        chunks: [
          {
            id: "c00",
            file: "data/chunks/c00.json",
            col: 0,
            row: 0,
            combatants: [{ id: "en_1", type: "slime", x: 3, y: 4 }],
          },
          { id: "c10", file: "data/chunks/c10.json", col: 1, row: 0 },
          { id: "c01", file: "data/chunks/c01.json", col: 0, row: 1 },
          { id: "c11", file: "data/chunks/c11.json", col: 1, row: 1 },
        ],
      }),
    );
    expect(world.combatTypes["slime"]).toEqual({
      hp: 2,
      damage: 1,
      behavior: "chase",
      speed: 0.6,
    });
    expect(world.chunks[0]!.combatants).toEqual([{ id: "en_1", type: "slime", x: 3, y: 4 }]);
  });

  it("keeps the optional onDefeatSwitch on a combatant", () => {
    const world = parseWorldDocument(
      makeWorld({
        chunks: [
          {
            id: "c00",
            file: "data/chunks/c00.json",
            col: 0,
            row: 0,
            combatants: [{ id: "en_1", type: "slime", x: 1, y: 1, onDefeatSwitch: "sw_win" }],
          },
          { id: "c10", file: "data/chunks/c10.json", col: 1, row: 0 },
          { id: "c01", file: "data/chunks/c01.json", col: 0, row: 1 },
          { id: "c11", file: "data/chunks/c11.json", col: 1, row: 1 },
        ],
      }),
    );
    expect(world.chunks[0]!.combatants[0]).toEqual({
      id: "en_1",
      type: "slime",
      x: 1,
      y: 1,
      onDefeatSwitch: "sw_win",
    });
  });

  it("preserves global variables and switches", () => {
    const world = parseWorldDocument(
      makeWorld({ global: { variables: { gold: 42 }, switches: { sw_open: true } } }),
    );
    expect(world.global.variables.gold).toBe(42);
    expect(world.global.switches.sw_open).toBe(true);
  });

  it("round-trips through JSON unchanged", () => {
    const world = parseWorldDocument(makeWorld());
    const again = parseWorldDocument(JSON.parse(JSON.stringify(world)));
    expect(again).toEqual(world);
  });
});

describe("worldSchema rejections", () => {
  it("rejects duplicate chunk ids", () => {
    const invalid = makeWorld({
      chunks: [
        { id: "c00", file: "a.json", col: 0, row: 0 },
        { id: "c00", file: "b.json", col: 1, row: 0 },
        { id: "c01", file: "c.json", col: 0, row: 1 },
        { id: "c11", file: "d.json", col: 1, row: 1 },
      ],
    });
    expect(() => parseWorldDocument(invalid)).toThrow(/unique/i);
  });

  it("rejects two chunks in the same grid cell", () => {
    const invalid = makeWorld({
      chunks: [
        { id: "c00", file: "a.json", col: 0, row: 0 },
        { id: "c10", file: "b.json", col: 1, row: 0 },
        { id: "c01", file: "c.json", col: 0, row: 1 },
        { id: "c11", file: "d.json", col: 1, row: 0 },
      ],
    });
    expect(() => parseWorldDocument(invalid)).toThrow(/unique/i);
  });

  it("rejects a chunk outside the grid", () => {
    const invalid = makeWorld({
      chunks: [
        { id: "c00", file: "a.json", col: 0, row: 0 },
        { id: "c10", file: "b.json", col: 9, row: 0 },
        { id: "c01", file: "c.json", col: 0, row: 1 },
        { id: "c11", file: "d.json", col: 1, row: 1 },
      ],
    });
    expect(() => parseWorldDocument(invalid)).toThrow(/unique|grid/i);
  });

  it("rejects a chunk list that does not cover the grid", () => {
    const invalid = makeWorld({
      chunks: [
        { id: "c00", file: "a.json", col: 0, row: 0 },
        { id: "c10", file: "b.json", col: 1, row: 0 },
        { id: "c01", file: "c.json", col: 0, row: 1 },
      ],
    });
    expect(() => parseWorldDocument(invalid)).toThrow(/cover/i);
  });

  it("rejects a spawn pointing at an unlisted chunk", () => {
    const invalid = makeWorld({ spawn: { chunkId: "missing", x: 1, y: 1, direction: "up" } });
    expect(() => parseWorldDocument(invalid)).toThrow(/spawn/i);
  });

  it("rejects a combatant outside its chunk bounds", () => {
    const invalid = makeWorld({
      chunks: [
        {
          id: "c00",
          file: "a.json",
          col: 0,
          row: 0,
          combatants: [{ id: "en_1", type: "slime", x: 8, y: 0 }],
        },
        { id: "c10", file: "b.json", col: 1, row: 0 },
        { id: "c01", file: "c.json", col: 0, row: 1 },
        { id: "c11", file: "d.json", col: 1, row: 1 },
      ],
    });
    expect(() => parseWorldDocument(invalid)).toThrow(/combatant/i);
  });

  it("rejects an unknown combat behavior", () => {
    const invalid = makeWorld({
      combatTypes: { ghost: { hp: 1, damage: 1, behavior: "fly", speed: 0 } },
    });
    expect(() => parseWorldDocument(invalid)).toThrow();
  });

  it("fails fast on an unknown/newer schema version", () => {
    const invalid = makeWorld({ schemaVersion: 2 });
    expect(() => parseWorldDocument(invalid)).toThrow(/unsupported world schemaVersion 2/);
  });
});
