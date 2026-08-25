/**
 * WebGL context helpers (P1b).
 *
 * Small adapter over raw `getContext` so the factory can re-create contexts on
 * demand and tests can identify the context flavor from a stub.
 */
import type { CanvasLike } from "../capability.js";

/** The union of GL contexts both WebGL backends consume. */
export type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

/** Attributes passed when creating GL contexts (MVP needs no depth/stencil). */
const WEBGL_ATTRIBUTES: Record<string, unknown> = Object.freeze({
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
});

/** True when the context is a WebGL2 context (duck-typed; works on stubs too). */
export function isWebGL2Context(ctx: GLContext): ctx is WebGL2RenderingContext {
  return typeof (ctx as WebGL2RenderingContext).texStorage2D === "function";
}

/**
 * Create a GL context of the requested flavor on a canvas. Returns null when
 * the flavor is unavailable. WebGL1 also tries `experimental-webgl`.
 */
export function createGLContext(canvas: CanvasLike, kind: "webgl2" | "webgl1"): GLContext | null {
  if (kind === "webgl2") {
    return canvas.getContext("webgl2", WEBGL_ATTRIBUTES) as GLContext | null;
  }
  const webgl1 =
    (canvas.getContext("webgl", WEBGL_ATTRIBUTES) as GLContext | null) ??
    (canvas.getContext("experimental-webgl", WEBGL_ATTRIBUTES) as GLContext | null);
  return webgl1;
}
