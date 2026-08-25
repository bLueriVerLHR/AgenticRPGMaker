/**
 * Collider component (ADR-001).
 *
 * Describes an entity's collision shape in tile units (relative to its
 * transform). `solid` colliders block movement; non-solid ("trigger")
 * colliders only report overlap. The core provides pure geometry helpers only —
 * no physics, no DOM.
 */
import { Component } from "./component.js";

export const COLLIDER_TYPE = "collider";

/** Axis-aligned bounding box in tile units (relative to the entity origin). */
export interface RectShape {
  kind: "rect";
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** Circle shape in tile units (relative to the entity origin). */
export interface CircleShape {
  kind: "circle";
  radius: number;
  offsetX: number;
  offsetY: number;
}

export type ColliderShape = RectShape | CircleShape;

export interface ColliderInit {
  shape: ColliderShape;
  /** Solid colliders block movement; trigger colliders only report overlap. */
  solid?: boolean;
}

/** An axis-aligned bounding box in tile units (world space). */
export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts a (local) shape to a local AABB. */
export function shapeToLocalAABB(shape: ColliderShape): AABB {
  if (shape.kind === "rect") {
    return { x: shape.offsetX, y: shape.offsetY, width: shape.width, height: shape.height };
  }
  return {
    x: shape.offsetX - shape.radius,
    y: shape.offsetY - shape.radius,
    width: shape.radius * 2,
    height: shape.radius * 2,
  };
}

/** True when two world-space AABBs overlap (touching edges count as overlap). */
export function aabbsOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

export class Collider extends Component {
  readonly type: string = COLLIDER_TYPE;

  shape: ColliderShape;
  /** Solid colliders block movement; trigger colliders only report overlap. */
  solid: boolean;

  constructor(init: ColliderInit) {
    super();
    this.shape = init.shape;
    this.solid = init.solid ?? false;
  }
}