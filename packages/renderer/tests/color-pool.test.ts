/**
 * Color parsing + object-pool tests (P1b).
 */
import { describe, expect, it } from "vitest";

import { parseColor } from "../src/color.js";
import { ObjectPool, SpriteDrawEntry } from "../src/pool.js";

describe("parseColor", () => {
  it("defaults to white with the given opacity", () => {
    expect(parseColor(undefined)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("", 0.5)).toEqual({ r: 1, g: 1, b: 1, a: 0.5 });
  });

  it("parses #rgb shorthand", () => {
    expect(parseColor("#f00", 1)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor("#0f0", 1)).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it("parses #rrggbb", () => {
    expect(parseColor("#ff8000", 1)).toEqual({ r: 1, g: 0.5019607843137255, b: 0, a: 1 });
  });

  it("parses rgb() and rgba()", () => {
    expect(parseColor("rgb(255, 0, 0)", 1)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor("rgba(255,0,0,0.5)", 1)).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
  });

  it("multiplies tint alpha by opacity", () => {
    expect(parseColor("rgba(255,0,0,0.5)", 0.5).a).toBeCloseTo(0.25);
  });

  it("falls back to white for unknown formats", () => {
    expect(parseColor("not-a-color", 0.7)).toEqual({ r: 1, g: 1, b: 1, a: 0.7 });
  });

  it("clamps opacity and channels to 0..1", () => {
    expect(parseColor("#ffffff", 2).a).toBe(1);
    expect(parseColor("rgb(300,0,0)", 1).r).toBe(1);
  });
});

describe("ObjectPool", () => {
  it("reuses released entries (no growth beyond peak)", () => {
    const pool = new ObjectPool<SpriteDrawEntry>(() => new SpriteDrawEntry());
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBe(b);
    pool.release(a);
    const a2 = pool.acquire();
    expect(a2).toBe(a); // recycled
    expect(pool.freeCount).toBe(0);
    expect(pool.usedCount).toBe(2);
    pool.release(b);
    pool.release(a2);
    expect(pool.usedCount).toBe(0);
    expect(pool.freeCount).toBe(2);
  });

  it("resets entries on release", () => {
    const pool = new ObjectPool<SpriteDrawEntry>(() => new SpriteDrawEntry());
    const entry = pool.acquire();
    entry.textureId = "tex:x";
    entry.x = 42;
    entry.corners = new Float32Array(8);
    pool.release(entry);
    expect(entry.textureId).toBe("");
    expect(entry.x).toBe(0);
    expect(entry.corners).toBeNull();
    expect(entry.a).toBe(1);
  });

  it("respects maxFree", () => {
    const pool = new ObjectPool<SpriteDrawEntry>(() => new SpriteDrawEntry(), { maxFree: 1 });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b); // pool only keeps 1
    expect(pool.freeCount).toBe(1);
  });
});
