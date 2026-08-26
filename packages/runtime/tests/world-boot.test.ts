/**
 * Boot world-mode tests (ADR-008 §4/§5, S3c part 2).
 *
 * Exercises the world branch of `boot()`: an inline manifest with a fake
 * chunk loader, a URL manifest with injected fetch, and the default title
 * flow (title screen → press → WorldScene). The renderer/storage are
 * injected so the tests run entirely outside a browser.
 */
import { describe, expect, it } from "vitest";

import type { MapData, WorldData } from "@agenticrpg/core";

import { boot } from "../src/boot.js";
import type { ChunkLoader } from "../src/chunk-store.js";
import { MemoryWorldStorage } from "../src/world-storage.js";
import { createNoopLogger } from "../src/logger.js";
import { StubRenderer, stubCanvas } from "./helpers.js";

const SIZE = 4;

function makeChunkMap(id: string): MapData {
  const data: number[][] = [];
  for (let row = 0; row < SIZE; row++) {
    data.push(new Array<number>(SIZE).fill(0));
  }
  return {
    schemaVersion: 1,
    id: `map_${id}`,
    name: id,
    tileSize: 8,
    width: SIZE,
    height: SIZE,
    tileset: "tilesets/placeholder",
    layers: [{ id: "ground", name: "Ground", type: "tile", opacity: 1, visible: true, data }],
    events: [],
    variables: {},
    switches: {},
  };
}

function makeWorld(): WorldData {
  return {
    schemaVersion: 1,
    id: "world_boot",
    name: "Boot World",
    chunkSize: SIZE,
    grid: { cols: 1, rows: 1 },
    chunks: [{ id: "c_0_0", file: "data/chunks/c_0_0.json", col: 0, row: 0 }],
    combatTypes: {},
    spawn: { chunkId: "c_0_0", x: 2, y: 2, direction: "down" },
    tilesets: ["tilesets/placeholder"],
    global: { variables: {}, switches: {} },
    intro: [],
  };
}

function makeLoader(): ChunkLoader {
  const maps = new Map<string, MapData>([["c_0_0", makeChunkMap("c_0_0")]]);
  return {
    load(chunk) {
      const map = maps.get(chunk.id);
      return map === undefined
        ? Promise.reject(new Error(`no fixture map ${chunk.id}`))
        : Promise.resolve(map);
    },
  };
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("boot() world mode", () => {
  it("boots a WorldGame from an inline manifest (no title)", async () => {
    const game = await boot({
      canvas: stubCanvas(),
      root: null as unknown as HTMLElement,
      worldData: makeWorld(),
      chunkLoader: makeLoader(),
      worldStorage: new MemoryWorldStorage(),
      renderer: new StubRenderer(),
      logger: createNoopLogger(),
      worldTitle: false,
      audio: null,
      autoLoad: false,
    });
    expect(game.sceneManager.current?.id).toBe("world");
    await waitUntil(() => game.scene.isReady, "world ready");
    expect(game.scene.playerPosition).toEqual({ x: 2, y: 2 });
    expect(game.chunkStore.residentIds()).toContain("c_0_0");
    game.dispose();
  });

  it("boots from a world JSON url over the injected fetch", async () => {
    const world = makeWorld();
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(".json")) {
        const source = String(url).includes("world.json") ? world : makeChunkMap("c_0_0");
        return {
          ok: true,
          status: 200,
          json: async () => source,
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as unknown as typeof fetch;
    const game = await boot({
      canvas: stubCanvas(),
      root: null as unknown as HTMLElement,
      worldUrl: "data/world.json",
      worldStorage: new MemoryWorldStorage(),
      renderer: new StubRenderer(),
      logger: createNoopLogger(),
      worldTitle: false,
      audio: null,
      chunkWorkerFactory: null, // main-thread parse, worker-free tests
      autoLoad: false,
      fetchImpl,
    });
    await waitUntil(() => game.scene.isReady, "world ready");
    expect(game.sceneManager.current?.id).toBe("world");
    expect(game.scene.playerPosition).toEqual({ x: 2, y: 2 });
    game.dispose();
  });

  it("defaults to a title screen, and pressing it lands in the world", async () => {
    const game = await boot({
      canvas: stubCanvas(),
      root: null as unknown as HTMLElement,
      worldData: makeWorld(),
      chunkLoader: makeLoader(),
      worldStorage: new MemoryWorldStorage(),
      renderer: new StubRenderer(),
      logger: createNoopLogger(),
      audio: null,
      autoLoad: false,
    });
    expect(game.sceneManager.current?.id).toBe("title");
    const title = game.sceneManager.current as unknown as { press: () => void };
    title.press();
    expect(game.sceneManager.current?.id).toBe("world");
    await waitUntil(() => game.scene.isReady, "world ready");
    game.dispose();
  });
});
