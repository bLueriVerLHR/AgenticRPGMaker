/**
 * GameObject — the entity container (ADR-001).
 *
 * A `GameObject` is a lightweight container of `Component`s, and simultaneously
 * a node in the scene-graph tree (parent/children, layer ordering, culling
 * group). Entities are composed from components rather than built by class
 * inheritance; the core provides typed lookup by component type and by id
 * (id lookup lives on the scene graph, `scene/scene-graph.ts`).
 */
import { Component } from "./component.js";
import type { BehaviorComponent } from "./behavior-component.js";
import type { Collider } from "./collider.js";
import type { Sprite } from "./sprite.js";
import type { Transform, Vec2 } from "./transform.js";

/**
 * Registry of the built-in component types, keyed by their `type` discriminator.
 * Typed lookup (`getComponent("transform")`) resolves through this map, so
 * component access is checked at compile time.
 */
export interface ComponentTypeRegistry {
  transform: Transform;
  sprite: Sprite;
  collider: Collider;
  behavior: BehaviorComponent;
}

/** Discriminator union for the built-in component types. */
export type ComponentTypeName = keyof ComponentTypeRegistry;

export interface GameObjectInit {
  /** Unique entity id within the scene (lookup key). */
  id: string;
  /** Human-readable name; defaults to the id. */
  name?: string;
  /** Ordering within the parent (lower layers update/render first). */
  layer?: number;
  /** Optional culling group for visibility/activation batching. */
  cullingGroup?: string | null;
}

export class GameObject {
  readonly id: string;
  name: string;
  /** Ordering within the parent (lower layers update/render first). */
  layer: number;
  /** Optional culling group for visibility/activation batching. */
  cullingGroup: string | null;
  /** Whether the entity participates in update/render (scene-level flag). */
  active: boolean;

  /** Parent node in the scene graph, or null when detached/root. */
  parent: GameObject | null;
  /** Child nodes in scene-graph order (insertion order). */
  readonly children: GameObject[];

  private readonly components = new Map<string, Component>();

  constructor(init: GameObjectInit) {
    this.id = init.id;
    this.name = init.name ?? init.id;
    this.layer = init.layer ?? 0;
    this.cullingGroup = init.cullingGroup ?? null;
    this.active = true;
    this.parent = null;
    this.children = [];
  }

  // ------------------------------------------------------------------
  // Component API (composition over inheritance)
  // ------------------------------------------------------------------

  /**
   * Adds a component. Each component type may be present at most once per
   * entity (a GameObject has one Transform, one Sprite, ...).
   */
  addComponent(component: Component): this {
    if (this.components.has(component.type)) {
      throw new Error(`entity "${this.id}" already has a component of type "${component.type}"`);
    }
    this.components.set(component.type, component);
    component.attach(this);
    return this;
  }

  /** Typed lookup by component type. Returns null when absent. */
  getComponent<K extends ComponentTypeName>(type: K): ComponentTypeRegistry[K] | null {
    const found = this.components.get(type);
    return (found as ComponentTypeRegistry[K] | undefined) ?? null;
  }

  /** Whether the entity has a component of the given type. */
  hasComponent(type: ComponentTypeName): boolean {
    return this.components.has(type);
  }

  /** All components attached to this entity (insertion order). */
  getComponents(): Component[] {
    return [...this.components.values()];
  }

  /** Removes and detaches the component of the given type, if present. */
  removeComponent<K extends ComponentTypeName>(type: K): ComponentTypeRegistry[K] | null {
    const found = this.components.get(type);
    if (found === undefined) {
      return null;
    }
    this.components.delete(type);
    found.detach();
    return found as ComponentTypeRegistry[K];
  }

  // ------------------------------------------------------------------
  // Scene-graph node operations
  // ------------------------------------------------------------------

  /** Adds a child node (re-parents it away from its current parent). */
  addChild(child: GameObject): this {
    if (child.parent === this) {
      return this;
    }
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }

  /** Removes a direct child; returns whether it was found. */
  removeChild(child: GameObject): boolean {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return false;
    }
    this.children.splice(index, 1);
    child.parent = null;
    return true;
  }

  /** Depth-first traversal including this entity and all descendants. */
  traverse(visit: (entity: GameObject) => void): void {
    visit(this);
    for (const child of this.children) {
      child.traverse(visit);
    }
  }

  /** Ancestors from the parent up to the root, excluding this entity. */
  getAncestors(): GameObject[] {
    const ancestors: GameObject[] = [];
    let current: GameObject | null = this.parent;
    while (current !== null) {
      ancestors.push(current);
      current = current.parent;
    }
    return ancestors;
  }

  /**
   * World position in tile units: this entity's transform position accumulated
   * with every ancestor's transform position (parent-relative transforms).
   */
  getWorldPosition(): Vec2 {
    let x = 0;
    let y = 0;
    const own = this.getComponent("transform");
    if (own !== null) {
      x += own.x;
      y += own.y;
    }
    for (const ancestor of this.getAncestors()) {
      const t = ancestor.getComponent("transform");
      if (t !== null) {
        x += t.x;
        y += t.y;
      }
    }
    return { x, y };
  }

  /**
   * Detaches the entity from its parent and removes all components. Children
   * are detached first (depth-first), so nothing dangles.
   */
  destroy(): void {
    for (const child of [...this.children]) {
      this.removeChild(child);
      child.destroy();
    }
    this.parent?.removeChild(this);
    for (const type of [...this.components.keys()]) {
      this.removeComponent(type as ComponentTypeName);
    }
  }
}
