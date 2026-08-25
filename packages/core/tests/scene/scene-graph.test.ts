/**
 * Scene graph tests (ADR-001).
 *
 * Tree structure (parent/child transforms), layer ordering, culling groups,
 * lookup by id / by component type, world-position accumulation, and the
 * map-driven construction (`SceneGraph.fromMap` from the ADR-003 fixture).
 */
import { describe, expect, it } from "vitest";

import { GameObject, SceneGraph, Transform, PLAYER_ENTITY_ID } from "../../src/index.js";

import { makeMap } from "../schema/fixtures.js";

describe("scene graph (ADR-001)", () => {
  it("builds a scene from a map document (player + one entity per event)", () => {
    const map = makeMap();
    const scene = SceneGraph.fromMap(map);

    expect(scene.getEntityById(PLAYER_ENTITY_ID)).not.toBeNull();
    expect(scene.getEntityById("evt_inn_owner")).not.toBeNull();
    expect(scene.size).toBe(map.events.length + 1);

    const event = scene.getEntityById("evt_inn_owner");
    const transform = event?.getComponent("transform");
    expect(transform?.x).toBe(3);
    expect(transform?.y).toBe(2);
    // Sprite-bearing events get a sprite + behavior seam.
    expect(event?.hasComponent("sprite")).toBe(true);
    expect(event?.hasComponent("behavior")).toBe(true);
  });

  it("rejects duplicate entity ids", () => {
    const map = makeMap();
    const scene = SceneGraph.fromMap(map);
    const duplicate = new GameObject({ id: "evt_inn_owner" });
    expect(() => scene.addEntity(duplicate)).toThrow(/already contains entity/);
  });

  it("looks up entities by component type", () => {
    const map = makeMap();
    const scene = SceneGraph.fromMap(map);
    const withTransform = scene.findEntitiesByComponent("transform");
    expect(withTransform.length).toBe(map.events.length + 1); // player + events
    const withBehavior = scene.findEntitiesByComponent("behavior");
    // Only sprite-bearing events (the fixture's inn owner) get a behavior seam.
    expect(withBehavior.map((e) => e.id)).toContain("evt_inn_owner");
  });

  it("traverses the tree and removes entities with descendants", () => {
    const scene = new SceneGraph();
    const parent = new GameObject({ id: "parent", layer: 1 });
    const child = new GameObject({ id: "child", layer: 2 });
    parent.addChild(child);
    scene.addEntity(parent);

    expect(scene.getEntityById("child")).not.toBeNull();

    expect(scene.removeEntity("parent")).toBe(true);
    expect(scene.getEntityById("parent")).toBeNull();
    expect(scene.getEntityById("child")).toBeNull();
    expect(scene.removeEntity("parent")).toBe(false);
  });

  it("orders layers ascending, ties broken by id (deterministic)", () => {
    const scene = new SceneGraph();
    const low = new GameObject({ id: "low", layer: 0 });
    const high = new GameObject({ id: "high", layer: 5 });
    const midB = new GameObject({ id: "mid-b", layer: 2 });
    const midA = new GameObject({ id: "mid-a", layer: 2 });
    for (const entity of [low, high, midB, midA]) {
      scene.addEntity(entity);
    }
    const order = scene.getEntitiesInLayerOrder().filter((e) => e.id !== "root");
    expect(order.map((e) => e.id)).toEqual(["low", "mid-a", "mid-b", "high"]);
  });

  it("groups entities by culling group", () => {
    const scene = new SceneGraph();
    const a = new GameObject({ id: "a", cullingGroup: "north" });
    const b = new GameObject({ id: "b", cullingGroup: "north" });
    const c = new GameObject({ id: "c", cullingGroup: "south" });
    scene.addEntity(a);
    scene.addEntity(b);
    scene.addEntity(c);

    expect(scene.findEntitiesByCullingGroup("north").map((e) => e.id)).toEqual(["a", "b"]);
    expect(scene.findEntitiesByCullingGroup("south").map((e) => e.id)).toEqual(["c"]);
    expect(scene.getCullingGroups()).toEqual(["north", "south"]);
  });

  it("accumulates world position through the parent chain", () => {
    const scene = new SceneGraph();
    const parent = new GameObject({ id: "p" });
    const child = new GameObject({ id: "ch" });
    parent.addComponent(new Transform({ x: 5, y: 5 }));
    child.addComponent(new Transform({ x: 1, y: 2 }));
    parent.addChild(child);
    scene.addEntity(parent);

    expect(scene.getWorldPosition(child)).toEqual({ x: 6, y: 7 });
  });
});
