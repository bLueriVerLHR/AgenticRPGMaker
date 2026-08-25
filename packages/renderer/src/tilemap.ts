/**
 * TileMapRenderer — additive extension to the P0 `Renderer` interface (P1b).
 *
 * ADR-002 mandates tilemap rendering per layer as culled quad meshes built
 * from the map's tile indices (ADR-003). The P0 interface deliberately stayed
 * minimal, so rather than altering it, both backends additionally implement
 * this additive surface. Upper layers can detect it with `isTileMapRenderer`.
 * This is a P1b addition flagged for leader review (see report).
 */
import type { Renderer } from "./index.js";
import type { TileLayer, TilesetData } from "@agenticrpg/core";

export interface TileMapRenderer extends Renderer {
  /**
   * Load + bind a tileset so its tiles can be drawn by `tilesetId`. Loading is
   * asynchronous; tiles drawn before the image resolves are skipped.
   */
  registerTileset(tileset: TilesetData): void;
  /**
   * Draw one tile layer from a core map (ADR-003), culled to the camera
   * viewport. `tilesetId` is the map's `tileset` reference; index 0 = empty.
   */
  drawTileLayer(layer: TileLayer, tilesetId: string, tileSize: number): void;
}

export function isTileMapRenderer(value: Renderer): value is TileMapRenderer {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerTileset" in value &&
    "drawTileLayer" in value
  );
}
