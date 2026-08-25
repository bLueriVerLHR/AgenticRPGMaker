/**
 * Canvas2DRenderer — fallback backend (P1b, ADR-002).
 *
 * Implements the same `Renderer` + `TileMapRenderer` surfaces with the 2D
 * context in immediate mode (no batching):
 * - `drawTile`/`drawSprite` → `drawImage` with a source rect from the
 *   TextureManager atlas;
 * - `drawText` → `fillText` with the same font configuration;
 * - `drawRect` → `fillRect`/`strokeRect`;
 * - camera/transform → `save`/`setTransform`/`translate`/`scale`/`restore`.
 *
 * Per-sprite tint is a documented degradation (ADR-002): opacity still applies,
 * tint color is ignored and logged once at debug. Canvas2D doubles as a
 * deterministic software path for backend-comparison tests.
 */
import type { TileLayer, TilesetData } from "@agenticrpg/core";
import type {
  DrawOptions,
  FrameRect,
  Renderer,
  RendererBackend,
  RectStroke,
  TextDrawOptions,
  TextureId,
  TileRef,
  Transform,
  Viewport,
} from "../index.js";
import type { CanvasLike } from "../capability.js";
import type { RendererLogger } from "../logger.js";
import { noopRendererLogger } from "../logger.js";
import type { AtlasTextureManager, ImageSourceLike } from "../texture-manager.js";
import { computeVisibleTileRange, isTileRangeEmpty } from "../tiles.js";
import { TilesetRegistry } from "../tileset-registry.js";
import type { TileMapRenderer } from "../tilemap.js";

export interface Canvas2DRendererOptions {
  canvas: CanvasLike;
  ctx: CanvasRenderingContext2D;
  textureManager: AtlasTextureManager;
  logger?: RendererLogger;
}

const DEFAULT_FONT = "16px sans-serif";

export class Canvas2DRenderer implements Renderer, TileMapRenderer {
  readonly textureManager: AtlasTextureManager;
  private readonly canvas: CanvasLike;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly logger: RendererLogger;
  private readonly tilesets: TilesetRegistry;
  private readonly transformStack: Transform[] = [];
  private camera: Viewport = { x: 0, y: 0, width: 0, height: 0 };
  private zoom = 1;
  private tintWarned = false;

  constructor(options: Canvas2DRendererOptions) {
    this.canvas = options.canvas;
    this.ctx = options.ctx;
    this.textureManager = options.textureManager;
    this.logger = options.logger ?? noopRendererLogger;
    this.tilesets = new TilesetRegistry(this.textureManager, this.logger);
    this.logger.info("canvas2d renderer created", {
      backend: "canvas2d",
      width: this.canvas.width,
      height: this.canvas.height,
    });
  }

  /** The selected backend, for the About/debug hook (ADR-002). */
  getBackend(): RendererBackend {
    return "canvas2d";
  }

  beginFrame(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.transformStack.length = 0;
  }

  endFrame(): void {
    // Immediate mode: nothing to flush.
  }

  drawSprite(
    textureId: TextureId,
    frame: number,
    x: number,
    y: number,
    opts?: DrawOptions,
  ): void {
    const frameRect = this.textureManager.getFrame(textureId, frame);
    const source = this.textureManager.getSource(textureId);
    if (frameRect === undefined || source === undefined) {
      this.logger.debug("drawSprite: frame/source not ready", { textureId, frame });
      return;
    }
    this.drawImage(source, frameRect, x, y, frameRect.width, frameRect.height, opts);
  }

  drawTile(tile: TileRef, x: number, y: number, opts?: DrawOptions): void {
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
    this.drawImage(
      source,
      frameRect,
      x * size,
      y * size,
      size,
      size,
      opts,
    );
  }

  drawText(text: string, x: number, y: number, opts?: TextDrawOptions): void {
    const ctx = this.ctx;
    this.withWorldTransform(() => {
      ctx.font = opts?.font ?? DEFAULT_FONT;
      ctx.fillStyle = opts?.color ?? "#ffffff";
      ctx.textAlign = opts?.align ?? "left";
      ctx.textBaseline = opts?.baseline ?? "top";
      ctx.globalAlpha = opts?.opacity ?? 1;
      ctx.fillText(text, x, y, opts?.maxWidth);
    });
  }

  drawRect(x: number, y: number, w: number, h: number, fill?: string, stroke?: RectStroke): void {
    const ctx = this.ctx;
    this.withWorldTransform(() => {
      if (fill !== undefined) {
        ctx.fillStyle = fill;
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y, w, h);
      }
      if (stroke !== undefined) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, w, h);
      }
    });
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
        this.drawImage(
          source,
          frameRect,
          col * tileSize,
          row * tileSize,
          tileSize,
          tileSize,
          undefined,
          alpha,
        );
      }
    }
  }

  private drawImage(
    source: ImageSourceLike,
    frame: FrameRect,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: DrawOptions,
    alpha = 1,
  ): void {
    const ctx = this.ctx;
    this.withWorldTransform(() => {
      ctx.globalAlpha = (opts?.opacity ?? 1) * alpha;
      const flipX = opts?.flipX === true;
      const flipY = opts?.flipY === true;
      if (!flipX && !flipY) {
        ctx.drawImage(
          source as CanvasImageSource,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          dx,
          dy,
          dw,
          dh,
        );
      } else {
        ctx.save();
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(
          source as CanvasImageSource,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          -dw / 2,
          -dh / 2,
          dw,
          dh,
        );
        ctx.restore();
      }
      this.warnTintDegradation(opts?.tint);
    });
  }

  private warnTintDegradation(tint: string | undefined): void {
    if (tint !== undefined && tint !== "" && !this.tintWarned) {
      this.tintWarned = true;
      this.logger.debug(
        "canvas2d: per-sprite tint not supported (ADR-002 documented degradation); opacity still applies",
        {},
      );
    }
  }

  private withWorldTransform(draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(
      this.zoom,
      0,
      0,
      this.zoom,
      -this.camera.x * this.zoom,
      -this.camera.y * this.zoom,
    );
    for (const t of this.transformStack) {
      ctx.translate(t.translateX, t.translateY);
      ctx.rotate(t.rotation);
      ctx.scale(t.scaleX, t.scaleY);
    }
    draw();
    ctx.restore();
  }
}