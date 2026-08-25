/**
 * TextureManager — sibling interface implementation (P1b, ADR-002).
 *
 * Loads images, packs them into a shared atlas (one canvas keeps most sprites
 * and tiles on a single texture, minimizing state switches), caches textures,
 * and hands back opaque texture ids. Backends translate ids to their own
 * GPU/Canvas resources and never see images directly.
 *
 * The P0 `TextureManager` interface is kept as-is; the atlas-aware surface
 * (`setGrid`, `getSource`, `getRevision`) is an additive extension both
 * backends consume.
 */
import type { FrameRect, TextureId, TextureManager } from "./index.js";
import type { RendererLogger } from "./logger.js";
import { noopRendererLogger } from "./logger.js";

/** Structural image source consumed by backends (a real canvas in the browser). */
export interface ImageSourceLike {
  width: number;
  height: number;
  /** Raw drawable (HTMLImageElement/HTMLCanvasElement/ImageBitmap); tests use undefined. */
  raw?: unknown;
}

/** Where one image lives on the shared atlas plus its frame grid. */
export interface AtlasPlacement {
  textureId: TextureId;
  /** Source rect of the image on the atlas canvas, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** The atlas canvas/bitmap the backend uploads or draws from. */
  source: ImageSourceLike;
}

/** How images are loaded (browser: `new Image()`; tests: a stub). */
export type ImageLoader = (url: string) => Promise<ImageSourceLike>;

/** Produces the composite atlas source from the loaded images (browser: a canvas). */
export type AtlasBuilder = (images: ReadonlyArray<ImageSourceLike>) => ImageSourceLike;

export interface TextureManagerOptions {
  loader?: ImageLoader;
  atlasBuilder?: AtlasBuilder;
  logger?: RendererLogger;
}

/** Additive atlas surface consumed by both backends (see module doc). */
export interface AtlasTextureManager extends TextureManager {
  /** Declare a frame grid for a texture (sprite sheets / tilesets). */
  setGrid(textureId: TextureId, columns: number, rows: number): void;
  /** The atlas source a backend can upload/draw. */
  getSource(textureId: TextureId): ImageSourceLike | undefined;
  /** Monotonic revision: bumped whenever the atlas is rebuilt. */
  getRevision(textureId: TextureId): number;
  /** Atlas placements of every loaded texture (debug/tests). */
  placements(): ReadonlyMap<TextureId, AtlasPlacement>;
}

/** True when a texture manager already exposes the atlas surface. */
export function isAtlasTextureManager(manager: TextureManager): manager is AtlasTextureManager {
  return (
    "setGrid" in manager &&
    "getSource" in manager &&
    "getRevision" in manager &&
    "placements" in manager
  );
}

/**
 * Wrap any base `TextureManager` into the atlas surface with graceful no-ops,
 * so backends can always consume the additive interface even when an upper
 * layer injected a plain P0 manager.
 */
export function asAtlasTextureManager(
  manager: TextureManager,
  logger: RendererLogger = noopRendererLogger,
): AtlasTextureManager {
  if (isAtlasTextureManager(manager)) {
    return manager;
  }
  let warned = false;
  const warnOnce = (): void => {
    if (!warned) {
      warned = true;
      logger.debug(
        "texture manager does not expose atlas API (setGrid/getSource/getRevision); tile/sprite frames may not resolve",
        {},
      );
    }
  };
  return {
    load: (url) => manager.load(url),
    dispose: (textureId) => manager.dispose(textureId),
    getFrame: (textureId, frameIndex) => manager.getFrame(textureId, frameIndex),
    frameCount: (textureId) => manager.frameCount(textureId),
    setGrid: () => warnOnce(),
    getSource: () => {
      warnOnce();
      return undefined;
    },
    getRevision: () => 0,
    placements: () => new Map(),
  };
}

interface LoadedImage {
  textureId: TextureId;
  url: string;
  image: ImageSourceLike;
  columns: number;
  rows: number;
}

const DEFAULT_COLUMNS = 1;
const DEFAULT_ROWS = 1;

function browserDefaultLoader(): ImageLoader {
  return (url) =>
    new Promise<ImageSourceLike>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight, raw: img });
      };
      img.onerror = () => {
        reject(new Error(`failed to load image: ${url}`));
      };
      img.src = url;
    });
}

/**
 * Default atlas builder: pack all images side by side into one canvas. Falls
 * back to a 1x1 source when there are no images or no 2D context (headless).
 */
function browserDefaultAtlasBuilder(images: ReadonlyArray<ImageSourceLike>): ImageSourceLike {
  const width = images.reduce((acc, img) => acc + Math.max(1, Math.ceil(img.width)), 0) || 1;
  const height = images.reduce((acc, img) => Math.max(acc, Math.ceil(img.height)), 0) || 1;
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return { width, height };
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    let x = 0;
    for (const img of images) {
      const raw = img.raw as CanvasImageSource | undefined;
      if (raw !== undefined) {
        ctx.drawImage(raw, x, 0);
      }
      x += Math.max(1, Math.ceil(img.width));
    }
  }
  return { width, height, raw: canvas };
}

export class TextureManagerImpl implements AtlasTextureManager {
  private readonly loader: ImageLoader;
  private readonly atlasBuilder: AtlasBuilder;
  private readonly logger: RendererLogger;
  private readonly byUrl = new Map<string, TextureId>();
  private readonly images = new Map<TextureId, LoadedImage>();
  private readonly cachedPlacements = new Map<TextureId, AtlasPlacement>();
  private readonly loading = new Map<string, Promise<TextureId>>();
  private atlasValue: ImageSourceLike = { width: 1, height: 1 };
  private revisionValue = 0;
  private nextId = 1;

  constructor(options: TextureManagerOptions = {}) {
    this.loader = options.loader ?? browserDefaultLoader();
    this.atlasBuilder = options.atlasBuilder ?? browserDefaultAtlasBuilder;
    this.logger = options.logger ?? noopRendererLogger;
  }

  load(url: string): Promise<TextureId> {
    const cached = this.byUrl.get(url);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const inFlight = this.loading.get(url);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = this.loader(url)
      .then((image) => {
        const textureId = `tex:${this.nextId++}`;
        this.byUrl.set(url, textureId);
        this.images.set(textureId, {
          textureId,
          url,
          image,
          columns: DEFAULT_COLUMNS,
          rows: DEFAULT_ROWS,
        });
        this.loading.delete(url);
        this.rebuildAtlas();
        this.logger.info("texture loaded", {
          url,
          textureId,
          width: image.width,
          height: image.height,
        });
        return textureId;
      })
      .catch((error: unknown) => {
        this.loading.delete(url);
        this.logger.error("texture load failed", { url, error: String(error) });
        throw error;
      });
    this.loading.set(url, promise);
    return promise;
  }

  dispose(textureId: TextureId): void {
    const entry = this.images.get(textureId);
    if (entry === undefined) {
      return;
    }
    this.images.delete(textureId);
    this.byUrl.delete(entry.url);
    this.rebuildAtlas();
  }

  getFrame(textureId: TextureId, frameIndex: number): FrameRect | undefined {
    const placement = this.cachedPlacements.get(textureId);
    if (placement === undefined) {
      return undefined;
    }
    const total = placement.columns * placement.rows;
    if (frameIndex < 0 || frameIndex >= total) {
      return undefined;
    }
    const col = frameIndex % placement.columns;
    const row = Math.floor(frameIndex / placement.columns);
    const tileWidth = placement.width / placement.columns;
    const tileHeight = placement.height / placement.rows;
    return {
      x: placement.x + col * tileWidth,
      y: placement.y + row * tileHeight,
      width: tileWidth,
      height: tileHeight,
    };
  }

  frameCount(textureId: TextureId): number {
    const placement = this.cachedPlacements.get(textureId);
    if (placement === undefined) {
      return 0;
    }
    return placement.columns * placement.rows;
  }

  setGrid(textureId: TextureId, columns: number, rows: number): void {
    const entry = this.images.get(textureId);
    if (entry === undefined) {
      this.logger.debug("setGrid: unknown texture", { textureId });
      return;
    }
    entry.columns = Math.max(1, Math.floor(columns));
    entry.rows = Math.max(1, Math.floor(rows));
    this.rebuildAtlas();
  }

  getSource(textureId: TextureId): ImageSourceLike | undefined {
    const placement = this.cachedPlacements.get(textureId);
    return placement === undefined ? undefined : placement.source;
  }

  getRevision(textureId: TextureId): number {
    const placement = this.cachedPlacements.get(textureId);
    return placement === undefined ? 0 : this.revisionValue;
  }

  placements(): ReadonlyMap<TextureId, AtlasPlacement> {
    return new Map(this.cachedPlacements);
  }

  private rebuildAtlas(): void {
    const entries = [...this.images.values()];
    this.atlasValue = this.atlasBuilder(entries.map((e) => e.image));
    this.revisionValue += 1;
    this.cachedPlacements.clear();
    let x = 0;
    for (const entry of entries) {
      const img = entry.image;
      const width = Math.max(1, Math.ceil(img.width));
      const height = Math.max(1, Math.ceil(img.height));
      this.cachedPlacements.set(entry.textureId, {
        textureId: entry.textureId,
        x,
        y: 0,
        width,
        height,
        columns: entry.columns,
        rows: entry.rows,
        source: this.atlasValue,
      });
      x += width;
    }
  }
}
