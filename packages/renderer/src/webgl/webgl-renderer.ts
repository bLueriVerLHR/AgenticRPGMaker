/**
 * WebGLRenderer — default backend (P1b, ADR-002).
 *
 * Implements the `Renderer` + `TileMapRenderer` surfaces over a WebGL1/2
 * context:
 * - 2D sprite batching through `SpriteBatch` (dynamic interleaved vertex
 *   buffer, flush on texture change / capacity / endFrame);
 * - tile layers drawn per-layer as culled quad meshes from core map indices;
 * - one minimal textured-quad shader pair (position/uv/tint-alpha);
 * - a TextureManager atlas uploaded lazily per texture;
 * - object pooling for sprite draw entries;
 * - `webglcontextlost`/`webglcontextrestored` handling that re-creates GPU
 *   resources, with a hot-swap hook (factory swaps to Canvas2D) on
 *   unrecoverable loss.
 */
import type { TileLayer, TilesetData } from "@agenticrpg/core";
import type {
  DrawOptions,
  Renderer,
  RectStroke,
  TextDrawOptions,
  TileRef,
  Transform,
  Viewport,
  TextureId,
  RendererBackend,
} from "../index.js";
import type { CanvasLike } from "../capability.js";
import type { RendererLogger } from "../logger.js";
import { noopRendererLogger } from "../logger.js";
import type { AtlasTextureManager, ImageSourceLike } from "../texture-manager.js";
import { SpriteBatch } from "../batch.js";
import { ObjectPool, SpriteDrawEntry } from "../pool.js";
import { ShaderProgram } from "./shader.js";
import type { GLContext } from "./gl-context.js";
import { isWebGL2Context } from "./gl-context.js";
import { parseColor } from "../color.js";
import {
  mat3Identity,
  mat3Multiply,
  mat3Ortho,
  mat3Rotation,
  mat3Scale,
  mat3TransformPoint,
  mat3Translation,
  type Mat3,
} from "../math/mat3.js";
import { computeVisibleTileRange, isTileRangeEmpty } from "../tiles.js";
import { TilesetRegistry } from "../tileset-registry.js";
import type { TileMapRenderer } from "../tilemap.js";

const FLOATS_PER_VERTEX = 8;
const VERTEX_STRIDE_BYTES = FLOATS_PER_VERTEX * 4;

/** Synthetic texture ids for renderer-owned resources. */
const WHITE_TEXTURE_ID: TextureId = "__renderer_white__";
const TEXT_TEXTURE_ID: TextureId = "__renderer_text__";

export interface WebGLRendererOptions {
  canvas: CanvasLike;
  gl: GLContext;
  textureManager: AtlasTextureManager;
  logger?: RendererLogger;
  backend?: "webgl2" | "webgl1";
  maxQuads?: number;
  clearColor?: readonly [number, number, number, number];
  /** Called when an unrecoverable context loss is detected (factory hot-swaps to Canvas2D). */
  onUnrecoverableLoss?: (reason: string) => void;
  /** Optional watchdog: fire hot-swap if the context is still lost after N ms. 0 = disabled. */
  watchdogMs?: number;
}

export class WebGLRenderer implements Renderer, TileMapRenderer {
  readonly textureManager: AtlasTextureManager;
  private readonly canvas: CanvasLike;
  private readonly gl: GLContext;
  private readonly backend: "webgl2" | "webgl1";
  private readonly logger: RendererLogger;
  private readonly batch: SpriteBatch;
  private readonly entries: ObjectPool<SpriteDrawEntry>;
  private readonly tilesets: TilesetRegistry;
  private readonly onUnrecoverableLoss?: (reason: string) => void;
  private readonly clearColor: readonly [number, number, number, number];
  private readonly glTextures = new Map<TextureId, WebGLTexture>();
  private readonly glTextureRevisions = new Map<TextureId, number>();
  private readonly transformStack: Transform[] = [];
  private readonly whiteTextureId = WHITE_TEXTURE_ID;

  private camera: Viewport = { x: 0, y: 0, width: 0, height: 0 };
  private zoom = 1;
  private program: ShaderProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private lost = false;
  private disposed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private textCanvasValue: HTMLCanvasElement | null = null;
  private textContextValue: CanvasRenderingContext2D | null = null;
  private textRevision = 0;

  constructor(options: WebGLRendererOptions) {
    this.canvas = options.canvas;
    this.gl = options.gl;
    this.backend = options.backend ?? (isWebGL2Context(options.gl) ? "webgl2" : "webgl1");
    this.textureManager = options.textureManager;
    this.logger = options.logger ?? noopRendererLogger;
    this.clearColor = options.clearColor ?? [0, 0, 0, 0];
    this.onUnrecoverableLoss = options.onUnrecoverableLoss;
    this.entries = new ObjectPool<SpriteDrawEntry>(() => new SpriteDrawEntry());
    this.tilesets = new TilesetRegistry(this.textureManager, this.logger);
    this.batch = new SpriteBatch({
      maxQuads: options.maxQuads,
      onFlush: (batch) => this.flushBatch(batch),
    });
    this.camera = { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height };
    this.initGL();
    this.canvas.addEventListener?.("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener?.("webglcontextrestored", this.onContextRestored);
    if (options.watchdogMs !== undefined && options.watchdogMs > 0) {
      this.armWatchdog(options.watchdogMs);
    }
    this.logger.info("webgl renderer created", {
      backend: this.backend,
      width: this.canvas.width,
      height: this.canvas.height,
    });
  }

  /** The selected backend, for the About/debug hook (ADR-002). */
  getBackend(): RendererBackend {
    return this.backend;
  }

  isLost(): boolean {
    return this.lost;
  }

  beginFrame(): void {
    if (this.lost) {
      return;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.transformStack.length = 0;
    this.batch.begin();
  }

  endFrame(): void {
    if (this.lost) {
      return;
    }
    this.batch.flush();
  }

  drawSprite(textureId: TextureId, frame: number, x: number, y: number, opts?: DrawOptions): void {
    if (this.lost) {
      return;
    }
    const frameRect = this.textureManager.getFrame(textureId, frame);
    if (frameRect === undefined) {
      this.logger.debug("drawSprite: frame not found", { textureId, frame });
      return;
    }
    const source = this.textureManager.getSource(textureId);
    if (source === undefined) {
      this.logger.debug("drawSprite: texture not uploaded", { textureId });
      return;
    }
    this.pushQuad(textureId, x, y, frameRect.width, frameRect.height, frameRect, source, opts);
  }

  drawTile(tile: TileRef, x: number, y: number, opts?: DrawOptions): void {
    if (this.lost) {
      return;
    }
    const binding = this.tilesets.bindingFor(tile.tilesetId);
    if (binding === undefined) {
      this.logger.debug("drawTile: unknown tileset", { tilesetId: tile.tilesetId });
      return;
    }
    const frameRect = this.textureManager.getFrame(binding.textureId, tile.index);
    const source = this.textureManager.getSource(binding.textureId);
    if (frameRect === undefined || source === undefined) {
      this.logger.debug("drawTile: tile frame not ready", {
        tilesetId: tile.tilesetId,
        index: tile.index,
      });
      return;
    }
    const size = binding.tileSize;
    this.pushQuad(binding.textureId, x * size, y * size, size, size, frameRect, source, opts);
  }

  drawText(text: string, x: number, y: number, opts?: TextDrawOptions): void {
    if (this.lost) {
      return;
    }
    const canvas = this.textCanvas();
    const ctx = this.textContextValue;
    if (canvas === null || ctx === null) {
      this.logger.warn("drawText: text rasterization unavailable (no DOM 2D canvas)", {});
      return;
    }
    const font = opts?.font ?? "16px sans-serif";
    ctx.font = font;
    ctx.textBaseline = "top";
    const metrics = ctx.measureText(text);
    const width = Math.max(2, Math.ceil(metrics.width) + 2);
    const height = Math.max(2, parseFontSizePx(font) + 2);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      ctx.font = font;
      ctx.textBaseline = "top";
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = opts?.color ?? "#ffffff";
    ctx.fillText(text, 1, 1);

    let dx = x;
    let dy = y;
    if (opts?.align === "center") {
      dx -= width / 2;
    } else if (opts?.align === "right") {
      dx -= width;
    }
    if (opts?.baseline === "middle") {
      dy -= height / 2;
    } else if (opts?.baseline === "bottom") {
      dy -= height;
    }

    this.textRevision += 1;
    this.ensureTexture(TEXT_TEXTURE_ID, { width, height, raw: canvas }, this.textRevision, true);
    this.pushQuadRaw(TEXT_TEXTURE_ID, dx, dy, width, height, 0, 0, 1, 1, opts, 1);
  }

  drawRect(x: number, y: number, w: number, h: number, fill?: string, stroke?: RectStroke): void {
    if (this.lost) {
      return;
    }
    this.ensureTexture(this.whiteTextureId, undefined, 0);
    if (fill !== undefined) {
      this.pushQuadRaw(this.whiteTextureId, x, y, w, h, 0, 0, 1, 1, { tint: fill }, 1);
    }
    if (stroke !== undefined) {
      const half = stroke.width / 2;
      const rect = (px: number, py: number, pw: number, ph: number): void => {
        this.pushQuadRaw(
          this.whiteTextureId,
          px,
          py,
          pw,
          ph,
          0,
          0,
          1,
          1,
          { tint: stroke.color },
          1,
        );
      };
      rect(x - half, y - half, w + stroke.width, stroke.width);
      rect(x - half, y + h - half, w + stroke.width, stroke.width);
      rect(x - half, y + half, stroke.width, h - stroke.width);
      rect(x + w - half, y + half, stroke.width, h - stroke.width);
    }
  }

  setCamera(viewport: Viewport, zoom?: number): void {
    this.camera = { ...viewport };
    this.zoom = zoom ?? 1;
  }

  pushTransform(t: Transform): void {
    this.transformStack.push({ ...t });
  }

  popTransform(): void {
    const popped = this.transformStack.pop();
    if (popped === undefined) {
      this.logger.debug("popTransform: transform stack underflow", {});
    }
  }

  registerTileset(tileset: TilesetData): void {
    this.tilesets.register(tileset);
  }

  drawTileLayer(layer: TileLayer, tilesetId: string, tileSize: number): void {
    if (this.lost) {
      return;
    }
    if (!layer.visible) {
      return;
    }
    const binding = this.tilesets.bindingFor(tilesetId);
    if (binding === undefined) {
      this.logger.warn("drawTileLayer: unknown tileset", { tilesetId });
      return;
    }
    const rows = layer.data.length;
    const firstRow = layer.data[0];
    const cols = firstRow === undefined ? 0 : firstRow.length;
    const range = computeVisibleTileRange({
      viewport: this.camera,
      tileSize,
      mapWidthTiles: cols,
      mapHeightTiles: rows,
    });
    if (isTileRangeEmpty(range)) {
      return;
    }
    const source = this.textureManager.getSource(binding.textureId);
    if (source === undefined) {
      this.logger.debug("drawTileLayer: tileset texture not ready", { tilesetId });
      return;
    }
    const alpha = layer.opacity ?? 1;
    for (let row = range.rowStart; row < range.rowEnd; row++) {
      const dataRow = layer.data[row];
      if (dataRow === undefined) {
        continue;
      }
      for (let col = range.colStart; col < range.colEnd; col++) {
        const index = dataRow[col];
        if (index === undefined || index <= 0) {
          continue; // 0 = empty/transparent (map schema)
        }
        const frameRect = this.textureManager.getFrame(binding.textureId, index);
        if (frameRect === undefined) {
          continue;
        }
        this.pushQuad(
          binding.textureId,
          col * tileSize,
          row * tileSize,
          tileSize,
          tileSize,
          frameRect,
          source,
          undefined,
          alpha,
        );
      }
    }
  }

  /** Re-create GPU resources after a context restore. */
  private initGL(): void {
    const gl = this.gl;
    this.program?.dispose();
    const program = new ShaderProgram({ gl, logger: this.logger });
    this.program = program;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.useProgram(program.program);
    gl.enableVertexAttribArray(program.locations.aPosition);
    gl.enableVertexAttribArray(program.locations.aUv);
    gl.enableVertexAttribArray(program.locations.aColor);
    gl.vertexAttribPointer(program.locations.aPosition, 2, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 0);
    gl.vertexAttribPointer(program.locations.aUv, 2, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 8);
    gl.vertexAttribPointer(program.locations.aColor, 4, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 16);
    gl.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], this.clearColor[3]);
    // The context was (re)created: previously uploaded textures are invalid.
    this.glTextures.clear();
    this.glTextureRevisions.clear();
  }

  private flushBatch(batch: SpriteBatch): void {
    const vertexCount = batch.vertexCount;
    if (vertexCount === 0) {
      return;
    }
    const gl = this.gl;
    const program = this.program;
    if (program === null) {
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      batch.vertices.subarray(0, vertexCount * FLOATS_PER_VERTEX),
      gl.DYNAMIC_DRAW,
    );
    gl.useProgram(program.program);
    const textureId = batch.textureId;
    if (textureId !== null) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ensureTexture(textureId));
      gl.uniform1i(program.locations.uTexture, 0);
    }
    gl.uniformMatrix3fv(program.locations.uProjection, false, this.computeProjection());
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  private ensureTexture(
    textureId: TextureId,
    explicitSource?: ImageSourceLike,
    explicitRevision = 0,
    force = false,
  ): WebGLTexture {
    let tex = this.glTextures.get(textureId);
    const currentRevision =
      explicitSource !== undefined ? explicitRevision : this.textureManager.getRevision(textureId);
    const needsUpload =
      force ||
      tex === undefined ||
      (this.glTextureRevisions.get(textureId) ?? -1) !== currentRevision;
    if (needsUpload) {
      if (tex === undefined) {
        tex = this.gl.createTexture();
        if (tex === null) {
          throw new Error("failed to create GL texture");
        }
        this.glTextures.set(textureId, tex);
      }
      const gl = this.gl;
      const source = explicitSource ?? this.textureManager.getSource(textureId);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (source !== undefined && source.raw !== undefined) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source.raw as TexImageSource,
        );
      } else {
        // 1x1 white placeholder so sampling never errors before an upload.
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([255, 255, 255, 255]),
        );
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.glTextureRevisions.set(textureId, currentRevision);
    }
    if (tex === undefined) {
      // Unreachable: needsUpload is true whenever tex is undefined, and the
      // block above always assigns it. Kept for type-narrowing.
      throw new Error("texture creation failed");
    }
    return tex;
  }

  private pushQuad(
    textureId: TextureId,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    frameRect: { x: number; y: number; width: number; height: number },
    source: ImageSourceLike,
    opts: DrawOptions | undefined,
    alpha = 1,
  ): void {
    const srcW = Math.max(1, source.width);
    const srcH = Math.max(1, source.height);
    const u0 = frameRect.x / srcW;
    const v0 = frameRect.y / srcH;
    const u1 = (frameRect.x + frameRect.width) / srcW;
    const v1 = (frameRect.y + frameRect.height) / srcH;
    this.pushQuadRaw(textureId, dx, dy, dw, dh, u0, v0, u1, v1, opts, alpha);
  }

  private pushQuadRaw(
    textureId: TextureId,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    opts: DrawOptions | undefined,
    alpha: number,
  ): void {
    const entry = this.entries.acquire();
    entry.textureId = textureId;
    entry.x = dx;
    entry.y = dy;
    entry.w = dw;
    entry.h = dh;
    entry.u0 = u0;
    entry.v0 = v0;
    entry.u1 = u1;
    entry.v1 = v1;
    const color = parseColor(opts?.tint, (opts?.opacity ?? 1) * alpha);
    entry.r = color.r;
    entry.g = color.g;
    entry.b = color.b;
    entry.a = color.a;
    entry.flipX = opts?.flipX === true;
    entry.flipY = opts?.flipY === true;
    this.applyTransforms(entry);
    this.batch.push(entry);
    this.entries.release(entry);
  }

  private applyTransforms(entry: SpriteDrawEntry): void {
    const m = this.currentTransformMatrix();
    if (m === null) {
      return;
    }
    const corners = new Float32Array(8);
    const x = entry.x;
    const y = entry.y;
    const w = entry.w;
    const h = entry.h;
    setCorner(corners, 0, mat3TransformPoint(m, x, y));
    setCorner(corners, 1, mat3TransformPoint(m, x + w, y));
    setCorner(corners, 2, mat3TransformPoint(m, x + w, y + h));
    setCorner(corners, 3, mat3TransformPoint(m, x, y + h));
    entry.corners = corners;
  }

  private currentTransformMatrix(): Mat3 | null {
    if (this.transformStack.length === 0) {
      return null;
    }
    let m = mat3Identity();
    for (const t of this.transformStack) {
      const local = mat3Multiply(
        mat3Translation(t.translateX, t.translateY),
        mat3Multiply(mat3Rotation(t.rotation), mat3Scale(t.scaleX, t.scaleY)),
      );
      m = mat3Multiply(m, local);
    }
    return m;
  }

  private computeProjection(): Mat3 {
    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;
    const ortho = mat3Ortho(0, w, h, 0);
    const trans = mat3Translation(-this.camera.x, -this.camera.y);
    const scale = mat3Scale(this.zoom, this.zoom);
    return mat3Multiply(mat3Multiply(ortho, trans), scale);
  }

  private textCanvas(): HTMLCanvasElement | null {
    if (this.textCanvasValue === null) {
      if (typeof document === "undefined") {
        return null;
      }
      try {
        this.textCanvasValue = document.createElement("canvas");
        this.textContextValue = this.textCanvasValue.getContext("2d");
      } catch {
        return null;
      }
    }
    return this.textCanvasValue;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.logger.warn("webgl context lost", { backend: this.backend });
  };

  private readonly onContextRestored = (): void => {
    this.lost = false;
    try {
      this.initGL();
      this.logger.info("webgl context restored; resources re-created", { backend: this.backend });
    } catch (error: unknown) {
      this.logger.error("webgl context restore failed; preparing hot-swap", {
        error: String(error),
      });
      this.handleUnrecoverableLoss("context-restore-failed");
    }
  };

  /**
   * Unrecoverable loss: dispose GL resources and ask the factory (via
   * `onUnrecoverableLoss`) to hot-swap to the Canvas2D backend (ADR-002).
   */
  handleUnrecoverableLoss(reason: string): void {
    if (this.disposed) {
      return;
    }
    this.lost = true;
    this.logger.error("webgl renderer unrecoverable; hot-swap requested", { reason });
    this.dispose();
    this.onUnrecoverableLoss?.(reason);
  }

  private armWatchdog(ms: number): void {
    this.watchdog = setTimeout(() => {
      if (this.lost && !this.disposed) {
        this.handleUnrecoverableLoss("context-not-restored");
      }
    }, ms);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    this.canvas.removeEventListener?.("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener?.("webglcontextrestored", this.onContextRestored);
    this.batch.begin();
    this.transformStack.length = 0;
    this.glTextures.clear();
    this.glTextureRevisions.clear();
  }
}

function setCorner(out: Float32Array, index: number, point: [number, number]): void {
  out[index * 2] = point[0];
  out[index * 2 + 1] = point[1];
}

function parseFontSizePx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  if (match !== null && match[1] !== undefined) {
    return Math.max(1, Math.ceil(Number(match[1])));
  }
  return 16;
}
