/**
 * Transform component (ADR-001).
 *
 * Holds the entity's position in **tile units** (the v1 unit system shared by
 * maps, events, saves, and the protocol — see ADR-003/ADR-004), a facing
 * direction from the shared direction catalog, and provides local-space
 * helpers. World position (accumulated across parents) is computed by the
 * scene graph (see `scene/scene-graph.ts`).
 */
import type { Direction } from "../schema/index.js";
import { Component } from "./component.js";

export const TRANSFORM_TYPE = "transform";

/** A 2D vector in tile units. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface TransformInit {
  /** Tile-space X coordinate. */
  x?: number;
  /** Tile-space Y coordinate. */
  y?: number;
  /** Facing direction (shared token catalog). */
  direction?: Direction;
}

export class Transform extends Component {
  readonly type: string = TRANSFORM_TYPE;

  /** Tile-space X coordinate. */
  x: number;
  /** Tile-space Y coordinate. */
  y: number;
  /** Facing direction (shared token catalog). */
  direction: Direction;

  constructor(init: TransformInit = {}) {
    super();
    this.x = init.x ?? 0;
    this.y = init.y ?? 0;
    this.direction = init.direction ?? "down";
  }

  get position(): Vec2 {
    return { x: this.x, y: this.y };
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** Translates by a whole-tile delta. */
  translate(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  setDirection(direction: Direction): void {
    this.direction = direction;
  }
}