/**
 * Map mutation tests (P2, ADR-006): every op goes through the core model
 * (single source of truth) and every result validates against the core
 * `mapSchema` (ADR-003 enforcement).
 */
import { describe, expect, it } from "vitest";
import { mapSchema } from "@agenticrpg/core";

import {
  addLayer,
  createMap,
  moveLayer,
  paintTiles,
  removeEvent,
  removeLayer,
  removeSwitch,
  removeVariable,
  renameLayer,
  setLayerVisibility,
  setSwitch,
  setVariable,
  updateEvent,
  upsertEvent,
  validateMap,
} from "../src/model/map-ops.js";
import { createEvent } from "../src/model/event-model.js";
import { newEventId } from "../src/model/project.js";

function assertValid(map: unknown): void {
  const result = mapSchema.safeParse(map);
  expect(result.success, result.success ? "" : result.error.message).toBe(true);
}

describe("createMap", () => {
  it("creates a schema-valid empty map with ground + colliders layers", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    assertValid(map);
    expect(map.width).toBe(16);
    expect(map.height).toBe(12);
    expect(map.layers).toHaveLength(2);
    expect(map.layers[0]?.name).toBe("Ground");
    expect(map.layers[1]?.name).toBe("Colliders");
    expect(map.events).toEqual([]);
  });

  it("respects custom dimensions and keeps data shape exact", () => {
    const map = createMap({ id: "map_test", name: "Test", width: 5, height: 3 });
    assertValid(map);
    for (const layer of map.layers) {
      expect(layer.data).toHaveLength(3);
      for (const row of layer.data) {
        expect(row).toHaveLength(5);
      }
    }
  });
});

describe("paintTiles / erase", () => {
  it("paints cells on a layer and returns a new map (immutable)", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const painted = paintTiles(map, map.layers[0]!.id, [
      { x: 1, y: 2, index: 7 },
      { x: 3, y: 4, index: 9 },
    ]);
    assertValid(painted);
    expect(painted).not.toBe(map);
    expect(painted.layers[0]!.data[2]![1]).toBe(7);
    expect(painted.layers[0]!.data[4]![3]).toBe(9);
    // Original untouched (immutability).
    expect(map.layers[0]!.data[2]![1]).toBe(0);
  });

  it("ignores out-of-bounds cells and keeps the map valid", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const painted = paintTiles(map, map.layers[0]!.id, [
      { x: -1, y: 0, index: 3 },
      { x: 999, y: 999, index: 3 },
      { x: 0, y: 0, index: -5 },
    ]);
    assertValid(painted);
    expect(painted.layers[0]!.data[0]![0]).toBe(0);
  });

  it("paints on an unknown layer as a no-op", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const painted = paintTiles(map, "nope", [{ x: 0, y: 0, index: 3 }]);
    expect(painted).toBe(map);
  });

  it("erase writes index 0", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const painted = paintTiles(map, map.layers[0]!.id, [{ x: 2, y: 2, index: 5 }]);
    assertValid(painted);
    const erased = paintTiles(painted, map.layers[0]!.id, [{ x: 2, y: 2, index: 0 }]);
    expect(erased.layers[0]!.data[2]![2]).toBe(0);
  });
});

describe("layer ops", () => {
  it("adds, renames, hides, reorders, removes layers", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const added = addLayer(map, { id: "layer_deco", name: "Deco" });
    assertValid(added);
    expect(added.layers).toHaveLength(3);
    expect(added.layers[2]!.data).toHaveLength(map.height);

    const renamed = renameLayer(added, "layer_deco", "Decorations");
    assertValid(renamed);
    expect(renamed.layers[2]!.name).toBe("Decorations");

    const hidden = setLayerVisibility(renamed, "layer_deco", false);
    assertValid(hidden);
    expect(hidden.layers[2]!.visible).toBe(false);

    const moved = moveLayer(hidden, "layer_deco", -1);
    assertValid(moved);
    expect(moved.layers[1]!.id).toBe("layer_deco");

    const removed = removeLayer(moved, "layer_deco");
    assertValid(removed);
    expect(removed.layers.map((l) => l.id)).not.toContain("layer_deco");
  });

  it("keeps at least one layer", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    // Removing one of two layers leaves one (valid).
    const removed = removeLayer(map, map.layers[0]!.id);
    assertValid(removed);
    expect(removed.layers).toHaveLength(1);
    // Removing from a single-layer map is a no-op (never zero layers).
    const single = removeLayer(removed, removed.layers[0]!.id);
    expect(single).toBe(removed);
    expect(single.layers).toHaveLength(1);
  });
});

describe("event ops", () => {
  it("upserts, updates, and removes events", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const event = createEvent({ id: newEventId(), name: "NPC", x: 2, y: 3 });
    const withEvent = upsertEvent(map, event);
    assertValid(withEvent);
    expect(withEvent.events).toHaveLength(1);

    const updated = updateEvent(withEvent, event.id, { name: "NPC 2" });
    assertValid(updated);
    expect(updated.events[0]!.name).toBe("NPC 2");

    const replaced = upsertEvent(updated, { ...event, name: "NPC 3" });
    assertValid(replaced);
    expect(replaced.events).toHaveLength(1);
    expect(replaced.events[0]!.name).toBe("NPC 3");

    const removed = removeEvent(replaced, event.id);
    assertValid(removed);
    expect(removed.events).toEqual([]);
  });

  it("keeps event page invariant (min 1 page) via the page ops", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const event = createEvent({ id: newEventId(), name: "Trigger", x: 0, y: 0 });
    const withEvent = upsertEvent(map, event);
    expect(withEvent.events[0]!.pages).toHaveLength(1);
    expect(withEvent.events[0]!.pages[0]!.commands).toEqual([]);
  });
});

describe("variables / switches", () => {
  it("set/remove variables and switches through the core model", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    const withVar = setVariable(map, "gold", 10);
    assertValid(withVar);
    expect(withVar.variables).toEqual({ gold: 10 });
    expect(map.variables).toEqual({});

    const withoutVar = removeVariable(withVar, "gold");
    assertValid(withoutVar);
    expect(withoutVar.variables).toEqual({});

    const withSwitch = setSwitch(map, "door_open", true);
    assertValid(withSwitch);
    expect(withSwitch.switches).toEqual({ door_open: true });

    const withoutSwitch = removeSwitch(withSwitch, "door_open");
    assertValid(withoutSwitch);
    expect(withoutSwitch.switches).toEqual({});
  });
});

describe("validateMap", () => {
  it("accepts a valid map and rejects an invalid one", () => {
    const map = createMap({ id: "map_test", name: "Test" });
    expect(() => validateMap(map)).not.toThrow();
    const invalid = { ...map, layers: [{ ...map.layers[0]!, data: [[1]] }] };
    expect(() => validateMap(invalid)).toThrow(/invalid map/);
  });
});
