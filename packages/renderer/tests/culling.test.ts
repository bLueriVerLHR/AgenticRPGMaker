/**
 * Tile quad culling math tests (P1b, ADR-002).
 *
 * Only tiles intersecting the camera viewport are emitted. Pure math, no
 * backend involved.
 */
import { describe, expect, it } from "vitest";

import { computeVisibleTileRange, isTileRangeEmpty } from "../src/tiles.js";

describe("computeVisibleTileRange", () => {
  it("returns the exact tile range for an aligned viewport", () => {
    const range = computeVisibleTileRange({
      viewport: { x: 0, y: 0, width: 320, height: 240 },
      tileSize: 32,
      mapWidthTiles: 20,
      mapHeightTiles: 15,
    });
    expect(range).toEqual({ rowStart: 0, rowEnd: 8, colStart: 0, colEnd: 10 });
    expect(isTileRangeEmpty(range)).toBe(false);
  });

  it("clamps a viewport partially outside the map", () => {
    const range = computeVisibleTileRange({
      viewport: { x: -64, y: -32, width: 320, height: 240 },
      tileSize: 32,
      mapWidthTiles: 20,
      mapHeightTiles: 15,
    });
    expect(range.colStart).toBe(0);
    expect(range.rowStart).toBe(0);
    expect(range.colEnd).toBe(8); // ceil((−64+320)/32) = 8
    expect(range.rowEnd).toBe(7); // ceil((−32+240)/32) = 7
  });

  it("reports empty when the viewport is entirely right of the map", () => {
    const range = computeVisibleTileRange({
      viewport: { x: 640, y: 0, width: 320, height: 240 },
      tileSize: 32,
      mapWidthTiles: 20, // 20*32 = 640 wide
      mapHeightTiles: 15,
    });
    expect(range.colStart).toBe(20);
    expect(range.colEnd).toBe(20);
    expect(isTileRangeEmpty(range)).toBe(true);
  });

  it("handles fractional viewport offsets (camera between tiles)", () => {
    const range = computeVisibleTileRange({
      viewport: { x: 16, y: 16, width: 320, height: 240 },
      tileSize: 32,
      mapWidthTiles: 20,
      mapHeightTiles: 15,
    });
    expect(range.colStart).toBe(0); // floor(16/32)
    expect(range.colEnd).toBe(11); // ceil(336/32)
    expect(range.rowStart).toBe(0);
    expect(range.rowEnd).toBe(8); // ceil(256/32)
  });
});
