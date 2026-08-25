/**
 * Undo/redo command stack (P2, docs/06-architecture.md §7 — Command pattern).
 *
 * Every undoable editor operation is an `EditorCommand` with a `label` (used
 * by the UI and logs) and pure `do`/`undo` functions over the editor snapshot.
 * The stack enforces strict alternation: `execute` runs `do` and pushes;
 * `undo` pops and runs `undo`; `redo` runs `do` again. Because every command
 * is a pure snapshot→snapshot transform, the stack is deterministic and
 * trivially testable (no React involved).
 */
import type { EditorSnapshot } from "./editor-store.js";

/** A single undoable editor operation (Command pattern). */
export interface EditorCommand {
  /** Human-readable label, e.g. "paint 12 tiles" or "add layer". */
  readonly label: string;
  /** Apply the command: snapshot → snapshot. */
  do(snapshot: EditorSnapshot): EditorSnapshot;
  /** Reverse the command: snapshot → snapshot. */
  undo(snapshot: EditorSnapshot): EditorSnapshot;
}

/** An undo/redo stack of `EditorCommand`s. */
export class CommandStack {
  private undoStack: EditorCommand[] = [];
  private redoStack: EditorCommand[] = [];

  /** Whether there is something to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether there is something to redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the command that would be undone, or null. */
  get undoLabel(): string | null {
    const top = this.undoStack[this.undoStack.length - 1];
    return top === undefined ? null : top.label;
  }

  /** Label of the command that would be redone, or null. */
  get redoLabel(): string | null {
    const top = this.redoStack[this.redoStack.length - 1];
    return top === undefined ? null : top.label;
  }

  /** Depth of the undo stack. */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  /** Record a just-executed command (clears the redo stack). */
  push(command: EditorCommand): void {
    this.undoStack.push(command);
    this.redoStack = [];
  }

  /** Pop the top command for undo, or null when empty. */
  popUndo(): EditorCommand | null {
    const command = this.undoStack.pop();
    if (command !== undefined) {
      this.redoStack.push(command);
      return command;
    }
    return null;
  }

  /** Pop the top command for redo, or null when empty. */
  popRedo(): EditorCommand | null {
    const command = this.redoStack.pop();
    if (command !== undefined) {
      this.undoStack.push(command);
      return command;
    }
    return null;
  }

  /** Clear both stacks (e.g. opening a different map/project). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
