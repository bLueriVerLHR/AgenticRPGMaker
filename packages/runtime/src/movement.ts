/**
 * Grid movement + collision (P1c, Q6; docs/06-architecture.md §3).
 *
 * Grid/tile-based movement in tile units against the core Transform. Solid
 * tiles come from the map's collider layer(s): a tile layer whose id or name
 * matches `/collider/i` (0 = walkable, >0 = solid), the sample-map
 * convention. Map boundaries are always solid. Collision is computed with the
 * core Collider AABB helpers (`shapeToLocalAABB` + `aabbsOverlap`) against
 * solid tile AABBs, and against other entities' solid colliders.
 */
import type { Collider, MapData } from "@agenticrpg/core";
import { shapeToLocalAABB, type AABB } from "@agenticrpg/core";
import type { GameObject } from "@agenticrpg/core";
import type { Vec2 } from "@agenticrpg/core";

/** A grid of solid tiles (1x1 tile AABBs). */
export interface SolidTileGrid {
  /** Map width in tiles. */
  readonly width: number;
  /** Map height in tiles. */
  readonly height: number;
  /** Whether the tile at integer tile coords is solid. */
  isSolid(tx: number, ty: number): boolean;
}

/** Matches tile layers that mark solid tiles (sample-map convention). */
const COLLIDER_LAYER_PATTERN = /collider/i;

/** Build the solid-tile grid from a map's collider layer(s) + boundaries. */
export function buildCollisionGrid(map: MapData): SolidTileGrid {
  const solid = new Set<string>();
  for (const layer of map.layers) {
    if (
      layer.type !== "tile" ||
      (!COLLIDER_LAYER_PATTERN.test(layer.id) && !COLLIDER_LAYER_PATTERN.test(layer.name))
    ) {
      continue;
    }
    for (let row = 0; row < layer.data.length; row++) {
      const dataRow = layer.data[row];
      if (dataRow === undefined) {
        continue;
      }
      for (let col = 0; col < dataRow.length; col++) {
        const value = dataRow[col];
        if (value !== undefined && value > 0) {
          solid.add(`${col},${row}`);
        }
      }
    }
  }
  const isSolid = (tx: number, ty: number): boolean => {
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      return true; // out of bounds = solid (boundary)
    }
    return solid.has(`${x},${y}`);
  };
  return { width: map.width, height: map.height, isSolid };
}

/** A single entity's world-space collider (from its Collider component). */
export interface EntityCollider {
  id: string;
  solid: boolean;
  aabb: AABB;
}

/** Collect an entity's solid collider as a world-space AABB, if it has one. */
export function entityColliderAt(entity: GameObject, position: Vec2): EntityCollider | null {
  const collider = entity.getComponent("collider");
  if (collider === null) {
    return null;
  }
  const local = shapeToLocalAABB(collider.shape);
  return {
    id: entity.id,
    solid: collider.solid,
    aabb: {
      x: position.x + local.x,
      y: position.y + local.y,
      width: local.width,
      height: local.height,
    },
  };
}

export interface StepCheckInput {
  /** Current tile position of the mover. */
  from: Vec2;
  /** Candidate tile position (integer in grid mode). */
  to: Vec2;
  grid: SolidTileGrid;
  /** Entities to treat as blockers (typically NPCs with solid colliders). */
  blockers?: ReadonlyArray<GameObject>;
  /** The mover's own entity id (excluded from blockers). */
  selfId?: string;
  /** Mover collider used for the AABB check. */
  collider?: Collider;
}

export interface StepCheckResult {
  blocked: boolean;
  /** The blocking entity id, "map" for a tile/boundary, or null. */
  blockerId: string | null;
}

/**
 * Checks whether a step from `from` to `to` is free. Uses the mover's
 * Collider AABB (default: a 1x1 tile) against solid tiles and solid entity
 * colliders. `to` is expected to be an integer tile position.
 */
export function checkStep(input: StepCheckInput): StepCheckResult {
  const mover = input.collider;
  const moverAABB: AABB =
    mover === undefined
      ? { x: input.to.x, y: input.to.y, width: 1, height: 1 }
      : placeAABB(shapeToLocalAABB(mover.shape), input.to);

  // Tile + boundary check.
  const tileOverlap = overlapsSolidTiles(moverAABB, input.grid);
  if (tileOverlap) {
    return { blocked: true, blockerId: "map" };
  }

  // Entity check. Uses strict overlap so a mover may stand adjacent to a
  // solid entity (RPG convention: talk to an NPC from the next tile) but may
  // not enter the entity's tile. The core `aabbsOverlap` counts touching edges
  // as overlap, which would forbid adjacency — hence the strict variant here.
  for (const entity of input.blockers ?? []) {
    if (input.selfId !== undefined && entity.id === input.selfId) {
      continue;
    }
    const collider = entityColliderAt(entity, {
      x: entity.getComponent("transform")?.x ?? 0,
      y: entity.getComponent("transform")?.y ?? 0,
    });
    if (collider !== null && collider.solid && aabbsOverlapStrict(moverAABB, collider.aabb)) {
      return { blocked: true, blockerId: entity.id };
    }
  }
  return { blocked: false, blockerId: null };
}

/** Place a local AABB at a tile position (integer tiles in grid mode). */
function placeAABB(local: AABB, at: Vec2): AABB {
  return { x: at.x + local.x, y: at.y + local.y, width: local.width, height: local.height };
}

/**
 * Strict AABB overlap (touching edges do NOT count). Matches the grid-tile
 * model: a 1x1 mover at tile (5,2) does not overlap a solid tile/entity at
 * (6,2), but does overlap it when stepping into (6,2).
 */
export function aabbsOverlapStrict(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Whether a world AABB strictly overlaps any solid tile in the grid. */
function overlapsSolidTiles(aabb: AABB, grid: SolidTileGrid): boolean {
  const minX = Math.floor(aabb.x + EPSILON);
  const maxX = Math.floor(aabb.x + aabb.width - EPSILON);
  const minY = Math.floor(aabb.y + EPSILON);
  const maxY = Math.floor(aabb.y + aabb.height - EPSILON);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (grid.isSolid(tx, ty)) {
        return true;
      }
    }
  }
  return false;
}

/** Small epsilon so an AABB ending exactly on a tile boundary does not
 *  include the neighboring tile (strict overlap for the grid check). */
const EPSILON = 1e-9;
