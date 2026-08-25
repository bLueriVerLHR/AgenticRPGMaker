/**
 * Input system (P1c; docs/08-compatibility-checklist.md §4.4).
 *
 * Handles keyboard (arrows/WASD + Z/Enter confirm + X/Esc cancel) and the
 * on-screen virtual controls (a D-pad + A/B buttons) required for JoiPlay,
 * which has no physical keyboard. The D-pad works with pointer events (touch
 * and mouse) per the compatibility checklist.
 *
 * Movement is step-driven: `directionHeld()` returns the currently held
 * direction (last-pressed wins among held), while `consumeConfirm()` /
 * `consumeCancel()` are edge-triggered (one shot per keypress / tap) so a
 * press is not consumed twice.
 */
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

/** The four movement directions. */
export type InputDirection = "up" | "down" | "left" | "right";

/** A 2D movement vector in tile units (one step per direction press). */
export interface DirectionVector {
  x: number;
  y: number;
}

export const DIRECTION_VECTORS: Record<InputDirection, DirectionVector> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Key codes mapped to actions. */
export const KEY_TO_DIRECTION: Record<string, InputDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export const CONFIRM_KEYS: readonly string[] = ["KeyZ", "Enter", "Space"];
export const CANCEL_KEYS: readonly string[] = ["KeyX", "Escape", "Backspace"];

/** A single direction-tap (from the D-pad or a key edge). */
export interface DirectionTap {
  direction: InputDirection;
}

export interface InputOptions {
  /** DOM root the virtual controls are appended to. */
  root?: HTMLElement;
  /** Whether to attach the keyboard listener. Default true. */
  keyboard?: boolean;
  /** Whether to create the virtual D-pad controls. Default false. */
  virtualControls?: boolean;
  logger?: Logger;
  /** Element to attach key listeners to (default window). */
  target?: EventTarget;
}

/**
 * Shared input state. One instance per game; scenes read held direction and
 * consume confirm/cancel edges.
 */
export class Input {
  private readonly logger: Logger;
  private readonly root: HTMLElement | null;
  private readonly keyboardEnabled: boolean;
  private readonly target: EventTarget | undefined;

  private readonly pressed = new Set<string>();
  private heldDirection: InputDirection | null = null;
  private readonly directionStack: InputDirection[] = [];
  private confirmQueued = 0;
  private cancelQueued = 0;

  private readonly cleanup: Array<() => void> = [];
  private virtualEl: HTMLElement | null = null;

  constructor(options: InputOptions = {}) {
    this.logger = options.logger ?? createNoopLogger();
    this.root = options.root ?? null;
    this.keyboardEnabled = options.keyboard ?? true;
    this.target = options.target;

    if (this.keyboardEnabled) {
      this.attachKeyboard();
    }
    if (options.virtualControls === true && this.root !== null) {
      this.createVirtualControls(this.root);
    }
  }

  /** Currently held movement direction, or null. */
  get direction(): InputDirection | null {
    return this.heldDirection;
  }

  /** True when the confirm button/key is currently held. */
  get confirmHeld(): boolean {
    return this.pressed.has("confirm");
  }

  /** The held direction as a tile-step vector. */
  directionVector(): DirectionVector | null {
    if (this.heldDirection === null) {
      return null;
    }
    return DIRECTION_VECTORS[this.heldDirection];
  }

  /** Edge-triggered confirm (one true per press/tap). */
  consumeConfirm(): boolean {
    if (this.confirmQueued > 0) {
      this.confirmQueued -= 1;
      return true;
    }
    return false;
  }

  /** Edge-triggered cancel. */
  consumeCancel(): boolean {
    if (this.cancelQueued > 0) {
      this.cancelQueued -= 1;
      return true;
    }
    return false;
  }

  /** Clear all input state (e.g. on scene exit). */
  clear(): void {
    this.pressed.clear();
    this.heldDirection = null;
    this.directionStack.length = 0;
    this.confirmQueued = 0;
    this.cancelQueued = 0;
  }

  /** Dispose listeners and remove virtual controls. */
  dispose(): void {
    this.clear();
    for (const cleanup of this.cleanup) {
      cleanup();
    }
    this.cleanup.length = 0;
    this.virtualEl?.remove();
    this.virtualEl = null;
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  private attachKeyboard(): void {
    const target = this.target ?? (typeof window !== "undefined" ? window : null);
    if (target === null) {
      return;
    }
    const onKeyDown = (event: Event): void => {
      const e = event as KeyboardEvent;
      const code = e.code;
      if (CONFIRM_KEYS.includes(code)) {
        if (!e.repeat) {
          this.confirmQueued += 1;
        }
        this.pressed.add("confirm");
        e.preventDefault();
        return;
      }
      if (CANCEL_KEYS.includes(code)) {
        if (!e.repeat) {
          this.cancelQueued += 1;
        }
        this.pressed.add("cancel");
        e.preventDefault();
        return;
      }
      const direction = KEY_TO_DIRECTION[code];
      if (direction !== undefined && !e.repeat) {
        this.pressDirection(direction);
        e.preventDefault();
      }
    };
    const onKeyUp = (event: Event): void => {
      const e = event as KeyboardEvent;
      const code = e.code;
      if (CONFIRM_KEYS.includes(code)) {
        this.pressed.delete("confirm");
        return;
      }
      if (CANCEL_KEYS.includes(code)) {
        this.pressed.delete("cancel");
        return;
      }
      const direction = KEY_TO_DIRECTION[code];
      if (direction !== undefined) {
        this.releaseDirection(direction);
      }
    };
    const onBlur = (): void => {
      this.clear();
    };
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    });
  }

  // ------------------------------------------------------------------
  // Direction bookkeeping (last-pressed wins among held)
  // ------------------------------------------------------------------

  /** Press (hold) a direction. Also used by the virtual D-pad and tests. */
  pressDirection(direction: InputDirection): void {
    if (this.directionStack.includes(direction)) {
      return;
    }
    this.directionStack.push(direction);
    this.heldDirection = direction;
  }

  /** Release a held direction. */
  releaseDirection(direction: InputDirection): void {
    const index = this.directionStack.indexOf(direction);
    if (index >= 0) {
      this.directionStack.splice(index, 1);
    }
    this.heldDirection =
      this.directionStack.length > 0 ? this.directionStack[this.directionStack.length - 1]! : null;
  }

  /** Queue one confirm edge (used by the A button and tests). */
  queueConfirm(): void {
    this.confirmQueued += 1;
  }

  /** Queue one cancel edge (used by the B button and tests). */
  queueCancel(): void {
    this.cancelQueued += 1;
  }

  // ------------------------------------------------------------------
  // Virtual controls (JoiPlay: no keyboard, docs/08 §4.4)
  // ------------------------------------------------------------------

  private createVirtualControls(root: HTMLElement): void {
    const el = document.createElement("div");
    el.className = "agenticrpg-virtual-controls";
    el.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      "height:9rem",
      "pointer-events:none",
      "z-index:50",
      "display:flex",
      "justify-content:space-between",
      "align-items:flex-end",
      "padding:1rem",
    ].join(";");

    const pad = document.createElement("div");
    pad.className = "agenticrpg-dpad";
    pad.style.cssText = [
      "pointer-events:auto",
      "width:9rem",
      "height:9rem",
      "position:relative",
    ].join(";");
    this.addPadButton(pad, "up", "▲", { left: "3rem", top: "0" });
    this.addPadButton(pad, "down", "▼", { left: "3rem", top: "6rem" });
    this.addPadButton(pad, "left", "◀", { left: "0", top: "3rem" });
    this.addPadButton(pad, "right", "▶", { left: "6rem", top: "3rem" });

    const actions = document.createElement("div");
    actions.className = "agenticrpg-dpad-actions";
    actions.style.cssText = [
      "pointer-events:auto",
      "display:flex",
      "gap:1rem",
      "align-items:flex-end",
    ].join(";");
    this.addActionButton(actions, "A", "confirm");
    this.addActionButton(actions, "B", "cancel");

    el.appendChild(pad);
    el.appendChild(actions);
    root.appendChild(el);
    this.virtualEl = el;
  }

  private addPadButton(
    parent: HTMLElement,
    direction: InputDirection,
    label: string,
    position: { left: string; top: string },
  ): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.testid = `dpad-${direction}`;
    button.dataset.direction = direction;
    button.style.cssText = [
      "position:absolute",
      "width:3rem",
      "height:3rem",
      "border-radius:0.5rem",
      "border:1px solid rgba(255,255,255,0.4)",
      "background:rgba(0,0,0,0.4)",
      "color:#fff",
      "font-size:1.2rem",
      "touch-action:none",
      "user-select:none",
      ...Object.entries(position).map(([k, v]) => `${k}:${v}`),
    ].join(";");
    const press = (): void => {
      this.pressDirection(direction);
    };
    const release = (): void => {
      this.releaseDirection(direction);
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
    this.cleanup.push(() => {
      button.removeEventListener("pointerdown", press);
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointercancel", release);
      button.removeEventListener("pointerleave", release);
    });
    parent.appendChild(button);
  }

  private addActionButton(parent: HTMLElement, label: string, action: "confirm" | "cancel"): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.testid = `dpad-${action}`;
    button.style.cssText = [
      "width:3.5rem",
      "height:3.5rem",
      "border-radius:50%",
      "border:1px solid rgba(255,255,255,0.4)",
      "background:rgba(0,0,0,0.4)",
      "color:#fff",
      "font-size:1.2rem",
      "touch-action:none",
      "user-select:none",
    ].join(";");
    const press = (): void => {
      if (action === "confirm") {
        this.queueConfirm();
      } else {
        this.queueCancel();
      }
    };
    button.addEventListener("pointerdown", press);
    this.cleanup.push(() => {
      button.removeEventListener("pointerdown", press);
    });
    parent.appendChild(button);
  }
}

/** Test-only helper: build an Input with no DOM hooks. */
export function createKeyboardOnlyInput(
  options: Omit<InputOptions, "virtualControls"> = {},
): Input {
  return new Input({ ...options, virtualControls: false });
}
