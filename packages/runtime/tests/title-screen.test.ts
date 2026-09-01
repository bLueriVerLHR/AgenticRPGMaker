/**
 * Title screen + continue + autosave tests (task 21).
 *
 * Headless (Node): the title handle is driven programmatically via
 * `choose()` — the DOM overlay itself is exercised by the browser E2E suites.
 * Covers: the default-off contract, fresh-start vs continue, same-map and
 * cross-map restore through the loader seam, and the transfer autosave that
 * gives Continue something meaningful to restore.
 */
import { describe, expect, it } from "vitest";

import { boot } from "../src/boot.js";
import { MemoryStorage } from "../src/storage.js";
import { createNoopLogger } from "../src/logger.js";
import { emptyMap, fixtureMap, saveFixture, StubRenderer, stubCanvas } from "./helpers.js";

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

describe("title screen (task 21)", () => {
  it("is off by default: no title handle, game started immediately", async () => {
    const game = await boot(bootOptions());
    expect(game.title).toBeNull();
    expect(game.sceneManager.current).not.toBeNull();
    game.dispose();
  });

  it("with titleScreen: the game waits on the title; continue with no save is refused", async () => {
    const game = await boot(bootOptions({ titleScreen: true }));
    expect(game.title).not.toBeNull();
    expect(game.title?.visible).toBe(true);
    expect(game.sceneManager.current).toBeNull(); // not started yet

    expect(await game.title?.choose("continue")).toBe(false);
    expect(game.title?.visible).toBe(true); // still up — nothing began
    expect(game.sceneManager.current).toBeNull();

    expect(await game.title?.choose("new")).toBe(true);
    expect(game.title?.visible).toBe(false);
    expect(game.sceneManager.current).not.toBeNull();
    game.dispose();
  });

  it("New Game starts fresh even when a save exists", async () => {
    const storage = new MemoryStorage();
    await storage.save(saveFixture({ player: { x: 3, y: 2, direction: "right" } }));
    const game = await boot(bootOptions({ titleScreen: true, storage }));
    await game.title?.choose("new");
    expect(game.scene.playerPosition).toEqual({ x: 1, y: 2 }); // option, not save
    expect(game.state.snapshot().variables.gold).toBe(0); // fresh state
    game.dispose();
  });

  it("Continue restores a same-map save (position, direction, variables)", async () => {
    const storage = new MemoryStorage();
    await storage.save(saveFixture({ player: { x: 3, y: 2, direction: "right" } }));
    const game = await boot(bootOptions({ titleScreen: true, storage }));
    expect(await game.title?.choose("continue")).toBe(true);
    expect(game.scene.playerPosition).toEqual({ x: 3, y: 2 });
    expect(game.state.snapshot().variables.gold).toBe(10);
    expect(game.title?.visible).toBe(false);
    game.dispose();
  });

  it("Continue enters the saved map when the save is cross-map", async () => {
    const storage = new MemoryStorage();
    await storage.save(
      saveFixture({ mapId: "map_empty", player: { x: 5, y: 4, direction: "up" } }),
    );
    const game = await boot(
      bootOptions({
        titleScreen: true,
        storage,
        loadMap: async () => emptyMap(),
      }),
    );
    expect(await game.title?.choose("continue")).toBe(true);
    // The playable scene swapped to the saved map and the save applied there.
    expect(game.scene.playerPosition).toEqual({ x: 5, y: 4 });
    await game.save();
    expect((await storage.load())?.mapId).toBe("map_empty");
    game.dispose();
  });

  it("dispose() makes further choices inert", async () => {
    const game = await boot(bootOptions({ titleScreen: true }));
    game.title?.dispose();
    expect(await game.title?.choose("new")).toBe(false);
    expect(game.title?.visible).toBe(false);
    game.dispose();
  });

  it("transfer autosaves: the save follows the player across maps", async () => {
    const storage = new MemoryStorage();
    const game = await boot(bootOptions({ storage, loadMap: async () => emptyMap() }));
    game.bus.emit("transfer", { mapId: "map_empty", x: 4, y: 5, direction: "up" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(game.scene.playerPosition).toEqual({ x: 4, y: 5 });
    const saved = await storage.load();
    expect(saved?.mapId).toBe("map_empty");
    expect(saved?.player).toEqual({ x: 4, y: 5, direction: "up" });
    game.dispose();
  });
});
