/**
 * World coordinate helpers (ADR-008 §3.1).
 *
 * The single place where global-tile ↔ chunk-local-tile math lives. All
 * values are tile units; chunk cells index from the world origin (0,0).
 * Pure functions, no DOM — tests run in Node.
 *
 * This module is standalone on purpose (like `events/game-events.ts`): it
 * needs no schema or entity imports, so it stays trivially testable and
 * usable from a Web Worker (the chunk-parse worker, ADR-008 §4).
 */

/** A 2D point in tile units (structurally compatible with entity `Vec2`). */
export interface WorldPoint {
  x: number;
  y: number;
}

/** A chunk cell in the world grid (column, row). */
export interface ChunkCell {
  col: number;
  row: number;
}

function assertValid(x: number, y: number, chunkSize: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("coords: expected finite tile coordinates");
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("coords: chunkSize must be a positive integer");
  }
}

/**
 * The chunk cell containing a global tile coordinate. Negative coordinates
 * floor-wrap like array math (e.g. x=-1 with chunkSize 64 → col -1).
 */
export function chunkCellAt(x: number, y: number, chunkSize: number): ChunkCell {
  assertValid(x, y, chunkSize);
  return { col: Math.floor(x / chunkSize), row: Math.floor(y / chunkSize) };
}

/**
 * The local tile coordinate of a global coordinate inside its chunk
 * (always in `0..chunkSize-1`, negative coordinates wrap).
 */
export function localOf(coord: number, chunkSize: number): number {
  if (!Number.isFinite(coord) || !Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("coords: invalid local coordinate input");
  }
  return ((coord % chunkSize) + chunkSize) % chunkSize;
}

/** Local tile coordinates of a global point inside its chunk cell. */
export function toChunkLocal(
  point: WorldPoint,
  chunkSize: number,
  cell: ChunkCell = chunkCellAt(point.x, point.y, chunkSize),
): WorldPoint {
  return {
    x: localOf(point.x - cell.col * chunkSize, chunkSize),
    y: localOf(point.y - cell.row * chunkSize, chunkSize),
  };
}

/** Global tile coordinates of a local point within a chunk cell. */
export function toGlobal(cell: ChunkCell, local: WorldPoint, chunkSize: number): WorldPoint {
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
    throw new Error("coords: expected finite local coordinates");
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("coords: chunkSize must be a positive integer");
  }
  return {
    x: cell.col * chunkSize + local.x,
    y: cell.row * chunkSize + local.y,
  };
}
