/**
 * Sample-map fixture test (P0, samples/): the fixture ship in samples/ must
 * parse against the core map schema — proving the fixture exercises the schema
 * and that the schema loads in plain Node (no DOM).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { mapSchema, parseMapDocument } from "../src/index.js";

const FIXTURE_URL = new URL("../../../samples/maps/town-square.map.json", import.meta.url);

describe("samples/maps/town-square.map.json", () => {
  it("exists and parses against the v1 map schema", () => {
    const fixturePath = fileURLToPath(FIXTURE_URL);
    const raw = readFileSync(fixturePath, "utf8");
    const doc = JSON.parse(raw) as unknown;
    const map = parseMapDocument(doc); // version gate + full validation
    expect(map.id).toBe("map_town_square");
    expect(map.schemaVersion).toBe(1);
  });

  it("has layer data consistent with its dimensions", () => {
    const fixturePath = fileURLToPath(FIXTURE_URL);
    const doc = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
    const map = mapSchema.parse(doc);
    for (const layer of map.layers) {
      expect(layer.data).toHaveLength(map.height);
      for (const row of layer.data) {
        expect(row).toHaveLength(map.width);
      }
    }
  });
});