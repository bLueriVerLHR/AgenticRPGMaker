/**
 * Placeholder tileset generation (P2, ADR-006 §feature 2).
 *
 * The MVP editor paints tiles from a *placeholder* tileset: a generated 8x8
 * grid of distinct, deterministic tile colors. The same `TilesetData` document
 * (core schema, ADR-003) is passed to the runtime preview, where the embedded
 * runtime loads the generated atlas image (a data URL) so the painted map is
 * WYSIWYG — the editor's model and the preview's model are one document.
 *
 * Tile index 0 is reserved for empty/transparent (map schema convention).
 */
import type { TilesetData } from "@agenticrpg/core";
import { TILESET_SCHEMA_VERSION } from "@agenticrpg/core";

/** The placeholder tileset's stable id (referenced by map documents). */
export const PLACEHOLDER_TILESET_ID = "tilesets/placeholder";
/** Tile edge length in pixels for the placeholder atlas. */
export const PLACEHOLDER_TILE_SIZE = 16;
/** Atlas grid: 8 columns × 8 rows = 64 paint-able tiles (indices 1..64). */
export const PLACEHOLDER_COLUMNS = 8;
export const PLACEHOLDER_ROWS = 8;

/** Deterministic fill color for a tile index (stable across render + tests). */
export function tileColor(index: number): string {
  if (index <= 0) {
    return "rgba(0,0,0,0)";
  }
  const hue = (index * 47) % 360;
  const sat = 50 + (index % 4) * 8;
  const light = 40 + (index % 5) * 9;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** Deterministic edge color for a tile index (darker version of its fill). */
export function tileEdgeColor(index: number): string {
  if (index <= 0) {
    return "rgba(0,0,0,0)";
  }
  const hue = (index * 47) % 360;
  return `hsl(${hue}, 55%, 25%)`;
}

/**
 * Generate the placeholder atlas image as a PNG data URL.
 * Returns `null` when no 2D canvas context is available (jsdom/unit tests) —
 * callers fall back to procedural colors in that case.
 */
export function generatePlaceholderAtlasDataUrl(
  tileSize = PLACEHOLDER_TILE_SIZE,
  columns = PLACEHOLDER_COLUMNS,
  rows = PLACEHOLDER_ROWS,
): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = columns * tileSize;
  canvas.height = rows * tileSize;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return null;
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col + 1; // atlas cell (row, col) → tile index
      const x = col * tileSize;
      const y = row * tileSize;
      ctx.fillStyle = tileColor(index);
      ctx.fillRect(x, y, tileSize, tileSize);
      // A simple inner pattern so tiles are distinguishable from each other.
      ctx.fillStyle = tileEdgeColor(index);
      ctx.fillRect(x, y, tileSize, 2);
      ctx.fillRect(x, y, 2, tileSize);
      const dot = 2 + (index % 4);
      ctx.fillStyle = `hsl(${(index * 47) % 360}, 70%, 75%)`;
      ctx.beginPath();
      ctx.arc(x + tileSize / 2, y + tileSize / 2, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Build the placeholder `TilesetData` document (core schema, ADR-003). */
export function createPlaceholderTileset(): TilesetData {
  return {
    schemaVersion: TILESET_SCHEMA_VERSION,
    id: PLACEHOLDER_TILESET_ID,
    name: "Placeholder",
    image: generatePlaceholderAtlasDataUrl() ?? "tilesets/placeholder.png",
    tileSize: PLACEHOLDER_TILE_SIZE,
    columns: PLACEHOLDER_COLUMNS,
    rows: PLACEHOLDER_ROWS,
  };
}
