/**
 * Save schema v1 tests (ADR-003 enforcement).
 */
import { describe, expect, it } from "vitest";

import { saveSchema } from "../../src/index.js";

function makeSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    savedAt: "2026-08-25T12:00:00Z",
    mapId: "map_town_square",
    player: { x: 10, y: 8, direction: "down" },
    variables: { gold: 50 },
    switches: { sw_met_inn_owner: true },
    ...overrides,
  };
}

describe("saveSchema (v1)", () => {
  it("parses a valid save document (ADR-003 concrete example)", () => {
    const result = saveSchema.safeParse(makeSave());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mapId).toBe("map_town_square");
      expect(result.data.player.direction).toBe("down");
      expect(result.data.variables.gold).toBe(50);
    }
  });

  it("rejects a missing schemaVersion", () => {
    const input = makeSave();
    delete input.schemaVersion;
    expect(saveSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown/newer schemaVersion", () => {
    expect(saveSchema.safeParse(makeSave({ schemaVersion: 2 })).success).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(saveSchema.safeParse(makeSave({ player: { x: 0, y: 0, direction: "sideways" } })).success).toBe(
      false,
    );
  });

  it("rejects a malformed savedAt timestamp", () => {
    expect(saveSchema.safeParse(makeSave({ savedAt: "yesterday" })).success).toBe(false);
  });

  it("round-trips stably", () => {
    const parsed = saveSchema.parse(makeSave());
    const reparsed = saveSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });
});
