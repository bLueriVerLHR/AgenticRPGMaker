/**
 * Title screen (task 21): the start-menu overlay — "New Game" / "Continue".
 *
 * Owner request (2026-09-01): the shipped player must open on a start screen
 * where a new game can be started or an existing game continued. The handle
 * is the testable seam: unit tests drive `choose()` headlessly (no DOM in the
 * Node test environment, same philosophy as MapScene's headless mode), while
 * the real DOM overlay is exercised by the browser E2E suites.
 *
 * Conservative-API only (docs/08-compatibility-checklist.md §3): plain DOM,
 * no frameworks, no remote assets — same styling family as the dialogue box.
 */
import type { Logger } from "./logger.js";
import type { Storage } from "./storage.js";

/** Which session the player chose on the title screen. */
export type TitleChoice = "new" | "continue";

export interface TitleScreenOptions {
  /** Storage backing the Continue availability check. */
  storage: Storage;
  logger: Logger;
  /** DOM root for the overlay; null ⇒ headless (programmatic only). */
  root?: HTMLElement | null;
  /** Title line rendered above the buttons. */
  title?: string;
  /** Begin a fresh session (ignores any save). */
  onNewGame: () => void | Promise<void>;
  /** Resume the latest save. Resolves false when it cannot be applied. */
  onContinue: () => Promise<boolean>;
}

/** Handle for the title screen overlay (attached to `Game.title`). */
export interface TitleScreenHandle {
  /** True until a choice begins the session (failed Continue keeps it). */
  readonly visible: boolean;
  /** Re-check Continue availability (storage read); updates the button. */
  refresh(): Promise<boolean>;
  /**
   * Choose a session. "continue" with no restorable save resolves false and
   * leaves the screen up; otherwise the overlay is disposed and the session
   * begins. Resolves false after dispose (double-invoke guard).
   */
  choose(choice: TitleChoice): Promise<boolean>;
  /** Remove the overlay and detach listeners (idempotent). */
  dispose(): void;
}

const BUTTON_STYLE = [
  "width:100%",
  "box-sizing:border-box",
  "padding:0.55rem 1.2rem",
  "font:inherit",
  "text-align:center",
  "background:#1d2433",
  "color:#fff",
  "border:1px solid #667",
  "border-radius:0.4rem",
  "cursor:pointer",
].join(";");
const DISABLED_STYLE = "opacity:0.45;cursor:not-allowed";

export function showTitleScreen(options: TitleScreenOptions): TitleScreenHandle {
  const { storage, logger } = options;
  const root = options.root ?? null;

  let visible = true;
  let disposed = false;
  let hasSave = false;

  let newButton: HTMLButtonElement | null = null;
  let continueButton: HTMLButtonElement | null = null;
  let overlay: HTMLDivElement | null = null;
  let keyHandler: ((event: Event) => void) | null = null;

  const disposeDom = (): void => {
    if (keyHandler !== null) {
      window.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    overlay?.remove();
    overlay = null;
    newButton = null;
    continueButton = null;
  };

  const applyContinueState = (): void => {
    if (continueButton === null) {
      return;
    }
    continueButton.disabled = !hasSave;
    // Task 22: uniform buttons — same geometry, and the dimmed state says
    // why instead of looking like a different kind of element.
    continueButton.textContent = hasSave ? "Continue" : "Continue (no save)";
    continueButton.style.cssText = hasSave ? BUTTON_STYLE : `${BUTTON_STYLE};${DISABLED_STYLE}`;
  };

  const buildDom = (): void => {
    if (root === null) {
      return;
    }
    overlay = document.createElement("div");
    overlay.dataset.testid = "title-screen";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:1.2rem",
      "background:rgba(8,10,16,0.96)",
      "color:#fff",
      "font:16px/1.5 system-ui,sans-serif",
      "z-index:90",
      // The ui root is pointer-events:none (so HUD layers never block canvas
      // input); the title is a real menu, so it re-enables hit-testing for
      // itself and its buttons.
      "pointer-events:auto",
    ].join(";");

    const heading = document.createElement("div");
    heading.dataset.testid = "title-heading";
    heading.textContent = options.title ?? "AgenticRPGMaker";
    heading.style.cssText = "font-size:1.6rem;letter-spacing:0.08em";
    overlay.appendChild(heading);

    const menu = document.createElement("div");
    // Task 22: a fixed-width column so both buttons are pixel-identical in
    // size regardless of label length.
    menu.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "gap:0.6rem",
      "width:16rem",
    ].join(";");

    newButton = document.createElement("button");
    newButton.dataset.testid = "title-new-game";
    newButton.textContent = "New Game";
    newButton.addEventListener("click", () => void handle.choose("new"));
    menu.appendChild(newButton);

    continueButton = document.createElement("button");
    continueButton.dataset.testid = "title-continue";
    continueButton.textContent = "Continue";
    continueButton.addEventListener("click", () => void handle.choose("continue"));
    menu.appendChild(continueButton);

    overlay.appendChild(menu);
    root.appendChild(overlay);

    keyHandler = (event: Event): void => {
      const e = event as KeyboardEvent;
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        void handle.choose(hasSave ? "continue" : "new");
      }
    };
    window.addEventListener("keydown", keyHandler);
    applyContinueState();
  };

  const handle: TitleScreenHandle = {
    get visible(): boolean {
      return visible;
    },

    async refresh(): Promise<boolean> {
      if (disposed) {
        return false;
      }
      try {
        hasSave = storage.available && (await storage.load()) !== null;
      } catch (error) {
        logger.warn("title: save availability check failed", { error: String(error) });
        hasSave = false;
      }
      applyContinueState();
      return hasSave;
    },

    async choose(choice: TitleChoice): Promise<boolean> {
      if (disposed || !visible) {
        return false;
      }
      if (choice === "continue") {
        if (!(await handle.refresh())) {
          logger.info("title: continue chosen but no save exists");
          return false;
        }
        visible = false;
        disposeDom();
        const resumed = await options.onContinue();
        if (!resumed) {
          // The save vanished between the availability check and the read;
          // fall back to a fresh session rather than a dead screen.
          logger.warn("title: continue failed; starting a new game instead");
          await options.onNewGame();
        }
        logger.info("title: session began", { choice: "continue" });
        return true;
      }
      visible = false;
      disposeDom();
      await options.onNewGame();
      logger.info("title: session began", { choice: "new" });
      return true;
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      visible = false;
      disposeDom();
    },
  };

  buildDom();
  void handle.refresh();
  return handle;
}
