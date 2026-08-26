/**
 * Boot sequence + createGame integration tests (docs/06-architecture.md §3).
 *
 * Boots the runtime headlessly: a stub renderer is injected (the renderer
 * factory seam is stubbed as required for Node tests), the map is inline, and
 * a MemoryStorage backs saves. Verifies the §3 wiring: core init → renderer
 * → runtime boot → scene.enter → game loop (manual frames via tick).
 */
import { describe, expect, it } from "vitest";

import { boot } from "../src/boot.js";
import { createGame } from "../src/game.js";
import { MemoryStorage } from "../src/storage.js";
import { Input } from "../src/input.js";
import { createNoopLogger } from "../src/logger.js";
import { fixtureMap, StubRenderer, stubCanvas } from "./helpers.js";

function bootOptions(overrides: Record<string, unknown> = {}) {
  return {
    canvas: stubCanvas(),
    root: null as unknown as HTMLElement,
    mapData: fixtureMap(),
    renderer: new StubRenderer(),
    storage: new MemoryStorage(),
    logger: createNoopLogger(),
    autoLoad: false,
    playerPosition: { x: 1, y: 2 },
    ...overrides,
  };
}

describe("boot()", () => {
  it("resolves a started Game with the map scene entered", async () => {
    const game = await boot(bootOptions());
    expect(game.sceneManager.current?.id).toBe("map");
    expect(game.scene.playerPosition).toEqual({ x: 1, y: 2 });
    expect(game.sceneManager.current).toBe(game.scene);
    game.dispose();
  });

  it("boots fully single-player when no network URL is given", async () => {
    const game = await boot(bootOptions());
    expect(game.network).toBeNull();
    game.dispose();
  });

  it("rejects when neither mapUrl nor mapData is provided", async () => {
    const options = bootOptions();
    delete options.mapData;
    delete options.mapUrl;
    await expect(boot(options as never)).rejects.toThrow(/neither mapUrl nor mapData/);
  });

  it("loads the map from a URL via an injected fetch", async () => {
    const map = fixtureMap();
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => map,
    })) as unknown as typeof fetch;
    const game = await boot(bootOptions({ mapUrl: "data/map.json", fetchImpl }));
    expect(game.scene.map.id).toBe("map_fixture");
    game.dispose();
  });

  it("continues single-player when the network connect fails", async () => {
    const failingTransport = {
      connect: async () => {
        throw new Error("connect refused");
      },
      send: () => {},
      close: () => {},
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
    };
    const game = await boot(
      bootOptions({
        network: { url: "ws://127.0.0.1:1/ws", transport: failingTransport as never },
      }),
    );
    expect(game.network).not.toBeNull();
    expect(game.sceneManager.current?.id).toBe("map"); // still playable
    game.dispose();
  });

  it("keeps the receiver when reading the renderer backend (class-method getBackend)", async () => {
    // Real backends implement `getBackend()` as a prototype method that reads
    // `this.backend`. A detached call (`const f = r.getBackend; f()`) throws in
    // strict ESM — regression guard for the boot-time backend label.
    class BackendReportingRenderer extends StubRenderer {
      readonly backend = "webgl2";
      getBackend(): string {
        return this.backend;
      }
    }
    const game = await boot(bootOptions({ renderer: new BackendReportingRenderer() }));
    expect(game.sceneManager.current?.id).toBe("map");
    expect(game.scene.backendLabel).toBe("webgl2");
    game.dispose();
  });
});

describe("createGame()", () => {
  it("assembles a playable Game and drives manual frames", () => {
    const input = new Input({ keyboard: false, virtualControls: false });
    const game = createGame({
      canvas: stubCanvas(),
      map: fixtureMap(),
      renderer: new StubRenderer(),
      storage: new MemoryStorage(),
      logger: createNoopLogger(),
      input,
      autoLoad: false,
      playerPosition: { x: 1, y: 2 },
    });
    expect(game.sceneManager.current).toBeNull();
    game.start();
    expect(game.sceneManager.current?.id).toBe("map");
    expect(game.scene.playerPosition).toEqual({ x: 1, y: 2 });

    // Walk one step via a manual frame.
    input.pressDirection("right");
    game.tick(0.2);
    game.tick(0.2);
    input.releaseDirection("right");
    expect(game.scene.playerPosition).toEqual({ x: 2, y: 2 });

    game.stop();
    expect(game.loop.running).toBe(false);
    game.dispose();
  });
});
