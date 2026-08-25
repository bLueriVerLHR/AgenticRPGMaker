/**
 * Sprite batch (P1b, ADR-002).
 *
 * Sprites/tiles are staged into one dynamic interleaved vertex buffer
 * (position / UV / color) and emitted with as few draw calls as possible. The
 * batch flushes automatically when the texture changes, when the buffer fills,
 * or on an explicit `flush()` (`endFrame`). It is backend-agnostic: the actual
 * upload+draw is delegated to an `onFlush` callback, so the flush logic can be
 * unit-tested with a fake sink and shared between WebGL (batching) and Canvas2D
 * (immediate mode — the batch is simply a no-op buffer there).
 */
import type { TextureId } from "./index.js";
import type { SpriteDrawEntry } from "./pool.js";

const FLOATS_PER_VERTEX = 8; // x, y, u, v, r, g, b, a
const VERTICES_PER_QUAD = 6; // two triangles, no index buffer
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * VERTICES_PER_QUAD;

export interface SpriteBatchOptions {
  /** Max quads per buffer before an automatic flush. */
  maxQuads?: number;
  /**
   * Called with the batch whenever its staged quads must be drawn (texture
   * change, capacity reached, or explicit `flush`). The callback reads
   * `vertices`/`vertexCount`/`textureId` and uploads them.
   */
  onFlush?: (batch: SpriteBatch) => void;
}

export class SpriteBatch {
  private readonly maxQuads: number;
  private readonly onFlush?: (batch: SpriteBatch) => void;
  private readonly verticesValue: Float32Array;
  private quadCountValue = 0;
  private textureIdValue: TextureId | null = null;

  constructor(options: SpriteBatchOptions = {}) {
    this.maxQuads = options.maxQuads ?? 2048;
    this.onFlush = options.onFlush;
    this.verticesValue = new Float32Array(this.maxQuads * FLOATS_PER_QUAD);
  }

  /** Reset for a new frame. */
  begin(): void {
    this.quadCountValue = 0;
    this.textureIdValue = null;
  }

  get quadCount(): number {
    return this.quadCountValue;
  }

  get vertexCount(): number {
    return this.quadCountValue * VERTICES_PER_QUAD;
  }

  get textureId(): TextureId | null {
    return this.textureIdValue;
  }

  /** Interleaved staging buffer (position/uv/color). */
  get vertices(): Float32Array {
    return this.verticesValue;
  }

  get isFull(): boolean {
    return this.quadCountValue >= this.maxQuads;
  }

  /**
   * Stage one quad. Flushes first if the batch holds a different texture or is
   * full, then appends. The staged quad shares the batch's texture.
   */
  push(entry: SpriteDrawEntry): void {
    if (this.textureIdValue !== null && this.textureIdValue !== entry.textureId) {
      this.flush();
    }
    if (this.isFull) {
      this.flush();
    }
    this.writeQuad(entry);
    this.textureIdValue = entry.textureId;
    this.quadCountValue += 1;
  }

  /** Emit staged quads via `onFlush` and reset. */
  flush(): void {
    if (this.quadCountValue > 0) {
      this.onFlush?.(this);
    }
    this.quadCountValue = 0;
    this.textureIdValue = null;
  }

  private writeQuad(entry: SpriteDrawEntry): void {
    const u0 = entry.flipX ? entry.u1 : entry.u0;
    const u1 = entry.flipX ? entry.u0 : entry.u1;
    const v0 = entry.flipY ? entry.v1 : entry.v0;
    const v1 = entry.flipY ? entry.v0 : entry.v1;

    const base = this.quadCountValue * FLOATS_PER_QUAD;
    const v = this.verticesValue;

    // Two triangles (0,1,2) and (0,2,3) over corners c0..c3.
    const writeCorner = (offset: number, corner: number): void => {
      let px: number;
      let py: number;
      if (entry.corners !== null) {
        // corners is always 8 floats for the 4 corners; `?? 0` is defensive.
        px = entry.corners[corner * 2] ?? 0;
        py = entry.corners[corner * 2 + 1] ?? 0;
      } else {
        switch (corner) {
          case 1:
            px = entry.x + entry.w;
            py = entry.y;
            break;
          case 2:
            px = entry.x + entry.w;
            py = entry.y + entry.h;
            break;
          case 3:
            px = entry.x;
            py = entry.y + entry.h;
            break;
          default:
            px = entry.x;
            py = entry.y;
        }
      }
      let u: number;
      let vv: number;
      if (corner === 1 || corner === 2) {
        u = u1;
      } else {
        u = u0;
      }
      if (corner === 2 || corner === 3) {
        vv = v1;
      } else {
        vv = v0;
      }
      v[offset] = px;
      v[offset + 1] = py;
      v[offset + 2] = u;
      v[offset + 3] = vv;
      v[offset + 4] = entry.r;
      v[offset + 5] = entry.g;
      v[offset + 6] = entry.b;
      v[offset + 7] = entry.a;
    };

    writeCorner(base, 0);
    writeCorner(base + FLOATS_PER_VERTEX, 1);
    writeCorner(base + FLOATS_PER_VERTEX * 2, 2);
    writeCorner(base + FLOATS_PER_VERTEX * 3, 0);
    writeCorner(base + FLOATS_PER_VERTEX * 4, 2);
    writeCorner(base + FLOATS_PER_VERTEX * 5, 3);
  }
}
