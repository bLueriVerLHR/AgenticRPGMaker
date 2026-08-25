/**
 * WebGLRenderer tests (P1b, ADR-002 default backend).
 *
 * The GL context is a stub recording draw calls; we assert batching (one draw
 * call per texture batch, flush on texture change), tile-layer culling, the
 * interleaved vertex upload, and the context-loss handlers (resource re-create
 * on restore, hot-swap hook on unrecoverable loss).
 */
import { describe, expect, it, vi } from "vitest";

import type { TileLayer, TilesetData } from "@agenticrpg/core";
import { WebGLRenderer } from "../src/webgl/webgl-renderer.js";
import {
  asGLContext,
  createGLStub,
  createStubCanvas,
  createStubLogger,
  createStubTextureManager,
  type StubCanvas,
} from "./helpers.js";

const TILESET: TilesetData = {
  schemaVersion: 1,
  id: "ts1",
  name: "grassland",
  image: "img.png",
  tileSize: 16,
  columns: 2,
  rows: 2,
};

function makeRenderer(
  options: {
    getContext?: (id: string) => unknown | null;
    onUnrecoverableLoss?: (reason: string) => void;
    maxQuads?: number;
  } = {},
) {
  const gl = createGLStub();
  const canvas = createStubCanvas({
    getContext: options.getContext ?? ((id: string) => (id === "webgl2" ? gl.stub : null)),
  });
  const tm = createStubTextureManager();
  const logger = createStubLogger();
  const renderer = new WebGLRenderer({
    canvas,
    gl: asGLContext(gl.stub),
    textureManager: tm,
    logger,
    backend: "webgl2",
    maxQuads: options.maxQuads,
    onUnrecoverableLoss: options.onUnrecoverableLoss,
  });
  return { renderer, gl, canvas, tm, logger };
}

describe("WebGLRenderer batching (ADR-002)", () => {
  it("emits a single draw call for a same-texture batch", () => {
    const { renderer, gl } = makeRenderer();
    renderer.beginFrame();
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.drawSprite("tex:a", 0, 32, 0);
    renderer.drawSprite("tex:a", 0, 64, 0);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(1);
    // 3 quads * 6 verts
    expect(gl.calls.drawArrays[0]).toEqual([4, 0, 18]);
  });

  it("flushes on texture change (one draw call per texture)", () => {
    const { renderer, gl } = makeRenderer();
    renderer.beginFrame();
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.drawSprite("tex:b", 0, 0, 0);
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(3);
    expect(gl.calls.drawArrays[0][2]).toBe(6);
    expect(gl.calls.drawArrays[1][2]).toBe(6);
    expect(gl.calls.drawArrays[2][2]).toBe(6);
  });

  it("uploads interleaved position/uv/color vertices", () => {
    const { renderer, gl } = makeRenderer();
    renderer.beginFrame();
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.endFrame();
    expect(gl.calls.bufferData).toHaveLength(1);
    const data = gl.calls.bufferData[0].data as Float32Array;
    expect(data.length).toBe(48); // 6 verts * 8 floats
    expect(data[0]).toBe(0); // x
    expect(data[1]).toBe(0); // y
    expect(data[2]).toBe(0); // u
    expect(data[3]).toBe(0); // v
    expect(data[4]).toBe(1); // r
  });

  it("drawRect uses the white placeholder texture (fill path)", () => {
    const { renderer, gl } = makeRenderer();
    renderer.beginFrame();
    renderer.drawRect(0, 0, 10, 10, "#ffffff");
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(1);
    expect(gl.calls.drawArrays[0][2]).toBe(6);
  });
});

describe("WebGLRenderer tiles (ADR-002/ADR-003)", () => {
  it("drawTileLayer emits only visible non-empty tiles (culling)", async () => {
    const { renderer, gl, tm } = makeRenderer();
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
    renderer.setCamera({ x: 0, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer, "ts1", 16);
    renderer.endFrame();
    // visible: (0,0),(1,0),(0,1) -> 3 quads = 18 verts
    expect(gl.calls.drawArrays).toHaveLength(1);
    expect(gl.calls.drawArrays[0]).toEqual([4, 0, 18]);
  });

  it("skips hidden layers and off-map tiles", async () => {
    const { renderer, gl, tm } = makeRenderer();
    const layer: TileLayer = {
      id: "hidden",
      name: "Hidden",
      type: "tile",
      opacity: 1,
      visible: true,
      data: [
        [1, 1],
        [1, 1],
      ],
    };
    renderer.beginFrame();
    // camera entirely off to the right of the 2x2 map (32px wide)
    renderer.setCamera({ x: 100, y: 0, width: 32, height: 32 }, 1);
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTileLayer(layer, "ts1", 16);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(0);
  });

  it("drawTile maps tile-space to pixels at the tileset size", async () => {
    const { renderer, gl, tm } = makeRenderer();
    renderer.beginFrame();
    renderer.registerTileset(TILESET);
    await tm.load("img.png");
    renderer.drawTile({ tilesetId: "ts1", index: 1 }, 2, 3);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(1);
    const data = gl.calls.bufferData[0].data as Float32Array;
    // corner 0 = (x*16, y*16) = (32, 48)
    expect(data[0]).toBe(32);
    expect(data[1]).toBe(48);
  });
});

describe("WebGLRenderer context loss (ADR-002)", () => {
  it("re-creates GPU resources on webglcontextrestored", () => {
    const { renderer, gl, canvas } = makeRenderer();
    const createShaderCallsBefore = (gl.stub.createShader as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const lostEvent = { preventDefault: vi.fn() } as unknown as Event;
    dispatch(canvas, "webglcontextlost", lostEvent);
    expect(lostEvent.preventDefault).toHaveBeenCalled();
    dispatch(canvas, "webglcontextrestored", {} as unknown as Event);
    const createShaderCallsAfter = (gl.stub.createShader as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(createShaderCallsAfter).toBeGreaterThan(createShaderCallsBefore);
    // renderer is usable again
    renderer.beginFrame();
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(1);
  });

  it("fires the hot-swap hook on unrecoverable loss", () => {
    const onLoss = vi.fn();
    const { renderer } = makeRenderer({ onUnrecoverableLoss: onLoss });
    renderer.handleUnrecoverableLoss("context-not-restored");
    expect(onLoss).toHaveBeenCalledWith("context-not-restored");
  });

  it("skips drawing while the context is lost", () => {
    const { renderer, gl, canvas } = makeRenderer();
    renderer.beginFrame();
    dispatch(canvas, "webglcontextlost", { preventDefault: vi.fn() } as unknown as Event);
    renderer.drawSprite("tex:a", 0, 0, 0);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(0);
  });
});

function dispatch(canvas: StubCanvas, type: string, event: Event): void {
  const handler = canvas.__handlers.get(type);
  if (handler !== undefined) {
    handler(event);
  }
}
