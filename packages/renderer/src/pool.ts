/**
 * Object pooling (architecture doc §7: "Object pooling").
 *
 * Sprite draw entries are allocated per draw call in the hot loop. Pooling them
 * avoids GC hitches and allocation churn on weak mobile runtimes (JoiPlay
 * WebViews). The pool is generic over anything `Poolable`; `SpriteDrawEntry`
 * is the per-quad descriptor the WebGL batch consumes.
 */
import type { TextureId } from "./index.js";

/** Anything the pool can recycle must be resettable. */
export interface Poolable {
  reset(): void;
}

export interface ObjectPoolOptions {
  /** Soft cap on how many free objects the pool keeps (beyond: dropped on release). */
  maxFree?: number;
}

export class ObjectPool<T extends Poolable> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly maxFree: number;
  private usedCountValue = 0;

  constructor(factory: () => T, options: ObjectPoolOptions = {}) {
    this.factory = factory;
    this.maxFree = options.maxFree ?? 1024;
  }

  /** Acquire an entry: reuse a free one or create a new instance. */
  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.usedCountValue += 1;
    return item;
  }

  /** Release an entry back to the pool (reset first). */
  release(item: T): void {
    item.reset();
    this.usedCountValue = Math.max(0, this.usedCountValue - 1);
    if (this.free.length < this.maxFree) {
      this.free.push(item);
    }
  }

  get freeCount(): number {
    return this.free.length;
  }

  get usedCount(): number {
    return this.usedCountValue;
  }

  clear(): void {
    this.free.length = 0;
    this.usedCountValue = 0;
  }
}

/**
 * One pooled quad draw: which texture, where, which UVs, and what tint/alpha.
 * `corners` holds a pre-transformed quad (8 floats: four (x,y) pairs) when a
 * scene transform is active; otherwise the axis-aligned `x/y/w/h` rect is used.
 */
export class SpriteDrawEntry implements Poolable {
  textureId: TextureId = "";
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  u0 = 0;
  v0 = 0;
  u1 = 1;
  v1 = 1;
  r = 1;
  g = 1;
  b = 1;
  a = 1;
  flipX = false;
  flipY = false;
  corners: Float32Array | null = null;

  reset(): void {
    this.textureId = "";
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.u0 = 0;
    this.v0 = 0;
    this.u1 = 1;
    this.v1 = 1;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    this.a = 1;
    this.flipX = false;
    this.flipY = false;
    this.corners = null;
  }
}
