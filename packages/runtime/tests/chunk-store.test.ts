/**
 * Chunk store tests (ADR-008 §4, S3c).
 *
 * Residency policy over a fake loader on a 4×4 world (chunk size 8):
 * prefetch-radius-1 windows load per cell move, evict-radius-2 drops far
 * chunks, in-flight loads deduplicate, failed loads are retried on the next
 * sync and never reject the sync, and the loaded/evicted callbacks fire.
 */
import { describe, expect, it } from "vitest";

import type { MapData, WorldData } from "@agenticrpg/core";

import { ChunkStore, type ChunkLoader } from "../src/chunk-store.js";
import { createNoopLogger } from "../src/logger.js";

const CHUNK_SIZE = 8;

function makeWorld(): WorldData {
  const chunks = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      chunks.push({
        id: `c_${col}_${row}`,
        file: `data/chunks/c_${col}_${row}.json`,
        col,
        row,
      });
    }
  }
  return {
    schemaVersion: 1,
    id: "world_test",
    name: "Test World",
    chunkSize: CHUNK_SIZE,
    grid: { cols: 4, rows: 4 },
    chunks,
    combatTypes: {},
    spawn: { chunkId: "c_0_0", x: 1, y: 1, direction: "down" },
    tilesets: ["tilesets/placeholder"],
    global: { variables: {}, switches: {} },
    intro: [],
  };
}

function makeChunkMap(id: string): MapData {
  const data: number[][] = [];
  for (let row = 0; row < CHUNK_SIZE; row++) {
    data.push(new Array<number>(CHUNK_SIZE).fill(0));
  }
  return {
    schemaVersion: 1,
    id: `map_${id}`,
    name: id,
    tileSize: 8,
    width: CHUNK_SIZE,
    height: CHUNK_SIZE,
    tileset: "tilesets/placeholder",
    layers: [{ id: "ground", name: "Ground", type: "tile", opacity: 1, visible: true, data }],
    events: [],
    variables: {},
    switches: {},
  };
}

interface FakeLoader extends ChunkLoader {
  loadCounts: Map<string, number>;
  failOnce: Set<string>;
}

function makeLoader(): FakeLoader {
  return {
    loadCounts: new Map(),
    failOnce: new Set(),
    load(chunk) {
      this.loadCounts.set(chunk.id, (this.loadCounts.get(chunk.id) ?? 0) + 1);
      if (this.failOnce.has(chunk.id)) {
        this.failOnce.delete(chunk.id);
        return Promise.reject(new Error(`load failed ${chunk.id}`));
      }
      return Promise.resolve(makeChunkMap(chunk.id));
    },
  };
}

function makeStore(loader: FakeLoader, overrides: Record<string, unknown> = {}) {
  const loaded: string[] = [];
  const evicted: string[] = [];
  const store = new ChunkStore({
    world: makeWorld(),
    loader,
    logger: createNoopLogger(),
    ...overrides,
  });
  store.onLoaded = (id) => loaded.push(id);
  store.onEvicted = (id) => evicted.push(id);
  return { store, loaded, evicted };
}

describe("ChunkStore residency", () => {
  it("prefetches the 3×3 window around the player cell", async () => {
    const loader = makeLoader();
    const { store, loaded } = makeStore(loader);
    await store.updateTo({ col: 1, row: 1 });

    expect(store.residentIds()).toHaveLength(9);
    expect(loaded).toHaveLength(9);
    for (let row = 0; row <= 2; row++) {
      for (let col = 0; col <= 2; col++) {
        expect(store.getChunk(`c_${col}_${row}`)).not.toBeNull();
      }
    }
    expect(store.mapAtCell({ col: 0, row: 0 })?.id).toBe("map_c_0_0");
    expect(store.mapAtCell({ col: 3, row: 3 })).toBeNull(); // outside window
  });

  it("evicts chunks beyond the evict radius while keeping the near ring", async () => {
    const loader = makeLoader();
    const { store, evicted } = makeStore(loader);
    await store.updateTo({ col: 1, row: 1 });
    await store.updateTo({ col: 3, row: 3 });

    expect(loader.loadCounts.get("c_3_3")).toBe(1);
    // Beyond Chebyshev distance 2 from (3,3): (0,0) (dist 3) gone,
    // distant (2,0) (dist 3) gone, near (1,2) (dist 2) kept.
    expect(store.getChunk("c_0_0")).toBeNull();
    expect(store.getChunk("c_2_0")).toBeNull();
    expect(store.getChunk("c_1_2")).not.toBeNull();
    // 9 from the first window + 3 newly loaded − 5 evicted = 7 resident.
    expect(store.residentIds()).toHaveLength(7);
    expect(evicted).toContain("c_0_0");
    expect(evicted).toContain("c_2_0");
    expect(loader.loadCounts.size).toBe(12);
  });

  it("deduplicates in-flight loads (wanted ids load exactly once)", async () => {
    const loader = makeLoader();
    const { store } = makeStore(loader);
    const first = store.updateTo({ col: 2, row: 2 });
    const second = store.updateTo({ col: 2, row: 2 });
    await Promise.all([first, second]);
    for (const count of loader.loadCounts.values()) {
      expect(count).toBe(1); // no chunk fetched twice
    }
    expect(loader.loadCounts.size).toBe(9);
  });

  it("retries a failed chunk on the next sync and never rejects the sync", async () => {
    const loader = makeLoader();
    loader.failOnce.add("c_1_1");
    const { store } = makeStore(loader);
    await expect(store.updateTo({ col: 1, row: 1 })).resolves.toBeUndefined();
    expect(store.getChunk("c_1_1")).toBeNull();

    await store.updateTo({ col: 1, row: 1 });
    expect(store.getChunk("c_1_1")).not.toBeNull();
    expect(loader.loadCounts.get("c_1_1")).toBe(2);
  });

  it("computes the player's chunk cell from global coordinates", () => {
    const { store } = makeStore(makeLoader());
    expect(store.cellOf(16, 9)).toEqual({ col: 2, row: 1 }); // chunkSize 8
  });
});
