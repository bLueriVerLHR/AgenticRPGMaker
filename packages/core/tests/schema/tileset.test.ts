/**
 * Tileset schema v1 tests (ADR-003 enforcement).
 */
import { describe, expect, it } from "vitest";

import { tilesetSchema } from "../../src/index.js";

function makeTileset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "tilesets/grassland",
    name: "Grassland",
    image: "tilesets/grassland",
    tileSize: 16,
    columns: 8,
    rows: 8,
    collisions: [false, false, false, true],
    animations: [{ firstTile: 32, frames: [32, 33], speed: 4 }],
    ...overrides,
  };
}

describe("tilesetSchema (v1)", () => {
  it("parses a valid tileset document", () => {
    const result = tilesetSchema.safeParse(makeTileset());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("tilesets/grassland");
      expect(result.data.columns).toBe(8);
    }
  });

  it("parses a minimal tileset (no optional fields)", () => {
    const { collisions: _collisions, animations: _animations, ...minimal } = makeTileset();
    expect(tilesetSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects a missing schemaVersion", () => {
    const input = makeTileset();
    delete input.schemaVersion;
    expect(tilesetSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown/newer schemaVersion", () => {
    expect(tilesetSchema.safeParse(makeTileset({ schemaVersion: 2 })).success).toBe(false);
  });

  it("rejects non-positive tile dimensions", () => {
    expect(tilesetSchema.safeParse(makeTileset({ tileSize: -16 })).success).toBe(false);
  });

  it("rejects a broken animation (empty frames)", () => {
    expect(
      tilesetSchema.safeParse(makeTileset({ animations: [{ firstTile: 0, frames: [] }] })).success,
    ).toBe(false);
  });

  it("round-trips stably", () => {
    const parsed = tilesetSchema.parse(makeTileset());
    const reparsed = tilesetSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });
});
