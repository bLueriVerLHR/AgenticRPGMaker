/**
 * Shared test helpers (P1b).
 *
 * The renderer is browser-facing but the unit suite runs in the Node Vitest
 * environment, so real WebGL/Canvas2D contexts are not available. These stubs
 * stand in for the canvas, the GL context, the 2D context, the texture manager,
 * and the logger. They are honest doubles: the renderer consumes them only
 * through the documented structural types (CanvasLike/RenderContext) and the
 * public interfaces, so the same tests exercise the real code paths.
 */
import { vi } from "vitest";

import type { CanvasLike, RenderContext } from "../src/capability.js";
import type { RendererLogger } from "../src/logger.js";
import type { AtlasTextureManager } from "../src/texture-manager.js";
import type { FrameRect, TextureId } from "../src/index.js";

export interface StubCanvas extends CanvasLike {
  __handlers: Map<string, (event: Event) => void>;
}

/** Canvas stub: records context requests and exposes event dispatch for tests. */
export function createStubCanvas(
  options: {
    width?: number;
    height?: number;
    getContext?: (contextId: string, opts?: unknown) => unknown | null;
  } = {},
): StubCanvas {
  const handlers = new Map<string, (event: Event) => void>();
  const canvas: StubCanvas = {
    width: options.width ?? 320,
    height: options.height ?? 240,
    getContext: options.getContext ?? (() => null),
    addEventListener: (type, listener) => {
      handlers.set(type, listener);
    },
    removeEventListener: (type) => {
      handlers.delete(type);
    },
    __handlers: handlers,
  };
  return canvas;
}

export interface GLStub {
  stub: Record<string, unknown>;
  calls: {
    drawArrays: Array<[number, number, number]>;
    bufferData: Array<{ data: ArrayBufferView; usage: number }>;
  };
}

/** WebGL context stub recording draw calls; satisfies the GLContext surface. */
export function createGLStub(): GLStub {
  const calls = {
    drawArrays: [] as Array<[number, number, number]>,
    bufferData: [] as Array<{ data: ArrayBufferView; usage: number }>,
  };
  const stub: Record<string, unknown> = {
    // constants
    TEXTURE0: 33984,
    ARRAY_BUFFER: 34962,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    TRIANGLES: 4,
    COLOR_BUFFER_BIT: 16384,
    TEXTURE_2D: 3553,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    // objects
    createShader: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    getUniformLocation: vi.fn(() => ({})),
    // state
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => null),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => null),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
    useProgram: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn((target: number, data: ArrayBufferView, usage: number) => {
      calls.bufferData.push({ data, usage });
    }),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    viewport: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1i: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    drawArrays: vi.fn((mode: number, first: number, count: number) => {
      calls.drawArrays.push([mode, first, count]);
    }),
    // WebGL2 marker for isWebGL2Context
    texStorage2D: vi.fn(() => undefined),
  };
  return { stub, calls };
}

/** 2D context stub recording every draw/state call (mock context records calls). */
export interface Context2DStub {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  fn: (name: string) => ReturnType<typeof vi.fn>;
}

export function createContext2DStub(): Context2DStub {
  const calls: string[] = [];
  const fn = (name: string): ReturnType<typeof vi.fn> =>
    vi.fn(() => {
      calls.push(name);
    });
  const ctx: Record<string, unknown> = {
    setTransform: fn("setTransform"),
    clearRect: fn("clearRect"),
    save: fn("save"),
    restore: fn("restore"),
    translate: fn("translate"),
    rotate: fn("rotate"),
    scale: fn("scale"),
    drawImage: fn("drawImage"),
    fillText: fn("fillText"),
    fillRect: fn("fillRect"),
    strokeRect: fn("strokeRect"),
    measureText: vi.fn(() => ({ width: 12, actualBoundingBoxDescent: 4 })),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fn };
}

/** Texture manager stub implementing the full atlas surface. */
export function createStubTextureManager(
  overrides: Partial<AtlasTextureManager> = {},
): AtlasTextureManager & { load: ReturnType<typeof vi.fn>; getFrame: ReturnType<typeof vi.fn> } {
  const base: AtlasTextureManager & {
    load: ReturnType<typeof vi.fn>;
    getFrame: ReturnType<typeof vi.fn>;
  } = {
    load: vi.fn(async (url: string) => `tex:${url}`),
    dispose: vi.fn(),
    getFrame: vi.fn((_id: TextureId, _frame: number): FrameRect => ({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    })),
    frameCount: vi.fn(() => 1),
    setGrid: vi.fn(),
    getSource: vi.fn(() => ({ width: 64, height: 64 })),
    getRevision: vi.fn(() => 0),
    placements: vi.fn(() => new Map()),
  };
  return { ...base, ...overrides };
}

/** Recording logger stub. */
export function createStubLogger(): RendererLogger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A GL stub cast to the real context union for the renderer constructor. */
export function asGLContext(stub: Record<string, unknown>): WebGL2RenderingContext {
  return stub as unknown as WebGL2RenderingContext;
}

/** A 2D context stub cast to the real context type. */
export function asRenderContext(ctx: Record<string, unknown>): RenderContext {
  return ctx as unknown as RenderContext;
}
