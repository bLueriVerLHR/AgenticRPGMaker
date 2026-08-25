/**
 * @agenticrpg/renderer — Renderer interface (ADR-002).
 *
 * This package defines the ONLY surface upper layers (runtime game loop, editor
 * preview) may call to draw. The concrete backends — WebGLRenderer (default)
 * and Canvas2DRenderer (fallback) — implement this interface in P1b. Keeping
 * the interface compiled here, dependency-free apart from @agenticrpg/core,
 * pins the contract before any backend work starts.
 */
import type { PlayerState } from "@agenticrpg/core";

/** Opaque texture handle handed back by the TextureManager. */
export type TextureId = string;

/** Integer tile index into a tileset (map `data` cell value). */
export type TileIndex = number;

/** A tile reference: which tileset and which index within it. */
export interface TileRef {
  tilesetId: string;
  index: TileIndex;
}

/** A rectangular source region on a texture/atlas, in pixels. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A camera viewport into world space, in tile or world units. */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine transform pushed/popped while drawing (scene-graph transforms). */
export interface Transform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  /** Rotation in radians (0 = none). */
  rotation: number;
}

/** Common draw modifiers for tile/sprite/text primitives. */
export interface DrawOptions {
  opacity?: number;
  tint?: string;
  flipX?: boolean;
  flipY?: boolean;
}

/** Text-specific draw options. */
export interface TextDrawOptions extends DrawOptions {
  font?: string;
  color?: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
  maxWidth?: number;
}

/** Rect stroke styling. */
export interface RectStroke {
  color: string;
  width: number;
}

/**
 * The Renderer interface (ADR-002). Implementations:
 * - WebGLRenderer — default; 2D sprite batching, tilemap quad meshes, minimal
 *   shaders (P1b).
 * - Canvas2DRenderer — automatic fallback (weak devices, JoiPlay WebViews);
 *   immediate mode (P1b).
 * A null/fake renderer may be used for pure-logic tests.
 */
export interface Renderer {
  /** Begin a new frame: clear/present state, prepare the batch. */
  beginFrame(): void;
  /** End the frame: flush any batched draws and present. */
  endFrame(): void;
  /** Draw one tile of a tileset at tile-space position (x, y). */
  drawTile(tile: TileRef, x: number, y: number, opts?: DrawOptions): void;
  /** Draw one frame (index) of a texture at position (x, y). */
  drawSprite(textureId: TextureId, frame: number, x: number, y: number, opts?: DrawOptions): void;
  /** Draw text at position (x, y). */
  drawText(text: string, x: number, y: number, opts?: TextDrawOptions): void;
  /** Draw an axis-aligned rect with optional fill and stroke. */
  drawRect(x: number, y: number, w: number, h: number, fill?: string, stroke?: RectStroke): void;
  /** Set the camera viewport and zoom. */
  setCamera(viewport: Viewport, zoom?: number): void;
  /** Push a world transform onto the transform stack. */
  pushTransform(t: Transform): void;
  /** Pop the last pushed transform. */
  popTransform(): void;
}

/**
 * TextureManager — a sibling interface (ADR-002), injected into backends: loads
 * images, builds atlases, caches textures, and hands back opaque texture ids.
 * Backends translate ids to their own GPU/Canvas resources.
 */
export interface TextureManager {
  /** Load an image and return an opaque texture id. */
  load(url: string): Promise<TextureId>;
  /** Release the texture (and its GPU/Canvas resource) if still cached. */
  dispose(textureId: TextureId): void;
  /** Source rect of frame `frameIndex` within `textureId`'s atlas. */
  getFrame(textureId: TextureId, frameIndex: number): FrameRect | undefined;
  /** Number of frames available in `textureId`'s atlas. */
  frameCount(textureId: TextureId): number;
}

/** Backends supported by the interface (capability detection order, ADR-002). */
export type RendererBackend = "webgl2" | "webgl1" | "canvas2d";

/** Result of capability detection; the chosen backend is logged at info. */
export interface RendererCapability {
  backend: RendererBackend;
  supported: boolean;
  reason?: string;
}

/** Factory used at startup to instantiate the detected backend (Strategy). */
export interface RendererFactory {
  create(options: RendererFactoryOptions): Renderer;
}

export interface RendererFactoryOptions {
  canvas: HTMLCanvasElement;
  /** Injected texture manager; the factory may supply a default. */
  textureManager?: TextureManager;
}

/** No-op assertion that the interface types are usable (compile-time only). */
export function isRenderer(value: unknown): value is Renderer {
  return (
    typeof value === "object" &&
    value !== null &&
    "beginFrame" in value &&
    "endFrame" in value &&
    "drawTile" in value
  );
}

/** Re-export the shared player state type for renderer consumers. */
export type { PlayerState };
