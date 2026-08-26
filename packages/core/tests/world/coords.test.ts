/**
 * World coordinate helper tests (ADR-008 §3.1).
 *
 * Global-tile ↔ chunk-local-tile math must round-trip, wrap negative
 * coordinates correctly, and fail loudly on invalid input — this module is
 * the single source of truth both the runtime and the chunk-parse worker
 * rely on.
 */
import { describe, expect, it } from "vitest";

import { chunkCellAt, localOf, toChunkLocal, toGlobal } from "../../src/index.js";

describe("chunkCellAt", () => {
  it("maps global coordinates to chunk cells", () => {
    expect(chunkCellAt(0, 0, 64)).toEqual({ col: 0, row: 0 });
    expect(chunkCellAt(63, 63, 64)).toEqual({ col: 0, row: 0 });
    expect(chunkCellAt(64, 0, 64)).toEqual({ col: 1, row: 0 });
    expect(chunkCellAt(127, 128, 64)).toEqual({ col: 1, row: 2 });
  });

  it("floor-wraps negative coordinates like array math", () => {
    expect(chunkCellAt(-1, 0, 64)).toEqual({ col: -1, row: 0 });
    expect(chunkCellAt(-64, 0, 64)).toEqual({ col: -1, row: 0 });
    expect(chunkCellAt(-65, 0, 64)).toEqual({ col: -2, row: 0 });
  });

  it("rejects invalid input", () => {
    expect(() => chunkCellAt(Number.NaN, 0, 64)).toThrow(/finite/);
    expect(() => chunkCellAt(0, 0, 0)).toThrow(/positive integer/);
    expect(() => chunkCellAt(0, 0, 1.5)).toThrow(/positive integer/);
  });
});

describe("localOf", () => {
  it("computes in-chunk coordinates with negative wrap", () => {
    expect(localOf(0, 64)).toBe(0);
    expect(localOf(63, 64)).toBe(63);
    expect(localOf(64, 64)).toBe(0);
    expect(localOf(-1, 64)).toBe(63);
    expect(localOf(-64, 64)).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(() => localOf(Number.POSITIVE_INFINITY, 64)).toThrow(/invalid local/);
    expect(() => localOf(1, 0)).toThrow(/invalid local/);
  });
});

describe("toChunkLocal / toGlobal round-trip", () => {
  const chunkSize = 64;

  it("converts a global point into its chunk cell locals", () => {
    expect(toChunkLocal({ x: 70, y: 130 }, chunkSize)).toEqual({ x: 6, y: 2 });
  });

  it("round-trips global → local → global for every cell of a 3×3 grid sample", () => {
    for (const col of [0, 1, 2]) {
      for (const row of [0, 1, 2]) {
        const local = { x: (col * 31) % chunkSize, y: (row * 17) % chunkSize };
        const global = toGlobal({ col, row }, local, chunkSize);
        expect(chunkCellAt(global.x, global.y, chunkSize)).toEqual({ col, row });
        expect(toChunkLocal(global, chunkSize)).toEqual(local);
      }
    }
  });

  it("guards both directions on invalid input", () => {
    expect(() => toGlobal({ col: 0, row: 0 }, { x: Number.NaN, y: 0 }, 64)).toThrow(/finite/);
    expect(() => toGlobal({ col: 0, row: 0 }, { x: 0, y: 0 }, 0)).toThrow(/positive integer/);
  });
});
