/**
 * Entity/Component model tests (ADR-001).
 *
 * Composition over inheritance: GameObject composes components; typed lookup by
 * component type; attach/detach lifecycle; duplicate-type rejection; the
 * scene-graph node API (parent/children, world position).
 */
import { describe, expect, it } from "vitest";

import {
  BehaviorComponent,
  Collider,
  Component,
  GameObject,
  Sprite,
  Transform,
  RuleBasedBehavior,
  shapeToLocalAABB,
  aabbsOverlap,
  type ComponentTypeName,
} from "../../src/index.js";

describe("entity/component model (ADR-001)", () => {
  it("composes an entity from components and looks them up by type", () => {
    const hero = new GameObject({ id: "hero", name: "Hero" });
    hero
      .addComponent(new Transform({ x: 3, y: 2, direction: "up" }))
      .addComponent(new Sprite({ texture: "characters/hero" }))
      .addComponent(
        new Collider({
          shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
          solid: true,
        }),
      );

    const transform = hero.getComponent("transform");
    expect(transform).not.toBeNull();
    expect(transform?.x).toBe(3);
    expect(transform?.y).toBe(2);
    expect(transform?.direction).toBe("up");

    const sprite = hero.getComponent("sprite");
    expect(sprite?.texture).toBe("characters/hero");
    expect(sprite?.frame).toBe(0);

    const collider = hero.getComponent("collider");
    expect(collider?.solid).toBe(true);
    expect(collider?.shape.kind).toBe("rect");

    expect(hero.hasComponent("transform")).toBe(true);
    expect(hero.hasComponent("behavior")).toBe(false);
    expect(hero.getComponent("behavior")).toBeNull();
  });

  it("rejects a duplicate component type on one entity", () => {
    const entity = new GameObject({ id: "dup" });
    entity.addComponent(new Transform());
    expect(() => entity.addComponent(new Transform())).toThrow(/already has a component/);
  });

  it("attaches and detaches components with lifecycle callbacks", () => {
    const attached: string[] = [];
    const detached: string[] = [];

    class LifecycleProbe extends Component {
      readonly type: string = "probe";
      protected override onAttach(): void {
        attached.push("attach");
      }
      protected override onDetach(): void {
        detached.push("detach");
      }
    }

    const entity = new GameObject({ id: "probe" });
    const probe = new LifecycleProbe();
    entity.addComponent(probe);
    expect(probe.owner).toBe(entity);
    expect(attached).toEqual(["attach"]);

    entity.removeComponent("probe" as ComponentTypeName);
    expect(probe.owner).toBeNull();
    expect(detached).toEqual(["detach"]);
  });

  it("lists all components in insertion order", () => {
    const entity = new GameObject({ id: "comps" });
    entity.addComponent(new Transform());
    entity.addComponent(new Sprite({ texture: "t" }));
    const types = entity.getComponents().map((c) => c.type);
    expect(types).toEqual(["transform", "sprite"]);
  });

  it("hosts a behavior strategy on the BehaviorComponent seam", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    npc.addComponent(new BehaviorComponent());

    const behavior = npc.getComponent("behavior");
    expect(behavior).not.toBeNull();

    // Deterministic idle decision from a rule-based strategy.
    behavior?.setBehavior(new RuleBasedBehavior({ waypoints: [{ x: 0, y: 0 }] }));
    expect(behavior?.behavior?.id).toBe("rule-based");
  });

  it("computes world position from parent transforms (parent/child chain)", () => {
    const root = new GameObject({ id: "root" });
    const parent = new GameObject({ id: "parent" });
    const child = new GameObject({ id: "child" });

    root.addComponent(new Transform({ x: 10, y: 10 }));
    parent.addComponent(new Transform({ x: 2, y: 3 }));
    child.addComponent(new Transform({ x: 1, y: 1 }));

    root.addChild(parent);
    parent.addChild(child);

    expect(child.getWorldPosition()).toEqual({ x: 13, y: 14 });
    expect(parent.getWorldPosition()).toEqual({ x: 12, y: 13 });
    expect(root.getWorldPosition()).toEqual({ x: 10, y: 10 });
  });

  it("traverses depth-first including self and descendants", () => {
    const a = new GameObject({ id: "a" });
    const b = new GameObject({ id: "b" });
    const c = new GameObject({ id: "c" });
    a.addChild(b);
    a.addChild(c);
    const visited: string[] = [];
    a.traverse((node) => visited.push(node.id));
    expect(visited).toEqual(["a", "b", "c"]);
  });

  it("removes a child and unparents it", () => {
    const parent = new GameObject({ id: "parent" });
    const child = new GameObject({ id: "child" });
    parent.addChild(child);
    expect(parent.children).toHaveLength(1);
    expect(child.parent).toBe(parent);

    expect(parent.removeChild(child)).toBe(true);
    expect(parent.children).toHaveLength(0);
    expect(child.parent).toBeNull();
    expect(parent.removeChild(child)).toBe(false);
  });

  it("collider geometry helpers are pure and correct", () => {
    const aabb = shapeToLocalAABB({ kind: "rect", width: 2, height: 3, offsetX: 0, offsetY: 0 });
    expect(aabb).toEqual({ x: 0, y: 0, width: 2, height: 3 });

    const circleAABB = shapeToLocalAABB({ kind: "circle", radius: 1, offsetX: 0, offsetY: 0 });
    expect(circleAABB).toEqual({ x: -1, y: -1, width: 2, height: 2 });

    expect(
      aabbsOverlap({ x: 0, y: 0, width: 1, height: 1 }, { x: 1, y: 0, width: 1, height: 1 }),
    ).toBe(true);
    expect(
      aabbsOverlap({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 5, width: 1, height: 1 }),
    ).toBe(false);
  });
});
