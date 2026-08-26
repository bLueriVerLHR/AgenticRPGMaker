/**
 * World-mode storage (ADR-008 §7, S3c).
 *
 * The save-v2 Storage adapter for world mode. Same portability story as the
 * v1 `Storage` seam (RQ1): IndexedDB writes the `save` v2 document; a memory
 * implementation serves tests and unavailable-IDB fallback. The IndexedDB
 * backend uses a dedicated object store ("world-saves") so world saves never
 * collide with the v1 saves in the same database.
 */
import type { SaveDataV2 } from "@agenticrpg/core";
import { parseSaveV2Document } from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

/** World-mode save slot: read/write/clear one save-v2 document. */
export interface WorldStorage {
  /** Whether this storage backend is usable right now. */
  readonly available: boolean;
  /** Persist `data`. Resolves when durable; never rejects on unavailable. */
  save(data: SaveDataV2): Promise<void>;
  /** Load the stored document, or null when empty/corrupt/unavailable. */
  load(): Promise<SaveDataV2 | null>;
  /** Remove the stored document (no-op when empty). */
  clear(): Promise<void>;
}

/** Deterministic in-memory world storage (tests, unavailable-IDB fallback). */
export class MemoryWorldStorage implements WorldStorage {
  private value: SaveDataV2 | null = null;

  get available(): boolean {
    return true;
  }

  async save(data: SaveDataV2): Promise<void> {
    this.value =
      typeof structuredClone === "function"
        ? (structuredClone(data) as SaveDataV2)
        : (JSON.parse(JSON.stringify(data)) as SaveDataV2);
  }

  async load(): Promise<SaveDataV2 | null> {
    if (this.value === null) {
      return null;
    }
    return typeof structuredClone === "function"
      ? (structuredClone(this.value) as SaveDataV2)
      : (JSON.parse(JSON.stringify(this.value)) as SaveDataV2);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export interface IndexedDBWorldStorageOptions {
  /** IndexedDB database name. Default "agenticrpg-saves". */
  dbName?: string;
  /** Object store name. Default "world-saves" (isolated from v1 saves). */
  storeName?: string;
  /** Slot key inside the store. Default "world-default". */
  key?: string;
  /** Injectable IDB factory (fake-indexeddb in tests); null = unavailable. */
  idb?: IDBFactory | null;
  logger?: Logger;
}

export const DEFAULT_WORLD_SAVES_STORE = "world-saves";
export const DEFAULT_WORLD_SAVES_KEY = "world-default";

/**
 * IndexedDB-backed world save slot (save v2). Same graceful-degradation
 * contract as `IndexedDBStorage`: unavailable/corrupt/unknown-version saves
 * warn and return null — never crash the boot.
 */
export class IndexedDBWorldStorage implements WorldStorage {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private readonly idb: IDBFactory | null;
  private readonly logger: Logger;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBWorldStorageOptions = {}) {
    this.dbName = options.dbName ?? "agenticrpg-saves";
    this.storeName = options.storeName ?? DEFAULT_WORLD_SAVES_STORE;
    this.key = options.key ?? DEFAULT_WORLD_SAVES_KEY;
    this.idb = options.idb === undefined ? resolveIDB() : options.idb;
    this.logger = options.logger ?? createNoopLogger();
  }

  get available(): boolean {
    return this.idb !== null;
  }

  async save(data: SaveDataV2): Promise<void> {
    if (this.idb === null) {
      this.logger.warn("world storage: unavailable, save skipped", { key: this.key });
      return;
    }
    try {
      const db = await this.open();
      await this.request<void>(
        db.transaction(this.storeName, "readwrite"),
        (store) => store.put(data, this.key) as unknown as IDBRequest<unknown>,
      );
      this.logger.debug("world storage: saved", { key: this.key, worldId: data.worldId });
    } catch (error) {
      this.logger.warn("world storage: save failed", { key: this.key, error: String(error) });
    }
  }

  async load(): Promise<SaveDataV2 | null> {
    if (this.idb === null) {
      this.logger.warn("world storage: unavailable, load returned null", { key: this.key });
      return null;
    }
    try {
      const db = await this.open();
      const raw = await this.request<unknown>(db.transaction(this.storeName, "readonly"), (store) =>
        store.get(this.key),
      );
      if (raw === undefined || raw === null) {
        return null;
      }
      const parsed = parseSaveV2Document(raw);
      this.logger.debug("world storage: loaded", { key: this.key, worldId: parsed.worldId });
      return parsed;
    } catch (error) {
      this.logger.warn("world storage: load failed or corrupt save", {
        key: this.key,
        error: String(error),
      });
      return null;
    }
  }

  async clear(): Promise<void> {
    if (this.idb === null) {
      return;
    }
    try {
      const db = await this.open();
      await this.request<void>(
        db.transaction(this.storeName, "readwrite"),
        (store) => store.delete(this.key) as unknown as IDBRequest<unknown>,
      );
      this.logger.debug("world storage: cleared", { key: this.key });
    } catch (error) {
      this.logger.warn("world storage: clear failed", { key: this.key, error: String(error) });
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise === null) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const factory = this.idb;
        if (factory === null) {
          reject(new Error("indexeddb unavailable"));
          return;
        }
        const request = factory.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
        request.onblocked = () => reject(new Error("indexeddb open blocked"));
      });
    }
    return this.dbPromise;
  }

  private request<T>(
    tx: IDBTransaction,
    run: (store: IDBObjectStore) => IDBRequest<unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = run(tx.objectStore(this.storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
    });
  }
}

function resolveIDB(): IDBFactory | null {
  return typeof indexedDB !== "undefined" ? indexedDB : null;
}
