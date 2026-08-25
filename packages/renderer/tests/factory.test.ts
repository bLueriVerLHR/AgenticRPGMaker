/**
 * Factory + capability-gate tests (P1b, ADR-002).
 *
 * Verifies the factory returns the right backend per detection, throws when no
 * backend exists, and that `createRenderer(canvas | context)` builds the
 * expected implementation. All contexts are stubs.
 */
import { describe, expect, it } from "vitest";

import { createRenderer, DefaultRendererFactory } from "../src/factory.js";
import { WebGLRenderer } from "../src/webgl/webgl-renderer.js";
import { Canvas2DRenderer } from "../src/canvas/canvas2d-renderer.js";
import {
  asGLContext,
  asRenderContext,
  createContext2DStub,
  createGLStub,
  createStubCanvas,
  createStubLogger,
  createStubTextureManager,
} from "./helpers.js";

describe("DefaultRendererFactory (strategy + capability gate)", () => {
  it("returns a WebGLRenderer when webgl2 is detected", () => {
    const gl = createGLStub();
    const canvas = createStubCanvas({ getContext: (id) => (id === "webgl2" ? gl.stub : null) });
    const factory = new DefaultRendererFactory({ logger: createStubLogger() });
    const renderer = factory.create({
      canvas: canvas as unknown as HTMLCanvasElement,
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(WebGLRenderer);
    expect(renderer.getBackend()).toBe("webgl2");
    expect(factory.getCapability()?.backend).toBe("webgl2");
    expect(factory.getCurrentRenderer()).toBe(renderer);
  });

  it("returns a Canvas2DRenderer when only 2d is available", () => {
    const ctx = createContext2DStub();
    const canvas = createStubCanvas({
      getContext: (id) => (id === "2d" ? (ctx.ctx as unknown as Record<string, unknown>) : null),
    });
    const factory = new DefaultRendererFactory({ logger: createStubLogger() });
    const renderer = factory.create({
      canvas: canvas as unknown as HTMLCanvasElement,
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(Canvas2DRenderer);
    expect(renderer.getBackend()).toBe("canvas2d");
  });

  it("throws when no backend is available", () => {
    const canvas = createStubCanvas({ getContext: () => null });
    const factory = new DefaultRendererFactory({ logger: createStubLogger() });
    expect(() =>
      factory.create({
        canvas: canvas as unknown as HTMLCanvasElement,
        textureManager: createStubTextureManager(),
      }),
    ).toThrow(/no renderer backend available/);
  });

  it("createRenderer(canvas) builds the webgl backend per detection", () => {
    const gl = createGLStub();
    const canvas = createStubCanvas({ getContext: (id) => (id === "webgl2" ? gl.stub : null) });
    const renderer = createRenderer(canvas as unknown as HTMLCanvasElement, {
      logger: createStubLogger(),
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(WebGLRenderer);
    expect(renderer.getBackend()).toBe("webgl2");
  });

  it("createRenderer(context) wraps an existing 2d context", () => {
    const { ctx } = createContext2DStub();
    const canvas = createStubCanvas();
    Object.defineProperty(ctx, "canvas", { value: canvas, configurable: true });
    const renderer = createRenderer(asRenderContext(ctx), {
      logger: createStubLogger(),
      kind: "canvas2d",
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(Canvas2DRenderer);
    expect(renderer.getBackend()).toBe("canvas2d");
  });

  it("createRenderer(context) infers webgl2 via duck-typing", () => {
    const gl = createGLStub();
    const canvas = createStubCanvas();
    Object.defineProperty(gl.stub, "canvas", { value: canvas, configurable: true });
    const renderer = createRenderer(asGLContext(gl.stub) as never, {
      logger: createStubLogger(),
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(WebGLRenderer);
    expect(renderer.getBackend()).toBe("webgl2");
  });

  it("hotSwapToCanvas2D produces a canvas2d renderer (unrecoverable loss path)", () => {
    const gl = createGLStub();
    const canvas = createStubCanvas({ getContext: (id) => (id === "webgl2" ? gl.stub : null) });
    const factory = new DefaultRendererFactory({
      logger: createStubLogger(),
      canvasFactory: () => createStubCanvas({ getContext: (id) => (id === "2d" ? {} : null) }),
    });
    const renderer = factory.create({
      canvas: canvas as unknown as HTMLCanvasElement,
      textureManager: createStubTextureManager(),
    });
    expect(renderer).toBeInstanceOf(WebGLRenderer);
    const swapped = factory.hotSwapToCanvas2D("context-not-restored");
    expect(swapped).toBeInstanceOf(Canvas2DRenderer);
    expect(factory.getCapability()?.backend).toBe("canvas2d");
    expect(factory.getCurrentRenderer()).toBe(swapped);
  });
});
