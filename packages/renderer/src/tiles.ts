/**
 * Tile quad culling (P1b, ADR-002/ADR-003).
 *
 * Tile layers are rendered per-layer as quad meshes; only tiles that intersect
 * the camera viewport are emitted. This module is the pure, testable culling
 * math: it converts a world-space viewport into an inclusive/exclusive row and
 * column range clamped to the map bounds.
 */
import type { Viewport } from "./index.js";

/** Inclusive-start / exclusive-end tile ranges. */
export interface TileCullRange {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export interface TileCullInput {
  /** Camera viewport in world units (pixels at zoom 1). */
  viewport: Viewport;
  /** Tile edge length in pixels. */
  tileSize: number;
  /** Map dimensions in tiles. */
  mapWidthTiles: number;
  mapHeightTiles: number;
}

/**
 * Compute the tile range that intersects the viewport, clamped to the map.
 * A range where `start >= end` means nothing is visible.
 */
export function computeVisibleTileRange(input: TileCullInput): TileCullRange {
  const { viewport, tileSize, mapWidthTiles, mapHeightTiles } = input;
  const worldRight = viewport.x + viewport.width;
  const worldBottom = viewport.y + viewport.height;

  const colStart = clamp(Math.floor(viewport.x / tileSize), 0, mapWidthTiles);
  const colEnd = clamp(Math.ceil(worldRight / tileSize), 0, mapWidthTiles);
  const rowStart = clamp(Math.floor(viewport.y / tileSize), 0, mapHeightTiles);
  const rowEnd = clamp(Math.ceil(worldBottom / tileSize), 0, mapHeightTiles);

  return { rowStart, rowEnd, colStart, colEnd };
}

/** True when the range contains no tiles (viewport fully outside the map). */
export function isTileRangeEmpty(range: TileCullRange): boolean {
  return range.colStart >= range.colEnd || range.rowStart >= range.rowEnd;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
