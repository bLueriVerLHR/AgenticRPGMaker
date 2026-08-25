/**
 * Movement/collision unit tests (Q6).
 */
import { describe, expect, it } from "vitest";
import { Collider, GameObject, SceneGraph, Transform } from "@agenticrpg/core";

import { aabbsOverlapStrict, buildCollisionGrid, checkStep } from "../src/movement.js";
import { emptyMap, fixtureMap } from "./helpers.js";

describe("buildCollisionGrid", () => {
  it("marks collider-layer tiles solid and map boundaries solid", () => {
    const map = fixtureMap();
    const grid = buildCollisionGrid(map);
    expect(grid.width).toBe(12);
    expect(grid.height).toBe(8);
    // Wall row y=4 is solid everywhere.
    expect(grid.isSolid(0, 4)).toBe(true);
    expect(grid.isSolid(5, 4)).toBe(true);
    // Ground elsewhere is free.
    expect(grid.isSolid(5, 2)).toBe(false);
    // Out-of-bounds is solid.
    expect(grid.isSolid(-1, 2)).toBe(true);
    expect(grid.isSolid(12, 2)).toBe(true);
    expect(grid.isSolid(5, -1)).toBe(true);
    expect(grid.isSolid(5, 8)).toBe(true);
  });

  it("treats a map with no collider layer as fully walkable inside bounds", () => {
    const map = emptyMap(4, 4);
    const grid = buildCollisionGrid(map);
    expect(grid.isSolid(2, 2)).toBe(false);
    expect(grid.isSolid(4, 2)).toBe(true); // out of bounds
  });
});

describe("checkStep", () => {
  it("allows a step onto a free tile", () => {
    const grid = buildCollisionGrid(emptyMap(5, 5));
    const result = checkStep({ from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, grid });
    expect(result).toEqual({ blocked: false, blockerId: null });
  });

  it("blocks a step into a solid tile (wall)", () => {
    const grid = buildCollisionGrid(fixtureMap());
    const result = checkStep({ from: { x: 1, y: 3 }, to: { x: 1, y: 4 }, grid });
    expect(result).toEqual({ blocked: true, blockerId: "map" });
  });

  it("blocks a step off the map", () => {
    const grid = buildCollisionGrid(emptyMap(4, 4));
    const result = checkStep({ from: { x: 0, y: 0 }, to: { x: -1, y: 0 }, grid });
    expect(result.blocked).toBe(true);
  });

  it("blocks a step into a solid entity but allows standing adjacent (strict overlap)", () => {
    const grid = buildCollisionGrid(emptyMap(8, 6));
    const scene = new SceneGraph();
    const npc = new GameObject({ id: "npc", name: "NPC" });
    npc.addComponent(new Transform({ x: 5, y: 2 }));
    npc.addComponent(
      new Collider({
        shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
        solid: true,
      }),
    );
    scene.addEntity(npc);
    const blockers = [npc];

    // Moving onto (4,2), one tile left of the NPC at (5,2), is free.
    const adjacent = checkStep({
      from: { x: 3, y: 2 },
      to: { x: 4, y: 2 },
      grid,
      blockers,
      selfId: "player",
    });
    expect(adjacent).toEqual({ blocked: false, blockerId: null });

    // Stepping into the NPC's tile (5,2) is blocked.
    const into = checkStep({
      from: { x: 4, y: 2 },
      to: { x: 5, y: 2 },
      grid,
      blockers,
      selfId: "player",
    });
    expect(into).toEqual({ blocked: true, blockerId: "npc" });
  });

  it("ignores the mover's own entity id in the blocker list", () => {
    const grid = buildCollisionGrid(emptyMap(8, 6));
    const player = new GameObject({ id: "player", name: "Player" });
    player.addComponent(new Transform({ x: 3, y: 2 }));
    player.addComponent(
      new Collider({
        shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
        solid: true,
      }),
    );
    const result = checkStep({
      from: { x: 3, y: 2 },
      to: { x: 4, y: 2 },
      grid,
      blockers: [player],
      selfId: "player",
      collider: player.getComponent("collider") ?? undefined,
    });
    expect(result.blocked).toBe(false);
  });
});

describe("aabbsOverlapStrict", () => {
  it("does not count touching edges as overlap", () => {
    expect(
      aabbsOverlapStrict({ x: 5, y: 2, width: 1, height: 1 }, { x: 6, y: 2, width: 1, height: 1 }),
    ).toBe(false);
  });

  it("counts real overlap", () => {
    expect(
      aabbsOverlapStrict({ x: 5, y: 2, width: 1, height: 1 }, { x: 5, y: 2, width: 1, height: 1 }),
    ).toBe(true);
    expect(
      aabbsOverlapStrict(
        { x: 5, y: 2, width: 1, height: 1 },
        { x: 5.5, y: 2, width: 1, height: 1 },
      ),
    ).toBe(true);
  });
});
