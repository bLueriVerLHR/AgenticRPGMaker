/**
 * Renderer factory + capability gate (P1b, ADR-002).
 *
 * Strategy + Factory: `detectCapability` picks the backend (WebGL2 → WebGL1 →
 * Canvas2D), and the factory instantiates the matching implementation. The
 * chosen backend is logged at `info` and exposed via `getCapability()` for the
 * About/debug UI. Context loss on the WebGL path hot-swaps to Canvas2D.
 *
 * `createRenderer(canvas | context)` is the convenient entry point; the
 * `RendererFactory` interface from P0 is implemented by `DefaultRendererFactory`.
 */
import type { Renderer, RendererFactory, RendererFactoryOptions } from "./index.js";
import type { RendererBackend, RendererCapability } from "./index.js";
import type { RendererLogger } from "./logger.js";
import { defaultRendererLogger, noopRendererLogger } from "./logger.js";
import { detectCapability } from "./capability.js";
import type { CanvasLike, RenderContext } from "./capability.js";
import { asAtlasTextureManager, TextureManagerImpl } from "./texture-manager.js";
import type { AtlasTextureManager } from "./texture-manager.js";
import { WebGLRenderer } from "./webgl/webgl-renderer.js";
import type { GLContext } from "./webgl/gl-context.js";
import { isWebGL2Context } from "./webgl/gl-context.js";
import { Canvas2DRenderer } from "./canvas/canvas2d-renderer.js";

export interface DefaultRendererFactoryOptions {
  logger?: RendererLogger;
  /** Supplies replacement canvases for hot-swap (default: `document.createElement`). */
  canvasFactory?: () => CanvasLike;
  /** Watchdog for unrecoverable WebGL context loss, in ms (0 = disabled). */
  contextLossWatchdogMs?: number;
}

export class DefaultRendererFactory implements RendererFactory {
  private readonly logger: RendererLogger;
  private readonly canvasFactory: () => CanvasLike;
  private readonly watchdogMs: number;
  private readonly defaultTextureManager: AtlasTextureManager;
  private capabilityValue: RendererCapability | null = null;
  private currentValue: Renderer | null = null;

  constructor(options: DefaultRendererFactoryOptions = {}) {
    this.logger = options.logger ?? noopRendererLogger;
    this.canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
    this.watchdogMs = options.contextLossWatchdogMs ?? 2000;
    this.defaultTextureManager = new TextureManagerImpl({ logger: this.logger });
  }

  create(options: RendererFactoryOptions): Renderer {
    const canvas = options.canvas as CanvasLike;
    const textureManager = asAtlasTextureManager(
      options.textureManager ?? this.defaultTextureManager,
      this.logger,
    );
    const detection = detectCapability({ canvas, logger: this.logger });
    this.capabilityValue = detection;
    if (!detection.supported || detection.context === null) {
      this.logger.error("renderer factory: no backend available", {
        reason: detection.reason,
      });
      throw new Error(`no renderer backend available: ${detection.reason ?? "unknown"}`);
    }

    const backend = detection.backend;
    let renderer: Renderer;
    if (backend === "webgl2" || backend === "webgl1") {
      const webgl = new WebGLRenderer({
        canvas,
        gl: detection.context as GLContext,
        textureManager,
        logger: this.logger,
        backend,
        onUnrecoverableLoss: (reason) => {
          this.logger.warn("renderer factory: webgl context unrecoverable; hot-swapping", {
            reason,
          });
          try {
            renderer = this.hotSwapToCanvas2D(reason);
          } catch (error: unknown) {
            this.logger.error("renderer factory: hot-swap failed", {
              reason,
              error: String(error),
            });
          }
        },
        watchdogMs: this.watchdogMs,
      });
      renderer = webgl;
    } else {
      renderer = new Canvas2DRenderer({
        canvas,
        ctx: detection.context as CanvasRenderingContext2D,
        textureManager,
        logger: this.logger,
      });
    }
    this.currentValue = renderer;
    return renderer;
  }

  /** Create a Canvas2D renderer on a fresh canvas (unrecoverable WebGL loss). */
  hotSwapToCanvas2D(reason: string): Canvas2DRenderer {
    const canvas = this.canvasFactory();
    const ctx = canvas.getContext("2d");
    if (ctx === null || ctx === undefined) {
      throw new Error("hot-swap to canvas2d failed: no 2D context on replacement canvas");
    }
    const renderer = new Canvas2DRenderer({
      canvas,
      ctx: ctx as CanvasRenderingContext2D,
      textureManager: this.defaultTextureManager,
      logger: this.logger,
    });
    this.currentValue = renderer;
    this.capabilityValue = { backend: "canvas2d", supported: true, reason };
    this.logger.info("renderer hot-swapped to canvas2d", { reason });
    return renderer;
  }

  /** The last capability-detection result (About/debug hook, ADR-002). */
  getCapability(): RendererCapability | null {
    return this.capabilityValue;
  }

  /** The most recently created renderer. */
  getCurrentRenderer(): Renderer | null {
    return this.currentValue;
  }
}

export interface RendererCreateOptions {
  textureManager?: RendererFactoryOptions["textureManager"];
  logger?: RendererLogger;
  /** Explicit backend label when a raw context is supplied (stubs in tests). */
  kind?: "webgl2" | "webgl1" | "canvas2d";
  canvasFactory?: () => CanvasLike;
}

/**
 * Create a renderer from a canvas (capability-detected) or an already-created
 * context. When a context is given, the backend is inferred (or taken from
 * `options.kind`).
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  options?: RendererCreateOptions,
): Renderer;
export function createRenderer(
  context: RenderContext,
  options?: RendererCreateOptions,
): Renderer;
export function createRenderer(
  input: HTMLCanvasElement | RenderContext,
  options: RendererCreateOptions = {},
): Renderer {
  const factory = new DefaultRendererFactory({
    logger: options.logger,
    canvasFactory: options.canvasFactory,
  });
  if (isCanvasInput(input)) {
    return factory.create({
      canvas: input,
      textureManager: options.textureManager,
    });
  }
  return createRendererFromContext(input, options, factory);
}

function isCanvasInput(input: HTMLCanvasElement | RenderContext): input is HTMLCanvasElement {
  return typeof (input as { getContext?: unknown }).getContext === "function";
}

function createRendererFromContext(
  context: RenderContext,
  options: RendererCreateOptions,
  factory: DefaultRendererFactory,
): Renderer {
  const logger = options.logger ?? defaultRendererLogger;
  const textureManager = asAtlasTextureManager(
    options.textureManager ?? new TextureManagerImpl({ logger }),
    logger,
  );
  const canvas = (context as { canvas?: unknown }).canvas as CanvasLike | undefined;
  if (canvas === undefined) {
    throw new Error("renderer: context does not expose a canvas");
  }
  const backend: RendererBackend | undefined = options.kind ?? inferBackend(context);
  let renderer: Renderer;
  if (backend === "webgl2" || backend === "webgl1") {
    renderer = new WebGLRenderer({
      canvas,
      gl: context as GLContext,
      textureManager,
      logger,
      backend,
      onUnrecoverableLoss: (reason) => {
        logger.warn("renderer: webgl context unrecoverable; hot-swap requested", { reason });
        factory.hotSwapToCanvas2D(reason);
      },
    });
  } else {
    renderer = new Canvas2DRenderer({
      canvas,
      ctx: context as CanvasRenderingContext2D,
      textureManager,
      logger,
    });
  }
  return renderer;
}

function inferBackend(context: RenderContext): RendererBackend {
  if (isWebGL2Context(context as GLContext)) {
    return "webgl2";
  }
  if (typeof (context as WebGLRenderingContext).createShader === "function") {
    return "webgl1";
  }
  return "canvas2d";
}

function defaultCanvasFactory(): CanvasLike {
  if (typeof document === "undefined") {
    throw new Error("no canvas factory available outside a browser DOM");
  }
  return document.createElement("canvas") as CanvasLike;
}
