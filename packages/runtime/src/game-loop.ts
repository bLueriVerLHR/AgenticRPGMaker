/**
 * Fixed-step game loop (P1c, docs/06-architecture.md §3 boot flow step 5).
 *
 * A fixed-timestep accumulator loop: the simulation is advanced in discrete
 * `fixedDt` steps (default 1/60 s) while `render(alpha)` receives the
 * interpolation factor `alpha = accumulator / fixedDt` so scenes can render
 * smoothly between steps (used by MapScene for sub-tile movement).
 *
 * The rAF clock is injectable so tests can drive frames deterministically and
 * the runtime can run headless (no `requestAnimationFrame` → `start()` logs a
 * warning and stays stopped rather than crashing).
 */
export interface GameLoopOptions {
  /** Fixed simulation step in seconds. Default 1/60. */
  fixedDt?: number;
  /** Clamp for a single frame dt (avoids the spiral of death). Default 0.25 s. */
  maxFrameDt?: number;
  /** Frame scheduler; defaults to `window.requestAnimationFrame`. */
  raf?: (callback: (timeMs: number) => void) => number;
  /** Frame-scheduler canceller; defaults to `window.cancelAnimationFrame`. */
  cancelRaf?: (handle: number) => void;
  /** Monotonic ms clock; defaults to `performance.now`. */
  now?: () => number;
}

export type LoopUpdate = (dt: number) => void;
export type LoopRender = (alpha: number) => void;

/** True when the environment provides the browser frame clock. */
export function hasAnimationFrame(): boolean {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
}

const defaultRaf = (callback: (timeMs: number) => void): number => {
  if (!hasAnimationFrame()) {
    throw new Error("no requestAnimationFrame available; inject a raf in GameLoopOptions");
  }
  return window.requestAnimationFrame(callback);
};

const defaultCancelRaf = (handle: number): void => {
  if (hasAnimationFrame()) {
    window.cancelAnimationFrame(handle);
  }
};

const defaultNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Fixed-step accumulator loop. `start(update, render)` runs until `stop()`.
 * Also exposes `tick(now)` for headless/manual frame driving (tests, previews).
 */
export class GameLoop {
  private readonly fixedDt: number;
  private readonly maxFrameDt: number;
  private readonly raf: (callback: (timeMs: number) => void) => number;
  private readonly cancelRaf: (handle: number) => void;
  private readonly now: () => number;

  private rafHandle: number | null = null;
  private lastTimeMs: number | null = null;
  private accumulator = 0;
  private runningValue = false;

  private updateFn: LoopUpdate = () => {};
  private renderFn: LoopRender = () => {};

  constructor(options: GameLoopOptions = {}) {
    this.fixedDt = options.fixedDt ?? 1 / 60;
    this.maxFrameDt = options.maxFrameDt ?? 0.25;
    this.raf = options.raf ?? defaultRaf;
    this.cancelRaf = options.cancelRaf ?? defaultCancelRaf;
    this.now = options.now ?? defaultNow;
  }

  /** Whether the loop is currently running. */
  get running(): boolean {
    return this.runningValue;
  }

  /** The fixed simulation step, in seconds. */
  get step(): number {
    return this.fixedDt;
  }

  /** Start the loop with the given update/render callbacks. */
  start(update: LoopUpdate, render: LoopRender): void {
    if (this.runningValue) {
      return;
    }
    this.updateFn = update;
    this.renderFn = render;
    this.runningValue = true;
    this.lastTimeMs = null;
    this.accumulator = 0;
    this.rafHandle = this.raf((t) => {
      this.frame(t);
    });
  }

  /** Stop the loop (idempotent). */
  stop(): void {
    if (!this.runningValue) {
      return;
    }
    this.runningValue = false;
    if (this.rafHandle !== null) {
      this.cancelRaf(this.rafHandle);
      this.rafHandle = null;
    }
    this.lastTimeMs = null;
  }

  /**
   * Advance one frame at wall-clock `nowMs`. Runs as many fixed steps as are
   * due, then renders once with the interpolation alpha. Idempotent when
   * called with a repeated/earlier timestamp.
   */
  tick(nowMs: number): void {
    if (!this.runningValue) {
      return;
    }
    if (this.lastTimeMs === null) {
      this.lastTimeMs = nowMs;
      return;
    }
    let dt = (nowMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = nowMs;
    if (dt < 0) {
      dt = 0;
    }
    if (dt > this.maxFrameDt) {
      dt = this.maxFrameDt;
    }
    this.accumulator += dt;
    while (this.accumulator >= this.fixedDt) {
      this.updateFn(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
    const alpha = this.fixedDt > 0 ? this.accumulator / this.fixedDt : 0;
    this.renderFn(alpha);
  }

  private frame(timeMs: number): void {
    this.tick(timeMs);
    if (this.runningValue) {
      this.rafHandle = this.raf((t) => {
        this.frame(t);
      });
    }
  }
}
