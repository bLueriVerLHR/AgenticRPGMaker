/**
 * IndexedDB storage adapter (P1c, RQ1 / docs/08-compatibility-checklist.md §4.7).
 *
 * Saves live in IndexedDB (portable, offline-capable). The adapter is the
 * browser path of the Storage seam; the database name, object store, and slot
 * key are configurable (a future C++ local-file adapter slots into the same
 * `Storage` interface).
 *
 * Graceful degradation (compat checklist §4.7 / §3.2): when IndexedDB is
 * unavailable (private mode, some WebViews, tests without an IDB factory) or
 * a request fails or the stored document is corrupt, the adapter **warns and
 * never crashes** — `load()` returns null, `save()` is a no-op.
 */
import { parseSaveDocument } from "@agenticrpg/core";
import type { SaveData } from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import type { Storage } from "./storage.js";

export interface IndexedDBStorageOptions {
  /** IndexedDB database name. Default "agenticrpg-saves". */
  dbName?: string;
  /** Object store name. Default "saves". */
  storeName?: string;
  /** Slot key inside the store. Default "default". */
  key?: string;
  /**
   * Injectable IDB factory (fake-indexeddb in tests). Pass `null` to force
   * "unavailable" behavior. Defaults to the global `indexedDB`.
   */
  idb?: IDBFactory | null;
  logger?: Logger;
}

/** Default IndexedDB database name. */
export const DEFAULT_INDEXEDDB_DB = "agenticrpg-saves";
/** Default object store name. */
export const DEFAULT_INDEXEDDB_STORE = "saves";
/** Default slot key. */
export const DEFAULT_INDEXEDDB_KEY = "default";

function resolveIDB(idb: IDBFactory | null | undefined): IDBFactory | null {
  if (idb !== undefined) {
    return idb;
  }
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  return null;
}

/** True when IndexedDB exists in the current environment. */
export function isIndexedDBAvailable(): boolean {
  return resolveIDB(undefined) !== null;
}

/**
 * IndexedDB-backed `Storage`. Each instance addresses one slot; multiple slots
 * (multiple saves / projects) are separate instances.
 */
export class IndexedDBStorage implements Storage {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private readonly idb: IDBFactory | null;
  private readonly logger: Logger;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBStorageOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_INDEXEDDB_DB;
    this.storeName = options.storeName ?? DEFAULT_INDEXEDDB_STORE;
    this.key = options.key ?? DEFAULT_INDEXEDDB_KEY;
    this.idb = resolveIDB(options.idb);
    this.logger = options.logger ?? createNoopLogger();
  }

  /** Whether IndexedDB is present (may still fail at open time). */
  get available(): boolean {
    return this.idb !== null;
  }

  async save(data: SaveData): Promise<void> {
    if (this.idb === null) {
      this.logger.warn("indexeddb storage: unavailable, save skipped", { key: this.key });
      return;
    }
    try {
      const db = await this.open();
      await this.request<void>(
        db.transaction(this.storeName, "readwrite"),
        (store) => store.put(data, this.key) as unknown as IDBRequest<unknown>,
      );
      this.logger.debug("indexeddb storage: saved", { key: this.key, mapId: data.mapId });
    } catch (error) {
      this.logger.warn("indexeddb storage: save failed", { key: this.key, error: String(error) });
    }
  }

  async load(): Promise<SaveData | null> {
    if (this.idb === null) {
      this.logger.warn("indexeddb storage: unavailable, load returned null", { key: this.key });
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
      // Fail fast on corrupt/unknown-version saves, then warn, never crash.
      const parsed = parseSaveDocument(raw);
      this.logger.debug("indexeddb storage: loaded", { key: this.key, mapId: parsed.mapId });
      return parsed;
    } catch (error) {
      this.logger.warn("indexeddb storage: load failed or corrupt save", {
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
      this.logger.debug("indexeddb storage: cleared", { key: this.key });
    } catch (error) {
      this.logger.warn("indexeddb storage: clear failed", { key: this.key, error: String(error) });
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
