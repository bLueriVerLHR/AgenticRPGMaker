/**
 * Storage abstraction (P1c, docs/06-architecture.md §7 "Storage abstraction").
 *
 * The Adapter pattern behind RQ1: saves must stay portable (IndexedDB in the
 * browser, RQ1) while a future C++ local-file adapter is an option later.
 * Game logic talks to the `Storage` interface only. The `MemoryStorage`
 * implementation is the deterministic in-memory adapter used by unit tests
 * (and a useful fallback when IndexedDB is unavailable).
 *
 * `SaveData` is the core `save` schema (ADR-003): map id, player
 * position/direction, variables/switches, and a timestamp.
 */
import type { SaveData } from "@agenticrpg/core";

/** A save slot: read/write/clear one `SaveData` document. */
export interface Storage {
  /** Whether this storage backend is usable right now. */
  readonly available: boolean;
  /** Persist `data`. Resolves when durable; never rejects on unavailable. */
  save(data: SaveData): Promise<void>;
  /** Load the stored document, or null when empty/corrupt/unavailable. */
  load(): Promise<SaveData | null>;
  /** Remove the stored document (no-op when empty). */
  clear(): Promise<void>;
}

/** Deterministic in-memory storage (tests, unavailable-IndexedDB fallback). */
export class MemoryStorage implements Storage {
  private value: SaveData | null = null;

  /** Always available. */
  get available(): boolean {
    return true;
  }

  async save(data: SaveData): Promise<void> {
    this.value = structuredCloneSafe(data);
  }

  async load(): Promise<SaveData | null> {
    return this.value === null ? null : structuredCloneSafe(this.value);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
