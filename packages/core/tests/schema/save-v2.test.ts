/**
 * Save v2 schema tests (ADR-008 §7).
 *
 * The world-mode save: defaults apply (hp 3, empty chunkState), documents
 * round-trip, v1 documents are rejected by the v2 parse path, and hp stays
 * positive.
 */
import { describe, expect, it } from "vitest";

import { parseSaveV2Document } from "../../src/index.js";

function makeSaveV2(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 2,
    savedAt: "2026-08-26T10:00:00.000Z",
    worldId: "world_crossroads",
    player: { chunkId: "ch_village", x: 32, y: 40, direction: "down", hp: 3 },
    variables: { gold: 50 },
    switches: { sw_wilds_cleared: true },
    chunkState: { ch_wilds: { defeatedIds: ["en_slime_1"] } },
    ...overrides,
  };
}

describe("saveV2Schema", () => {
  it("parses a valid save with chunk state", () => {
    const save = parseSaveV2Document(makeSaveV2());
    expect(save.worldId).toBe("world_crossroads");
    expect(save.player.hp).toBe(3);
    expect(save.chunkState["ch_wilds"]?.defeatedIds).toEqual(["en_slime_1"]);
  });

  it("applies defaults: hp 3, empty chunkState, empty variables/switches", () => {
    const save = parseSaveV2Document(
      makeSaveV2({
        player: { chunkId: "ch_village", x: 1, y: 1, direction: "up" },
        variables: undefined,
        switches: undefined,
        chunkState: undefined,
      }),
    );
    expect(save.player.hp).toBe(3);
    expect(save.variables).toEqual({});
    expect(save.switches).toEqual({});
    expect(save.chunkState).toEqual({});
  });

  it("round-trips through JSON unchanged", () => {
    const save = parseSaveV2Document(makeSaveV2());
    const again = parseSaveV2Document(JSON.parse(JSON.stringify(save)));
    expect(again).toEqual(save);
  });

  it("rejects a v1 save document", () => {
    const v1 = {
      schemaVersion: 1,
      savedAt: "2026-08-25T00:00:00.000Z",
      mapId: "map_fixture",
      player: { x: 1, y: 2, direction: "down" },
      variables: {},
      switches: {},
    };
    expect(() => parseSaveV2Document(v1)).toThrow(/only accepts v2/);
  });

  it("rejects a non-positive hp", () => {
    const invalid = makeSaveV2({
      player: { chunkId: "ch_village", x: 1, y: 1, direction: "down", hp: 0 },
    });
    expect(() => parseSaveV2Document(invalid)).toThrow();
  });
});
