/**
 * Map schema v1 tests (ADR-003 enforcement): example-parse, invalid-field
 * rejection, unknown-version rejection, and round-trip stability.
 */
import { describe, expect, it } from "vitest";

import { mapSchema } from "../../src/index.js";

import { makeMap } from "./fixtures.js";

describe("mapSchema (v1)", () => {
  it("parses a valid map document", () => {
    const result = mapSchema.safeParse(makeMap());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("map_town_square");
      expect(result.data.width).toBe(8);
      expect(result.data.height).toBe(6);
      expect(result.data.layers).toHaveLength(2);
      expect(result.data.events).toHaveLength(1);
      expect(result.data.events[0]?.pages).toHaveLength(2);
      expect(result.data.events[0]?.pages[1]?.condition).toBeNull();
    }
  });

  it("parses a map with no events (events default to [])", () => {
    const input = { ...makeMap(), events: undefined } as unknown as Record<string, unknown>;
    const result = mapSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.events).toEqual([]);
  });

  it("rejects a document missing schemaVersion", () => {
    const input = makeMap();
    const { schemaVersion: _dropped, ...rest } = input;
    const result = mapSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown/newer schemaVersion", () => {
    const result = mapSchema.safeParse({ ...makeMap(), schemaVersion: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("Invalid literal value");
    }
  });

  it("rejects a non-positive tileSize", () => {
    const result = mapSchema.safeParse({ ...makeMap(), tileSize: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects layer data with the wrong number of rows (height mismatch)", () => {
    const map = makeMap();
    map.layers[0]!.data = map.layers[0]!.data.slice(0, 3); // 3 rows instead of 6
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(false);
  });

  it("rejects layer data with the wrong number of columns (width mismatch)", () => {
    const map = makeMap();
    map.layers[0]!.data = map.layers[0]!.data.map((row) => row.slice(0, 2)); // 2 cols instead of 8
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(false);
  });

  it("rejects a negative tile index", () => {
    const map = makeMap();
    map.layers[0]!.data[0]![0] = -1;
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid event page condition", () => {
    const map = makeMap();
    map.events[0]!.pages[0]!.condition = { switchId: "", value: true }; // empty switchId
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(false);
  });

  it("round-trips stably: parse -> serialize -> parse is identical", () => {
    const parsed = mapSchema.parse(makeMap());
    const serialized = JSON.parse(JSON.stringify(parsed));
    const reparsed = mapSchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("accepts a variable page condition (task 15)", () => {
    const map = makeMap({
      events: [
        {
          id: "evt_merchant",
          name: "Merchant",
          x: 5,
          y: 2,
          pages: [
            {
              condition: { variableId: "gold", op: "gte", value: 10 },
              commands: [{ cmd: "showText", args: ["Rich customer!"] }],
            },
          ],
        },
      ],
    });
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(true);
    if (result.success) {
      const condition = result.data.events[0]!.pages[0]!.condition;
      expect(condition).toEqual({ variableId: "gold", op: "gte", value: 10 });
    }
  });

  it("rejects a variable condition with an unknown operator (task 15)", () => {
    const map = makeMap({
      events: [
        {
          id: "evt_bad",
          name: "Bad",
          x: 0,
          y: 0,
          pages: [
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              condition: { variableId: "gold", op: "gtr", value: 10 } as any,
              commands: [{ cmd: "showText", args: ["nope"] }],
            },
          ],
        },
      ],
    });
    const result = mapSchema.safeParse(map);
    expect(result.success).toBe(false);
  });
});
