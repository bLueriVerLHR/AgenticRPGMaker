/**
 * CgScene — full-screen CG presentation (ADR-010 §3, S3b).
 *
 * Plays a `CgScript` (from `cg.ts`) as a Scene in the SceneManager: the world
 * freezes naturally while the CG is the current scene (ADR-009 freeze gate).
 *
 * Presentation model:
 * - a CG still is registered on the renderer and revealed once loaded
 *   (cover-fit to the canvas, screen space);
 * - fades animate a single black overlay (`fadeOut`→1, `fadeIn`→0);
 * - letterbox toggles top/bottom cinematic bars;
 * - bgm/sfx/letterbox are instant steps; text steps wait for confirm;
 * - every confirm press is a skip (snaps the running fade, skips the still
 *   wait / the text line) — the whole CG is skippable line by line;
 * - `end` (or running out of steps) calls `onEnd` exactly once.
 *
 * Headless-safe: DOM dialogue is created only when `uiRoot` is provided and
 * `document` exists (tests observe `currentText` instead).
 */
import type { Renderer } from "@agenticrpg/renderer";

import type { AudioManager } from "./audio.js";
import type { CgScript } from "./cg.js";
import type { Input } from "./input.js";
import { createKeyboardOnlyInput } from "./input.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import type { Scene } from "./scene.js";

export interface CgSceneOptions {
  script: CgScript;
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  uiRoot?: HTMLElement | null;
  audio?: AudioManager | null;
  input?: Input | null;
  onEnd?: () => void;
  logger?: Logger;
}

/** Renderer-side id the CG still is registered under (ADR-010 §4). */
export const CG_TEXTURE_ID = "__cg_still__";

export class CgScene implements Scene {
  readonly id = "cg";

  private readonly script: CgScript;
  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement | null;
  private readonly audio: AudioManager | null;
  private readonly injectedInput: Input | null;
  private readonly onEnd?: () => void;
  private readonly logger: Logger;

  private input: Input | null = null;
  private stepIndex = 0;
  private overlay = 1;
  private overlayStart = 1;
  private overlayTarget = 1;
  private fadeMs = 0;
  private fadeElapsed = 0;
  private textValue: string | null = null;
  private letterboxOn = false;
  private cgWaiting = false;
  private cgShown = false;
  private finished = false;
  private entered = false;
  private boxEl: HTMLElement | null = null;

  constructor(options: CgSceneOptions) {
    this.script = options.script;
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.uiRoot = options.uiRoot ?? null;
    this.audio = options.audio ?? null;
    this.injectedInput = options.input ?? null;
    this.onEnd = options.onEnd;
    this.logger = options.logger ?? createNoopLogger();
  }

  /** The text line currently waiting for confirm (headless-observable). */
  get currentText(): string | null {
    return this.textValue;
  }

  /** True once the CG has ended (or was fully skipped). */
  get isFinished(): boolean {
    return this.finished;
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
    this.input = this.injectedInput ?? createKeyboardOnlyInput();
    if (this.uiRoot !== null && typeof document !== "undefined") {
      const box = document.createElement("div");
      box.dataset.testid = "cg-layer";
      box.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:8rem",
        "transform:translateX(-50%)",
        "min-width:20rem",
        "max-width:80vw",
        "padding:0.8rem 1rem",
        "background:rgba(15,16,24,0.9)",
        "color:#fff",
        "border:1px solid #556",
        "border-radius:0.5rem",
        "font:14px/1.5 system-ui,sans-serif",
        "z-index:75",
        "display:none",
      ].join(";");
      this.uiRoot.appendChild(box);
      this.boxEl = box;
    }
    this.logger.info("cg: entered", { steps: this.script.length });
    this.advance();
  }

  update(dt: number): void {
    if (this.finished || this.input === null) {
      return;
    }
    if (this.input.consumeConfirm() === true) {
      this.skip();
      return;
    }
    if (this.cgWaiting) {
      if (this.renderer.textureReady(CG_TEXTURE_ID)) {
        this.cgWaiting = false;
        this.cgShown = true;
        this.logger.info("cg: still shown", {});
        this.advance();
      }
      return;
    }
    if (this.fadeMs > 0) {
      // dt arrives in seconds; fade durations are milliseconds (command args).
      this.fadeElapsed += dt * 1000;
      const t = Math.min(1, this.fadeElapsed / Math.max(1, this.fadeMs));
      this.overlay = this.overlayStart + (this.overlayTarget - this.overlayStart) * t;
      if (this.fadeElapsed >= this.fadeMs) {
        this.fadeMs = 0;
        this.overlay = this.overlayTarget;
        this.advance();
      }
    }
  }

  render(): void {
    const renderer = this.renderer;
    renderer.beginFrame();
    renderer.drawRect(0, 0, this.canvas.width, this.canvas.height, "#0a0c10");
    if (this.cgShown) {
      renderer.drawTexture(CG_TEXTURE_ID, 0, 0, this.canvas.width, this.canvas.height, "cover");
    }
    if (this.letterboxOn) {
      const bar = Math.floor(this.canvas.height * 0.12);
      renderer.drawRect(0, 0, this.canvas.width, bar, "#000000");
      renderer.drawRect(0, this.canvas.height - bar, this.canvas.width, bar, "#000000");
    }
    if (this.overlay > 0.001) {
      renderer.drawRect(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        `rgba(0,0,0,${this.overlay.toFixed(3)})`,
      );
    }
    renderer.endFrame();
  }

  exit(): void {
    if (!this.entered) {
      return;
    }
    this.entered = false;
    this.boxEl?.remove();
    this.boxEl = null;
    if (this.injectedInput === null) {
      this.input?.dispose();
    }
    this.input = null;
    this.logger.debug("cg: exited", {});
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Confirm = skip: snap the running fade / skip the still wait / the line. */
  private skip(): void {
    if (this.cgWaiting) {
      this.cgWaiting = false;
      this.advance();
      return;
    }
    if (this.fadeMs > 0) {
      this.fadeMs = 0;
      this.fadeElapsed = 0;
      this.overlay = this.overlayTarget;
      this.advance();
      return;
    }
    if (this.textValue !== null) {
      this.advance();
    }
  }

  /** Run instant steps until a waiting step (text / still / fade) or the end. */
  private advance(): void {
    for (;;) {
      const step = this.script[this.stepIndex];
      if (step === undefined) {
        this.finish();
        return;
      }
      this.stepIndex += 1;
      switch (step.kind) {
        case "text":
          this.setText(step.text);
          return;
        case "bgm":
          this.audio?.startBgm(step.ref);
          continue;
        case "sfx":
          this.audio?.playSfx(step.ref);
          continue;
        case "letterbox":
          this.letterboxOn = step.on;
          continue;
        case "cg": {
          this.renderer.registerTexture(CG_TEXTURE_ID, step.image);
          if (this.renderer.textureReady(CG_TEXTURE_ID)) {
            this.cgShown = true;
            this.logger.info("cg: still shown", {});
            continue;
          }
          this.cgWaiting = true;
          return;
        }
        case "fadeOut":
          this.startFade(step.durationMs, 1);
          return;
        case "fadeIn":
          this.startFade(step.durationMs, 0);
          return;
        case "end":
          this.finish();
          return;
      }
    }
  }

  private startFade(durationMs: number, target: number): void {
    this.overlayStart = this.overlay;
    this.overlayTarget = target;
    this.fadeMs = Math.max(1, durationMs);
    this.fadeElapsed = 0;
  }

  private setText(text: string): void {
    this.textValue = text;
    if (this.boxEl !== null) {
      const el = this.boxEl.querySelector("[data-testid='cg-text']") ?? makeTextEl();
      el.textContent = text;
      this.boxEl.appendChild(el);
      this.boxEl.style.display = "block";
    }
  }

  private finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.boxEl !== null) {
      this.boxEl.style.display = "none";
    }
    this.logger.info("cg: ended", { steps: this.script.length });
    this.onEnd?.();
  }
}

function makeTextEl(): HTMLElement {
  const el = document.createElement("div");
  el.dataset.testid = "cg-text";
  return el;
}
