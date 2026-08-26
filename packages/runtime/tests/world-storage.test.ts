/**
 * WorldStorage tests (ADR-008 §7, S3c).
 *
 * Save-v2 round trips through the memory backend; the IndexedDB backend
 * persists through fake-indexeddb, loads back, warns-nulls on corrupt date,
 * and degrades to unavailable with `idb: null`.
 */
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { SaveDataV2 } from "@agenticrpg/core";
import { IndexedDBWorldStorage, MemoryWorldStorage } from "../src/world-storage.js";
import { createNoopLogger } from "../src/logger.js";

function saveFixture(overrides: Partial<SaveDataV2> = {}): SaveDataV2 {
  return {
    schemaVersion: 2,
    savedAt: "2026-08-26T12:00:00.000Z",
    worldId: "world_test",
    player: { chunkId: "c00", x: 4, y: 5, direction: "down", hp: 3 },
    variables: { gold: 42 },
    switches: { sw_a: true },
    chunkState: { c00: { defeatedIds: ["en_1"] } },
    ...overrides,
  };
}

describe("MemoryWorldStorage", () => {
  it("round-trips a save v2 document", async () => {
    const storage = new MemoryWorldStorage();
    expect(storage.available).toBe(true);
    expect(await storage.load()).toBeNull();
    await storage.save(saveFixture());
    const loaded = await storage.load();
    expect(loaded).toEqual(saveFixture());
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it("returns independent copies (mutating the caller cannot corrupt storage)", async () => {
    const storage = new MemoryWorldStorage();
    const save = saveFixture();
    await storage.save(save);
    save.variables.gold = 0;
    const loaded = await storage.load();
    expect(loaded?.variables.gold).toBe(42);
    loaded!.variables.gold = 7;
    expect((await storage.load())?.variables.gold).toBe(42);
  });
});

describe("IndexedDBWorldStorage", () => {
  it("persists and loads through fake-indexeddb in a dedicated store", async () => {
    const storage = new IndexedDBWorldStorage({
      dbName: "test-world-saves",
      logger: createNoopLogger(),
    });
    expect(storage.available).toBe(true);
    await storage.save(saveFixture());
    const loaded = await storage.load();
    expect(loaded?.worldId).toBe("world_test");
    expect(loaded?.chunkState["c00"]?.defeatedIds).toEqual(["en_1"]);
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it("warns and returns null on a corrupt document", async () => {
    const storage = new IndexedDBWorldStorage({
      dbName: "test-world-corrupt",
      logger: createNoopLogger(),
    });
    const corrupt = saveFixture({ schemaVersion: 99 as never });
    // Bypass the typed save path: write garbage straight into the store.
    await (storage as unknown as { save(data: unknown): Promise<void> }).save(corrupt);
    expect(await storage.load()).toBeNull();
  });

  it("degrades to unavailable when constructed with idb null", async () => {
    const storage = new IndexedDBWorldStorage({
      idb: null,
      logger: createNoopLogger(),
    });
    expect(storage.available).toBe(false);
    await storage.save(saveFixture());
    expect(await storage.load()).toBeNull();
    await storage.clear();
  });
});
