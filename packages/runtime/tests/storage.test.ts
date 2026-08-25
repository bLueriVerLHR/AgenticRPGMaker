/**
 * Storage adapter tests (RQ1/D12; docs/08-compatibility-checklist.md §4.7).
 *
 * The IndexedDB adapter is exercised against `fake-indexeddb` — the storage
 * logic is the real code path, only the IndexedDB engine is faked. Also covers
 * graceful degradation when IndexedDB is unavailable.
 */
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { IndexedDBStorage, isIndexedDBAvailable } from "../src/indexeddb-storage.js";
import { MemoryStorage } from "../src/storage.js";
import { createNoopLogger } from "../src/logger.js";
import { saveFixture } from "./helpers.js";

describe("MemoryStorage", () => {
  it("round-trips a save document", async () => {
    const storage = new MemoryStorage();
    expect(storage.available).toBe(true);
    expect(await storage.load()).toBeNull();
    await storage.save(saveFixture());
    const loaded = await storage.load();
    expect(loaded?.player).toEqual({ x: 3, y: 2, direction: "right" });
    expect(loaded?.variables).toEqual({ gold: 10 });
    expect(loaded?.switches).toEqual({ sw_met_innkeeper: true });
  });

  it("clear() removes the document", async () => {
    const storage = new MemoryStorage();
    await storage.save(saveFixture());
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });
});

describe("IndexedDBStorage (fake-indexeddb)", () => {
  it("reports availability under fake-indexeddb", () => {
    expect(isIndexedDBAvailable()).toBe(true);
  });

  it("round-trips a save document through IndexedDB", async () => {
    const storage = new IndexedDBStorage({
      dbName: "test-saves",
      key: "slot1",
      logger: createNoopLogger(),
    });
    expect(storage.available).toBe(true);
    expect(await storage.load()).toBeNull();
    await storage.save(saveFixture());
    const loaded = await storage.load();
    expect(loaded?.mapId).toBe("map_fixture");
    expect(loaded?.player.x).toBe(3);
    expect(loaded?.variables).toEqual({ gold: 10 });
    expect(loaded?.switches).toEqual({ sw_met_innkeeper: true });
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it("keeps slots separate", async () => {
    const a = new IndexedDBStorage({
      dbName: "test-saves",
      key: "slotA",
      logger: createNoopLogger(),
    });
    const b = new IndexedDBStorage({
      dbName: "test-saves",
      key: "slotB",
      logger: createNoopLogger(),
    });
    await a.save(saveFixture({ player: { x: 1, y: 1, direction: "up" } }));
    expect((await b.load())?.player.x).toBeUndefined();
    expect((await a.load())?.player.x).toBe(1);
  });

  it("returns null for a corrupt or unknown-version document instead of crashing", async () => {
    const storage = new IndexedDBStorage({ dbName: "test-corrupt", logger: createNoopLogger() });
    // Write garbage directly into the store.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("test-corrupt", 1);
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains("saves")) {
          d.createObjectStore("saves");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put({ not: "a save" }, "default");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });
});

describe("IndexedDBStorage (unavailable environment)", () => {
  it("degrades gracefully: save no-ops, load returns null, no crash", async () => {
    // Passing idb: null forces the "IndexedDB unavailable" path (private mode,
    // some WebViews) without touching the global.
    const storage = new IndexedDBStorage({ idb: null, logger: createNoopLogger() });
    expect(storage.available).toBe(false);
    await expect(storage.save(saveFixture())).resolves.toBeUndefined();
    await expect(storage.load()).resolves.toBeNull();
    await expect(storage.clear()).resolves.toBeUndefined();
  });
});
