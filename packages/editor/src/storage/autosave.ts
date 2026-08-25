/**
 * Debounced autosave (P2, ADR-006: "Autosave into IndexedDB on change
 * (debounced) so an accidental refresh does not lose work").
 *
 * `DebouncedAutosave` wraps a persist function: `schedule()` coalesces bursts
 * of mutations into a single write after `delayMs` (500ms default), while
 * `flush()` writes immediately (explicit Save button, beforeunload, E2E).
 * Failures are logged as warnings — autosave must never crash the editor.
 */
import type { EditorLogger } from "../logger.js";
import { createNoopLogger } from "../logger.js";

export class DebouncedAutosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(
    private readonly persist: () => Promise<void>,
    private readonly delayMs = 500,
    private readonly logger: EditorLogger = createNoopLogger(),
  ) {}

  /** Debounce a persist: resets the timer; one write after `delayMs` of quiet. */
  schedule(): void {
    this.pending = true;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }

  /** Persist now if anything is pending (returns when durable). */
  async flush(): Promise<void> {
    this.clearTimer();
    if (!this.pending) {
      return;
    }
    this.pending = false;
    await this.run();
  }

  /** Cancel any pending write (dispose). */
  dispose(): void {
    this.clearTimer();
    this.pending = false;
  }

  /** Whether a write is scheduled or in flight. */
  get isPending(): boolean {
    return this.pending || this.timer !== null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    try {
      await this.persist();
      this.logger.debug("autosave: project persisted");
    } catch (error) {
      this.logger.warn("autosave: persist failed", { error: String(error) });
    }
  }
}
