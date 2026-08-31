/**
 * Canvas2DRenderer tests (P1b, ADR-002 fallback).
 *
 * The mocked 2D context records every call; we assert the draw primitives map
 * to the right ctx calls with the right arguments (drawImage source rects,
 * fillText, fillRect/strokeRect) and that camera/transform use
 * save/setTransform/translate/scale/restore.
 */
import { describe, expect, it } from "vitest";

import type { TileLayer, TilesetData } from "@agenticrpg/core";
import { Canvas2DRenderer } from "../src/canvas/canvas2d-renderer.js";
import {
  createContext2DStub,
  createStubCanvas,
  createStubLogger,
  createStubTextureManager,
} from "./helpers.js";

function mockCalls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

function makeRenderer(
  overrides: { frames?: Array<{ x: number; y: number; width: number; height: number }> } = {},
) {
  const { ctx, calls } = createContext2DStub();
  const canvas = createStubCanvas();
  Object.defineProperty(ctx, "canvas", { value: canvas, configurable: true });
  const frames = overrides.frames ?? [{ x: 0, y: 0, width: 16, height: 16 }];
  const tm = createStubTextureManager({
    getFrame: (() => {
      const list = frames;
      return (id: string, frame: number) => list[frame] ?? { x: 0, y: 0, width: 16, height: 16 };
    })() as never,
  });
  const renderer = new Canvas2DRenderer({
    canvas,
    ctx,
    textureManager: tm,
    logger: createStubLogger(),
  });
  return { renderer, ctx, calls, tm };
}

const TILESET: TilesetData = {
  schemaVersion: 1,
  id: "ts1",
  name: "grassland",
  image: "img.png",
  tileSize: 16,
  columns: 2,
  rows: 2,
};

describe("Canvas2DRenderer (immediate mode)", () => {
  it("beginFrame clears the canvas and resets the transform", () => {
    const { renderer, ctx } = makeRenderer();
    renderer.beginFrame();
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 320, 240);
  });

  it("drawSprite maps to drawImage with the atlas source rect", () => {
    const { renderer, ctx } = makeRenderer({
      frames: [{ x: 32, y: 16, width: 16, height: 16 }],
    });
    renderer.beginFrame();
    renderer.drawSprite("tex:1", 0, 10, 20);
    const args = mockCalls(ctx.drawImage)[0];
    expect(args).toEqual([expect.anything(), 32, 16, 16, 16, 10, 20, 16, 16]);
  });

  it("drawTile uses the registered tileset size and index frame", async () => {
    const { renderer, ctx, tm } = makeRenderer({
      frames: [
        { x: 0, y: 0, width: 16, height: 16 },
        { x: 16, y: 0, width: 16, height: 16 },
      ],
    });
    renderer.beginFrame();
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTile({ tilesetId: "ts1", index: 1 }, 2, 3);
    const args = mockCalls(ctx.drawImage)[0];
    // dst = (x*tileSize, y*tileSize, tileSize, tileSize) = (32, 48, 16, 16)
    expect(args).toEqual([expect.anything(), 16, 0, 16, 16, 32, 48, 16, 16]);
  });

  it("drawText maps to fillText with font/color/align/baseline", () => {
    const { renderer, ctx } = makeRenderer();
    renderer.beginFrame();
    renderer.drawText("hello", 5, 6, {
      font: "24px monospace",
      color: "#ff0000",
      align: "center",
      baseline: "middle",
      opacity: 0.5,
    });
    expect(ctx.font).toBe("24px monospace");
    expect(ctx.fillStyle).toBe("#ff0000");
    expect(ctx.textAlign).toBe("center");
    expect(ctx.textBaseline).toBe("middle");
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 5, 6, undefined);
  });

  it("drawRect maps to fillRect and strokeRect", () => {
    const { renderer, ctx } = makeRenderer();
    renderer.beginFrame();
    renderer.drawRect(1, 2, 30, 40, "#00ff00", { color: "#000000", width: 2 });
    expect(ctx.fillStyle).toBe("#00ff00");
    expect(ctx.fillRect).toHaveBeenCalledWith(1, 2, 30, 40);
    expect(ctx.strokeStyle).toBe("#000000");
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.strokeRect).toHaveBeenCalledWith(1, 2, 30, 40);
  });

  it("camera + transform map to save/setTransform/translate/rotate/scale/restore", () => {
    const { renderer, ctx } = makeRenderer();
    renderer.beginFrame();
    renderer.setCamera({ x: 5, y: 10, width: 320, height: 240 }, 2);
    renderer.pushTransform({ translateX: 3, translateY: 4, scaleX: 1, scaleY: 1, rotation: 0 });
    renderer.drawRect(0, 0, 8, 8, "#ffffff");
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -10, -20);
    expect(ctx.translate).toHaveBeenCalledWith(3, 4);
    expect(ctx.scale).toHaveBeenCalledWith(1, 1);
    expect(ctx.restore).toHaveBeenCalled();
    expect(mockCalls(ctx.save).length).toBe(mockCalls(ctx.restore).length); // balanced
  });

  it("drawTileLayer emits only visible non-empty tiles (culling)", async () => {
    const { renderer, ctx, tm } = makeRenderer({
      frames: [{ x: 0, y: 0, width: 16, height: 16 }],
    });
    const layer: TileLayer = {
      id: "ground",
      name: "Ground",
      type: "tile",
      opacity: 1,
      visible: true,
      data: [
        [1, 1, 1, 1],
        [1, 0, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
      ],
    };
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1); // tiles (0..2, 0..2)
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer, "ts1", 16);
    // visible cells: (0,0),(1,0),(0,1) — (1,1) is 0/empty; cols/rows 2.. excluded
    expect(mockCalls(ctx.drawImage)).toHaveLength(3);
  });

  it("skip layer when invisible", () => {
    const { renderer, ctx } = makeRenderer();
    const layer: TileLayer = {
      id: "hidden",
      name: "Hidden",
      type: "tile",
      opacity: 1,
      visible: false,
      data: [
        [1, 1],
        [1, 1],
      ],
    };
    renderer.beginFrame();
    renderer.registerTileset(TILESET);
    renderer.drawTileLayer(layer, "ts1", 16);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("Canvas2DRenderer static-layer cache (task 13)", () => {
  interface CachingHarness {
    renderer: Canvas2DRenderer;
    ctx: CanvasRenderingContext2D;
    tm: ReturnType<typeof createStubTextureManager>;
    offscreen: Array<{ canvas: unknown; ctx: CanvasRenderingContext2D; calls: string[] }>;
  }

  function makeCachingRenderer(options: { revision?: () => number } = {}): CachingHarness {
    const { ctx } = createContext2DStub();
    const canvas = createStubCanvas();
    Object.defineProperty(ctx, "canvas", { value: canvas, configurable: true });
    const tm = createStubTextureManager({
      getRevision: (options.revision ?? (() => 0)) as never,
    });
    const offscreen: CachingHarness["offscreen"] = [];
    const renderer = new Canvas2DRenderer({
      canvas,
      ctx,
      textureManager: tm,
      logger: createStubLogger(),
      createCanvas: (width, height) => {
        const stub = createContext2DStub();
        const off = createStubCanvas({ width, height, getContext: () => stub.ctx });
        offscreen.push({ canvas: off, ctx: stub.ctx, calls: stub.calls });
        return off;
      },
    });
    return { renderer, ctx, tm, offscreen };
  }

  function layer2x2(): TileLayer {
    return {
      id: "ground",
      name: "Ground",
      type: "tile",
      opacity: 1,
      visible: true,
      data: [
        [1, 1],
        [1, 1],
      ],
    };
  }

  it("blits the cached layer once per frame instead of per visible tile", async () => {
    const { renderer, ctx, tm, offscreen } = makeCachingRenderer();
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer2x2(), "ts1", 16); // frame 1: build + blit
    renderer.drawTileLayer(layer2x2(), "ts1", 16); // frame 2: cache hit, blit only
    // Main context: exactly one drawImage per frame (the blit) = 2 total.
    expect(mockCalls(ctx.drawImage)).toHaveLength(2);
    // Offscreen context: built once, drawing all 4 non-empty tiles.
    expect(offscreen).toHaveLength(1);
    const offDraws = offscreen[0]!.calls.filter((c) => c === "drawImage");
    expect(offDraws).toHaveLength(4);
  });

  it("renders the correct visible region from the cache after the camera moves", async () => {
    const { renderer, ctx, tm } = makeCachingRenderer();
    const layer: TileLayer = {
      id: "ground",
      name: "Ground",
      type: "tile",
      opacity: 1,
      visible: true,
      data: Array.from({ length: 4 }, () => [1, 1, 1, 1]),
    };
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer, "ts1", 16); // build + blit (0,0,32,32)
    renderer.setCamera({ x: 32, y: 0, width: 32, height: 32 }, 1);
    renderer.drawTileLayer(layer, "ts1", 16); // blit visible cols 2..4
    const last = mockCalls(ctx.drawImage).at(-1)!;
    // source == dest rect == visible region in world/tile px: (32,0,32,32)
    expect(last).toEqual([expect.anything(), 32, 0, 32, 32, 32, 0, 32, 32]);
  });

  it("falls back to the per-tile path for oversized layers (no cache)", async () => {
    const { renderer, ctx, tm, offscreen } = makeCachingRenderer();
    const layer: TileLayer = {
      id: "huge",
      name: "Huge",
      type: "tile",
      opacity: 1,
      visible: true,
      data: Array.from({ length: 200 }, () => new Array<number>(200).fill(1)), // 10.24M px > budget
    };
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer, "ts1", 16);
    // Per-tile culled path: 2x2 visible = 4 drawImages; no offscreen canvas built.
    expect(mockCalls(ctx.drawImage)).toHaveLength(4);
    expect(offscreen).toHaveLength(0);
  });

  it("rebuilds the cache when the atlas revision changes", async () => {
    let revision = 0;
    const { renderer, ctx, tm, offscreen } = makeCachingRenderer({ revision: () => revision });
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer2x2(), "ts1", 16); // build
    renderer.drawTileLayer(layer2x2(), "ts1", 16); // cache hit
    expect(offscreen).toHaveLength(1);
    revision = 1;
    renderer.drawTileLayer(layer2x2(), "ts1", 16); // rebuild
    expect(offscreen).toHaveLength(2);
    expect(mockCalls(ctx.drawImage)).toHaveLength(3); // 3 blits, never per-tile
  });

  it("clearTileLayerCache() forces a rebuild on the next draw", async () => {
    const { renderer, ctx, tm, offscreen } = makeCachingRenderer();
    renderer.beginFrame();
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer2x2(), "ts1", 16);
    expect(offscreen).toHaveLength(1);
    renderer.clearTileLayerCache();
    renderer.drawTileLayer(layer2x2(), "ts1", 16);
    expect(offscreen).toHaveLength(2);
    expect(mockCalls(ctx.drawImage)).toHaveLength(2); // still one blit per frame
  });
});
