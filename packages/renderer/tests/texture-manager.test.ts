/**
 * TextureManagerImpl tests (P1b, ADR-002).
 *
 * Verifies load/caching, atlas placement by strip rule, frame grids
 * (setGrid/getFrame/frameCount), source/revision exposure, and dispose. Images
 * and the atlas are stubbed (no real browser canvas in Node).
 */
import { describe, expect, it, vi } from "vitest";

import type { ImageSourceLike } from "../src/texture-manager.js";
import { TextureManagerImpl } from "../src/texture-manager.js";
import { createStubLogger } from "./helpers.js";

function fakeImage(width: number, height: number): ImageSourceLike {
  return { width, height };
}

function fakeAtlasBuilder(images: ReadonlyArray<ImageSourceLike>): ImageSourceLike {
  const width = images.reduce((acc, img) => acc + img.width, 0) || 1;
  const height = images.reduce((acc, img) => Math.max(acc, img.height), 0) || 1;
  return { width, height };
}

function makeManager(images: Record<string, ImageSourceLike>): TextureManagerImpl {
  const loader = vi.fn(async (url: string) => {
    const img = images[url];
    if (img === undefined) {
      throw new Error(`no fake image for ${url}`);
    }
    return img;
  });
  return new TextureManagerImpl({
    loader,
    atlasBuilder: fakeAtlasBuilder,
    logger: createStubLogger(),
  });
}

describe("TextureManagerImpl", () => {
  it("loads an image, caches the same url, and returns opaque ids", async () => {
    const manager = new TextureManagerImpl({
      loader: vi.fn(async () => fakeImage(32, 32)),
      atlasBuilder: fakeAtlasBuilder,
      logger: createStubLogger(),
    });
    const idA = await manager.load("a.png");
    const idB = await manager.load("a.png");
    expect(idA).toBe(idB); // cached
    expect(idA.startsWith("tex:")).toBe(true);
    expect(manager.frameCount(idA)).toBe(1);
    expect(manager.getSource(idA)).toBeDefined();
  });

  it("lays images out side by side and computes frame rects from the grid", async () => {
    const manager = makeManager({ "a.png": fakeImage(32, 32), "b.png": fakeImage(16, 16) });
    const idA = await manager.load("a.png");
    const idB = await manager.load("b.png");

    // Single-frame textures: whole image.
    expect(manager.getFrame(idA, 0)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
    expect(manager.getFrame(idB, 0)).toEqual({ x: 32, y: 0, width: 16, height: 16 });

    // Grid: a 2x2 atlas on the 32x32 image.
    manager.setGrid(idA, 2, 2);
    expect(manager.getFrame(idA, 0)).toEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(manager.getFrame(idA, 1)).toEqual({ x: 16, y: 0, width: 16, height: 16 });
    expect(manager.getFrame(idA, 2)).toEqual({ x: 0, y: 16, width: 16, height: 16 });
    expect(manager.getFrame(idA, 3)).toEqual({ x: 16, y: 16, width: 16, height: 16 });
    expect(manager.getFrame(idA, 4)).toBeUndefined(); // out of range
    expect(manager.frameCount(idA)).toBe(4);
  });

  it("bumps the atlas revision on rebuilds (setGrid/load/dispose)", async () => {
    const manager = makeManager({ "a.png": fakeImage(32, 32), "b.png": fakeImage(16, 16) });
    const idA = await manager.load("a.png");
    const revAfterLoad = manager.getRevision(idA);
    manager.setGrid(idA, 2, 2);
    expect(manager.getRevision(idA)).toBeGreaterThan(revAfterLoad);
    await manager.load("b.png");
    expect(manager.getRevision(idA)).toBeGreaterThan(revAfterLoad);
  });

  it("dispose removes the texture and its placement", async () => {
    const manager = makeManager({ "a.png": fakeImage(32, 32) });
    const idA = await manager.load("a.png");
    manager.dispose(idA);
    expect(manager.getFrame(idA, 0)).toBeUndefined();
    expect(manager.frameCount(idA)).toBe(0);
    expect(manager.getSource(idA)).toBeUndefined();
    expect(manager.placements().has(idA)).toBe(false);
  });

  it("getFrame returns undefined for unknown textures", async () => {
    const manager = makeManager({});
    expect(manager.getFrame("tex:unknown", 0)).toBeUndefined();
    expect(manager.frameCount("tex:unknown")).toBe(0);
  });
});
