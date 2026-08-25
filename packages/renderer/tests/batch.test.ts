/**
 * SpriteBatch flush-logic tests (P1b, ADR-002).
 *
 * Verifies batching math: same-texture quads merge into one flush (one draw
 * call), flush happens on texture change and on capacity, and the interleaved
 * vertex layout is emitted correctly. Tested with a fake onFlush sink, so no
 * GL is involved.
 */
import { describe, expect, it } from "vitest";

import { SpriteBatch } from "../src/batch.js";
import { SpriteDrawEntry } from "../src/pool.js";

function makeEntry(overrides: Partial<SpriteDrawEntry> = {}): SpriteDrawEntry {
  const entry = new SpriteDrawEntry();
  entry.textureId = "tex:a";
  entry.x = 0;
  entry.y = 0;
  entry.w = 16;
  entry.h = 16;
  entry.u0 = 0;
  entry.v0 = 0;
  entry.u1 = 1;
  entry.v1 = 1;
  entry.r = 1;
  entry.g = 1;
  entry.b = 1;
  entry.a = 1;
  return Object.assign(entry, overrides);
}

describe("SpriteBatch flush logic (ADR-002)", () => {
  it("merges same-texture quads into a single flush", () => {
    const flushes: number[] = [];
    const batch = new SpriteBatch({ onFlush: (b) => flushes.push(b.quadCount) });
    batch.begin();
    batch.push(makeEntry({ x: 0 }));
    batch.push(makeEntry({ x: 32 }));
    batch.push(makeEntry({ x: 64 }));
    batch.flush();
    expect(flushes).toEqual([3]);
    expect(batch.quadCount).toBe(0);
    expect(batch.textureId).toBeNull();
  });

  it("flushes on texture change", () => {
    const flushes: number[] = [];
    const batch = new SpriteBatch({ onFlush: (b) => flushes.push(b.quadCount) });
    batch.begin();
    batch.push(makeEntry({ textureId: "tex:a" }));
    batch.push(makeEntry({ textureId: "tex:b" }));
    batch.push(makeEntry({ textureId: "tex:a" }));
    batch.flush();
    // change a->b (1), change b->a (1), explicit flush (1)
    expect(flushes).toEqual([1, 1, 1]);
  });

  it("flushes automatically when the buffer is full", () => {
    const flushes: number[] = [];
    const batch = new SpriteBatch({ maxQuads: 2, onFlush: (b) => flushes.push(b.quadCount) });
    batch.begin();
    batch.push(makeEntry());
    batch.push(makeEntry());
    batch.push(makeEntry()); // capacity reached -> auto flush of 2
    batch.flush(); // remaining 1
    expect(flushes).toEqual([2, 1]);
  });

  it("emits 6 interleaved vertices per quad in position/uv/color order", () => {
    const batch = new SpriteBatch({});
    batch.begin();
    batch.push(makeEntry());
    expect(batch.vertexCount).toBe(6); // before flush
    batch.flush();
    const v = batch.vertices;
    // vertex 0 = corner 0 (0,0), uv (0,0), white
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(0);
    expect(v[2]).toBe(0);
    expect(v[3]).toBe(0);
    expect(v[4]).toBe(1);
    expect(v[5]).toBe(1);
    expect(v[6]).toBe(1);
    expect(v[7]).toBe(1);
    // vertex 1 = corner 1 (16,0), uv (1,0)
    expect(v[8]).toBe(16);
    expect(v[9]).toBe(0);
    expect(v[10]).toBe(1);
    expect(v[11]).toBe(0);
    // vertex 2 = corner 2 (16,16), uv (1,1)
    expect(v[16]).toBe(16);
    expect(v[17]).toBe(16);
    expect(v[18]).toBe(1);
    expect(v[19]).toBe(1);
    // vertex 5 = corner 3 (0,16), uv (0,1) — second triangle
    expect(v[40]).toBe(0);
    expect(v[41]).toBe(16);
    expect(v[42]).toBe(0);
    expect(v[43]).toBe(1);
  });

  it("uses pre-transformed corners when provided", () => {
    const batch = new SpriteBatch({});
    batch.begin();
    const entry = makeEntry({ corners: new Float32Array([10, 10, 20, 10, 20, 20, 10, 20]) });
    batch.push(entry);
    batch.flush();
    expect(batch.vertices[0]).toBe(10);
    expect(batch.vertices[1]).toBe(10);
    expect(batch.vertices[8]).toBe(20);
    expect(batch.vertices[9]).toBe(10);
  });

  it("swaps UVs when flipping", () => {
    const batch = new SpriteBatch({});
    batch.begin();
    batch.push(makeEntry({ flipX: true }));
    batch.flush();
    // u0/u1 swapped: vertex 0 gets u1 (=1)
    expect(batch.vertices[2]).toBe(1);
    expect(batch.vertices[10]).toBe(0);
  });
});
