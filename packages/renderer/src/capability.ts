/**
 * Renderer capability detection (P1b, ADR-002).
 *
 * Probes the canvas in the mandated order — WebGL2 → WebGL1 → Canvas2D — and
 * returns the chosen backend plus the successfully created context, logged at
 * `info` so the selected backend is diagnosable from logs alone (ADR-002).
 *
 * The probe is injectable so tests can stub GL/2D availability without a real
 * browser; the default probe delegates to `canvas.getContext`.
 */
import type { RendererBackend, RendererCapability } from "./index.js";
import type { RendererLogger } from "./logger.js";
import { noopRendererLogger } from "./logger.js";

/** Structural canvas: a real `HTMLCanvasElement` in the browser, a stub in tests. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: string, options?: Record<string, unknown>): unknown | null;
  addEventListener?(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
}

/** Union of the real rendering contexts the backends consume. */
export type RenderContext = CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext;

/** Context kinds probed in order (ADR-002: WebGL2 → WebGL1 → Canvas2D). */
export type ContextKind = "webgl2" | "webgl" | "2d";

export const CAPABILITY_PROBE_ORDER: readonly ContextKind[] = ["webgl2", "webgl", "2d"];

/** Context attributes passed while probing (MVP needs no depth/stencil). */
export const CAPABILITY_CONTEXT_ATTRIBUTES: Readonly<Record<string, unknown>> = Object.freeze({
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
});

/** Injectable context-probe function (tests substitute this to stub availability). */
export type ContextProbe = (kind: ContextKind, canvas: CanvasLike) => unknown | null;

export interface CapabilityDetectionOptions {
  canvas: CanvasLike;
  /** Custom probe; defaults to `canvas.getContext`. */
  probe?: ContextProbe;
  logger?: RendererLogger;
}

export interface CapabilityDetectionResult extends RendererCapability {
  /** The successfully created context, or null when unsupported. */
  context: RenderContext | null;
  /** What was probed, in order, and whether each kind was available (debug aid). */
  probes: ReadonlyArray<{ kind: ContextKind; available: boolean }>;
}

const WEBGL1_NAMES: readonly string[] = ["webgl", "experimental-webgl"];

function defaultProbe(kind: ContextKind, canvas: CanvasLike): unknown | null {
  if (kind === "webgl2") {
    return canvas.getContext("webgl2", CAPABILITY_CONTEXT_ATTRIBUTES);
  }
  if (kind === "webgl") {
    for (const name of WEBGL1_NAMES) {
      const ctx = canvas.getContext(name, CAPABILITY_CONTEXT_ATTRIBUTES);
      if (ctx !== null && ctx !== undefined) {
        return ctx;
      }
    }
    return null;
  }
  return canvas.getContext("2d", CAPABILITY_CONTEXT_ATTRIBUTES);
}

function toBackend(kind: ContextKind): RendererBackend {
  if (kind === "webgl2") {
    return "webgl2";
  }
  if (kind === "webgl") {
    return "webgl1";
  }
  return "canvas2d";
}

export function detectCapability(options: CapabilityDetectionOptions): CapabilityDetectionResult {
  const probe = options.probe ?? defaultProbe;
  const logger = options.logger ?? noopRendererLogger;
  const probes: Array<{ kind: ContextKind; available: boolean }> = [];

  for (const kind of CAPABILITY_PROBE_ORDER) {
    const ctx = probe(kind, options.canvas);
    const available = ctx !== null && ctx !== undefined;
    probes.push({ kind, available });
    if (available) {
      const backend = toBackend(kind);
      logger.info("renderer capability: selected backend", {
        backend,
        canvas: { width: options.canvas.width, height: options.canvas.height },
      });
      return {
        backend,
        supported: true,
        context: ctx as RenderContext,
        probes,
      };
    }
  }

  const result: CapabilityDetectionResult = {
    backend: "canvas2d",
    supported: false,
    reason: "no usable rendering context (WebGL2, WebGL1, and 2D all unavailable)",
    context: null,
    probes,
  };
  logger.warn("renderer capability: no usable backend", { reason: result.reason });
  return result;
}
