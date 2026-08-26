/**
 * Registered texture tests (ADR-010 §4, S2).
 *
 * `registerTexture` / `drawTexture` / `textureReady` on both backends: the
 * async load lands in the drawable registry, readiness flips once the atlas
 * frame exists, screen-space draws ignore the world camera, and the fit math
 * from `fit.ts` reaches the draw calls on each backend.
 */
import { describe, expect, it } from "vitest";

import { Canvas2DRenderer } from "../src/canvas/canvas2d-renderer.js";
import { WebGLRenderer } from "../src/webgl/webgl-renderer.js";
import {
  asGLContext,
  createContext2DStub,
  createGLStub,
  createStubCanvas,
  createStubLogger,
  createStubTextureManager,
} from "./helpers.js";

/** Flush pending promise microtasks (the async texture load). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeCanvas2D() {
  const { ctx } = createContext2DStub();
  const canvas = createStubCanvas();
  Object.defineProperty(ctx, "canvas", { value: canvas, configurable: true });
  const tm = createStubTextureManager();
  const renderer = new Canvas2DRenderer({
    canvas,
    ctx,
    textureManager: tm,
    logger: createStubLogger(),
  });
  return { renderer, ctx, tm };
}

function makeWebGL() {
  const gl = createGLStub();
  const canvas = createStubCanvas({
    getContext: (id: string) => (id === "webgl2" ? gl.stub : null),
  });
  const tm = createStubTextureManager();
  const renderer = new WebGLRenderer({
    canvas,
    gl: asGLContext(gl.stub),
    textureManager: tm,
    logger: createStubLogger(),
    backend: "webgl2",
  });
  return { renderer, gl, tm };
}

describe("registerTexture / drawTexture (Canvas2D)", () => {
  it("loads asynchronously, flips readiness, and draws cover-scaled in screen space", async () => {
    const { renderer, ctx } = makeCanvas2D();
    expect(renderer.textureReady("cg")).toBe(false);
    renderer.registerTexture("cg", "img/cg/opening.png");
    renderer.drawTexture("cg", 0, 0, 320, 240); // not ready yet → no draw
    await flush();
    expect(renderer.textureReady("cg")).toBe(true);

    renderer.beginFrame();
    renderer.setCamera({ x: 77, y: 33, width: 160, height: 120 }, 2); // ignored
    renderer.drawTexture("cg", 0, 0, 320, 240);
    renderer.endFrame();

    const drawCalls = (ctx.drawImage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(drawCalls).toHaveLength(1);
    const args = drawCalls[0]! as [
      unknown,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    // Source = full 16x16 frame; dest = cover 320x320 centered (top overflows).
    expect(args.slice(1)).toEqual([0, 0, 16, 16, 0, -40, 320, 320]);
    const transforms = (ctx.setTransform as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(transforms).toContainEqual([1, 0, 0, 1, 0, 0]); // identity = screen space
  });

  it("fit mode letterboxes instead of overflowing", async () => {
    const { renderer, ctx } = makeCanvas2D();
    renderer.registerTexture("cg", "img/cg/ending.png");
    await flush();
    renderer.drawTexture("cg", 0, 0, 320, 240, "fit");
    const drawCalls = (ctx.drawImage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const args = drawCalls[0]! as [
      unknown,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    expect(args.slice(1)).toEqual([0, 0, 16, 16, 40, 0, 240, 240]);
  });

  it("drawing an unregistered id never reaches the context", async () => {
    const { renderer, ctx } = makeCanvas2D();
    renderer.drawTexture("missing", 0, 0, 320, 240);
    await flush();
    const drawCalls = (ctx.drawImage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(drawCalls).toHaveLength(0);
  });
});

describe("registerTexture / drawTexture (WebGL)", () => {
  it("batches the still under an identity projection and restores the camera", async () => {
    const { renderer, gl } = makeWebGL();
    renderer.registerTexture("cg", "img/cg/opening.png");
    await flush();
    expect(renderer.textureReady("cg")).toBe(true);

    renderer.beginFrame();
    renderer.setCamera({ x: 50, y: 60, width: 200, height: 150 }, 2);
    renderer.drawTexture("cg", 0, 0, 320, 240);
    renderer.endFrame();

    // One flush for the still (world batch empty), 6 vertices = one quad.
    expect(gl.calls.drawArrays).toEqual([[4, 0, 6]]);
    // Cover math reached the vertex buffer: top edge at y = -40.
    const vertexData = gl.calls.bufferData[0]!.data as Float32Array;
    const ys = new Set<number>();
    for (let v = 0; v < 6; v++) {
      ys.add(vertexData[v * 8 + 1]!); // interleave: x,y,u,v,r,g,b,a
    }
    expect(Math.min(...ys)).toBe(-40);
  });

  it("drawing an unregistered id emits no draw call", async () => {
    const { renderer, gl } = makeWebGL();
    renderer.beginFrame();
    renderer.drawTexture("missing", 0, 0, 320, 240);
    renderer.endFrame();
    expect(gl.calls.drawArrays).toHaveLength(0);
  });
});
