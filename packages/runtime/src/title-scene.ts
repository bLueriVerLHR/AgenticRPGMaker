/**
 * TitleScene — "press any key" title (ADR-010 §3, S3b).
 *
 * The browser autoplay gate is crossed here: the first keydown unlocks the
 * AudioManager (user gesture), detaches the listener, and calls `onStart`
 * exactly once. Rendering is renderer-only (dark backdrop + title text);
 * a `data-testid="title-screen"` DOM marker is created for E2E when a
 * `uiRoot` is provided.
 */
import type { Renderer } from "@agenticrpg/renderer";

import type { AudioManager } from "./audio.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import type { Scene } from "./scene.js";

export interface TitleSceneOptions {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  audio: AudioManager | null;
  /** Called exactly once, after the audio unlock. */
  onStart: () => void;
  uiRoot?: HTMLElement | null;
  /** Keydown listener target; defaults to `window` (guarded). */
  target?: EventTarget | null;
  title?: string;
  subtitle?: string;
  logger?: Logger;
}

export class TitleScene implements Scene {
  readonly id = "title";

  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly audio: AudioManager | null;
  private readonly onStart: () => void;
  private readonly uiRoot: HTMLElement | null;
  private readonly target: EventTarget | null;
  private readonly title: string;
  private readonly subtitle: string;
  private readonly logger: Logger;

  private listener: ((event: Event) => void) | null = null;
  private marker: HTMLElement | null = null;
  private entered = false;
  private started = false;

  constructor(options: TitleSceneOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.audio = options.audio;
    this.onStart = options.onStart;
    this.uiRoot = options.uiRoot ?? null;
    this.target = options.target ?? (typeof window !== "undefined" ? window : null);
    this.title = options.title ?? "The Crossroads";
    this.subtitle = options.subtitle ?? "PRESS ANY KEY";
    this.logger = options.logger ?? createNoopLogger();
  }

  /** True once the title has been dismissed. */
  get isStarted(): boolean {
    return this.started;
  }

  enter(): void {
    if (this.entered) {
      return;
    }
    this.entered = true;
    this.renderer.setCamera(
      { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height },
      1,
    );
    if (this.target !== null) {
      this.listener = () => this.press();
      this.target.addEventListener("keydown", this.listener);
    }
    if (this.uiRoot !== null && typeof document !== "undefined") {
      const marker = document.createElement("div");
      marker.dataset.testid = "title-screen";
      marker.style.cssText = "position:fixed;inset:0;z-index:80;";
      this.uiRoot.appendChild(marker);
      this.marker = marker;
    }
    this.logger.info("scene: title entered", {});
  }

  /** Dismiss the title: unlock audio, detach, start. Idempotent. */
  press(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.audio?.unlock();
    if (this.listener !== null && this.target !== null) {
      this.target.removeEventListener("keydown", this.listener);
      this.listener = null;
    }
    this.marker?.remove();
    this.marker = null;
    this.logger.info("scene: title started", {});
    this.onStart();
  }

  update(): void {
    // Input is the any-key listener; no per-frame simulation.
  }

  render(): void {
    const renderer = this.renderer;
    const w = this.canvas.width;
    const h = this.canvas.height;
    renderer.beginFrame();
    renderer.drawRect(0, 0, w, h, "#0b0e14");
    renderer.drawText(this.title, w / 2, Math.floor(h * 0.42), {
      font: "24px monospace",
      color: "#e8e6df",
      align: "center",
    });
    renderer.drawText(this.subtitle, w / 2, Math.floor(h * 0.5), {
      font: "14px monospace",
      color: "#8d99ae",
      align: "center",
    });
    renderer.endFrame();
  }

  exit(): void {
    if (!this.entered) {
      return;
    }
    this.entered = false;
    if (this.listener !== null && this.target !== null) {
      this.target.removeEventListener("keydown", this.listener);
      this.listener = null;
    }
    this.marker?.remove();
    this.marker = null;
    this.logger.debug("scene: title exited", {});
  }
}
