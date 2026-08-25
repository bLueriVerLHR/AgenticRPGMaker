/**
 * Editor store (P2, ADR-006; docs/06-architecture.md §4 "editing through core").
 *
 * The store is the editor's single in-memory snapshot: the open project, its
 * map/tileset documents, the current map/layer/event selection, and the active
 * tool. It is intentionally framework-free (plain TypeScript) and consumed by
 * React via `useSyncExternalStore`.
 *
 * Every *document* change goes through `execute(command)`, which:
 *   1. applies the command's pure `do` transform,
 *   2. re-validates every document against the core zod schemas (single source
 *      of truth — an editor bug can never persist an invalid map),
 *   3. re-syncs the project manifest (`syncProjectAssets`),
 *   4. pushes the command onto the undo stack,
 *   5. notifies subscribers and fires the "mutated" hook (autosave).
 *
 * UI-only changes (tool, palette tile, selection) use `set()` and are neither
 * undoable nor persisted.
 */
import type { MapData, ProjectData, TilesetData } from "@agenticrpg/core";
import { mapSchema, projectSchema, tilesetSchema } from "@agenticrpg/core";
import { syncProjectAssets } from "../model/project.js";
import { CommandStack, type EditorCommand } from "./command-stack.js";

/** The active editor tool. */
export type EditorTool = "select" | "paint" | "erase" | "event";

/** The editor's full snapshot. */
export interface EditorSnapshot {
  /** Open project id (null before any project is open). */
  projectId: string | null;
  /** The open project's display name (not part of the core project schema). */
  projectName: string;
  project: ProjectData;
  maps: MapData[];
  tilesets: TilesetData[];
  currentMapId: string;
  selectedLayerId: string | null;
  selectedEventId: string | null;
  tool: EditorTool;
  /** The palette tile index to paint (0 = eraser/empty). */
  paletteTile: number;
  /** Whether the runtime preview overlay is open. */
  previewOpen: boolean;
}

/** The current map of a snapshot (throws when the project has no maps). */
export function currentMapOf(snapshot: EditorSnapshot): MapData {
  const map = snapshot.maps.find((m) => m.id === snapshot.currentMapId) ?? snapshot.maps[0];
  if (map === undefined) {
    throw new Error("editor: snapshot has no maps");
  }
  return map;
}

/** Replace the map with `id` by `replacement` (immutable). */
export function replaceMap(
  snapshot: EditorSnapshot,
  mapId: string,
  replacement: MapData,
): EditorSnapshot {
  return {
    ...snapshot,
    currentMapId: mapId,
    maps: snapshot.maps.map((m) => (m.id === mapId ? replacement : m)),
  };
}

/** Thrown when a mutation would produce a schema-invalid document. */
export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

/** Validate every document in the snapshot against the core zod schemas. */
export function validateSnapshot(snapshot: EditorSnapshot): void {
  const projectResult = projectSchema.safeParse(snapshot.project);
  if (!projectResult.success) {
    throw new InvalidDocumentError(`project: ${projectResult.error.message}`);
  }
  for (const map of snapshot.maps) {
    const result = mapSchema.safeParse(map);
    if (!result.success) {
      throw new InvalidDocumentError(`map "${map.id}": ${result.error.message}`);
    }
  }
  for (const tileset of snapshot.tilesets) {
    const result = tilesetSchema.safeParse(tileset);
    if (!result.success) {
      throw new InvalidDocumentError(`tileset "${tileset.id}": ${result.error.message}`);
    }
  }
}

/** Create the initial snapshot for an opened project. */
export function createInitialSnapshot(input: {
  projectId: string;
  projectName?: string;
  project: ProjectData;
  maps: MapData[];
  tilesets: TilesetData[];
}): EditorSnapshot {
  const snapshot: EditorSnapshot = {
    projectId: input.projectId,
    projectName: input.projectName ?? "Untitled Project",
    project: input.project,
    maps: input.maps,
    tilesets: input.tilesets,
    currentMapId: input.project.settings.initialMap,
    selectedLayerId: null,
    selectedEventId: null,
    tool: "paint",
    paletteTile: 1,
    previewOpen: false,
  };
  if (snapshot.maps.length === 0) {
    throw new InvalidDocumentError("project has no maps");
  }
  validateSnapshot(snapshot);
  return snapshot;
}

/** Subscriber for document mutations (used by the autosave hook). */
export type MutationListener = () => void;

/**
 * The editor state store. `subscribe`/`getSnapshot` follow the
 * `useSyncExternalStore` contract; `onMutated` is a separate channel for
 * autosave so UI-only changes do not trigger persistence.
 */
export class EditorStore {
  private snapshot: EditorSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly mutationListeners = new Set<MutationListener>();
  private readonly stack = new CommandStack();

  constructor(initial: EditorSnapshot) {
    this.snapshot = initial;
  }

  /** Current snapshot (stable reference until the next change). */
  getSnapshot(): EditorSnapshot {
    return this.snapshot;
  }

  /** Subscribe to any snapshot change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to document mutations (autosave). Returns an unsubscribe fn. */
  onMutated(listener: MutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  /** Whether an undo is available. */
  get canUndo(): boolean {
    return this.stack.canUndo;
  }

  /** Whether a redo is available. */
  get canRedo(): boolean {
    return this.stack.canRedo;
  }

  /** Label of the next undoable command, or null. */
  get undoLabel(): string | null {
    return this.stack.undoLabel;
  }

  /** Label of the next redoable command, or null. */
  get redoLabel(): string | null {
    return this.stack.redoLabel;
  }

  /** Apply a UI-only change (tool, palette, selection, preview toggle). */
  set(patch: Partial<EditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  /**
   * Execute an undoable document mutation: apply, validate, sync the project
   * manifest, push onto the stack, and notify (including autosave listeners).
   */
  execute(command: EditorCommand): void {
    let next = command.do(this.snapshot);
    validateSnapshot(next);
    next = { ...next, project: syncProjectAssets(next.project, next.maps, next.tilesets) };
    this.snapshot = next;
    this.stack.push(command);
    this.emit();
    for (const listener of this.mutationListeners) {
      listener();
    }
  }

  /** Undo the last command (no-op when the stack is empty). */
  undo(): void {
    const command = this.stack.popUndo();
    if (command === null) {
      return;
    }
    let next = command.undo(this.snapshot);
    validateSnapshot(next);
    next = { ...next, project: syncProjectAssets(next.project, next.maps, next.tilesets) };
    this.snapshot = next;
    this.emit();
    for (const listener of this.mutationListeners) {
      listener();
    }
  }

  /** Redo the last undone command (no-op when the redo stack is empty). */
  redo(): void {
    const command = this.stack.popRedo();
    if (command === null) {
      return;
    }
    let next = command.do(this.snapshot);
    validateSnapshot(next);
    next = { ...next, project: syncProjectAssets(next.project, next.maps, next.tilesets) };
    this.snapshot = next;
    this.emit();
    for (const listener of this.mutationListeners) {
      listener();
    }
  }

  /** Replace the whole snapshot (opening/importing a project). */
  replace(input: {
    projectId: string;
    project: ProjectData;
    maps: MapData[];
    tilesets: TilesetData[];
  }): void {
    this.snapshot = createInitialSnapshot(input);
    this.stack.clear();
    this.emit();
    for (const listener of this.mutationListeners) {
      listener();
    }
  }

  /** Clear the undo/redo history. */
  clearHistory(): void {
    this.stack.clear();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
