/**
 * MapScene integration tests (Q6 / P1c DoD).
 *
 * Headless: a stub renderer + injected Input drive the scene with no DOM.
 * Covers: scene enter/exit, grid movement, wall collision (bus `collide`),
 * NPC blocking, dialogue triggering the core event interpreter
 * (showText/setSwitch/setVariable), dialogue advance/close, and save/load
 * round-trips against a MemoryStorage.
 */
import { describe, expect, it } from "vitest";
import {
  EventInterpreter,
  GameState,
  SceneGraph,
  TypedEventBus,
  type GameEventBus,
  type MapData,
} from "@agenticrpg/core";
import type { GameEventMap } from "@agenticrpg/core";

import { Input } from "../src/input.js";
import { MapScene } from "../src/map-scene.js";
import { MemoryStorage } from "../src/storage.js";
import { createNoopLogger } from "../src/logger.js";
import { fixtureMap, saveFixture, StubRenderer, stubCanvas } from "./helpers.js";

interface Harness {
  scene: MapScene;
  bus: GameEventBus;
  state: GameState;
  input: Input;
  storage: MemoryStorage;
  map: MapData;
  walks: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  collides: Array<{ otherId: string; blocked: boolean }>;
  dialogues: string[];
}

function buildHarness(options: { playerX?: number; playerY?: number } = {}): Harness {
  const map = fixtureMap();
  const bus: GameEventBus = new TypedEventBus<GameEventMap>();
  const state = new GameState({ variables: map.variables, switches: map.switches }, bus);
  const sceneGraph = SceneGraph.fromMap(map, {
    playerPosition: { x: options.playerX ?? 1, y: options.playerY ?? 2 },
    playerDirection: "down",
  });
  const interpreter = new EventInterpreter({ state, bus, scene: sceneGraph });
  const storage = new MemoryStorage();
  const input = new Input({ keyboard: false, virtualControls: false });
  const scene = new MapScene({
    map,
    renderer: new StubRenderer(),
    canvas: stubCanvas(),
    bus,
    state,
    sceneGraph,
    interpreter,
    storage,
    logger: createNoopLogger(),
    input,
    autoLoad: false,
  });
  const walks: Harness["walks"] = [];
  const collides: Harness["collides"] = [];
  const dialogues: string[] = [];
  bus.on("walk", (e) => walks.push({ from: e.from, to: e.to }));
  bus.on("collide", (e) => collides.push({ otherId: e.otherId, blocked: e.blocked }));
  bus.on("dialogue", (e) => dialogues.push(e.text));
  scene.enter({ bus, state, logger: createNoopLogger() });
  return { scene, bus, state, input, storage, map, walks, collides, dialogues };
}

function waitForStep(scene: MapScene, dt = 0.2): void {
  // 0.15s per step; step well past completion.
  scene.update(dt);
  scene.update(dt);
}

describe("MapScene enter/exit", () => {
  it("enters and exits cleanly", () => {
    const { scene } = buildHarness();
    expect(scene.playerPosition).toEqual({ x: 1, y: 2 });
    scene.exit();
    // exit is idempotent
    scene.exit();
  });

  it("renders through the stub renderer", () => {
    const { scene } = buildHarness();
    scene.render(1);
    scene.exit();
  });
});

describe("MapScene movement + collision", () => {
  it("walks a grid step when a direction is pressed", () => {
    const { scene, input, walks } = buildHarness();
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");
    expect(scene.playerPosition).toEqual({ x: 2, y: 2 });
    expect(scene.playerDirection).toBe("right");
    expect(walks).toHaveLength(1);
    expect(walks[0]).toEqual({ from: { x: 1, y: 2 }, to: { x: 2, y: 2 } });
  });

  it("stops at a solid wall and emits a blocked collide (Q6)", () => {
    const { scene, input, collides } = buildHarness();
    // The wall is at row y=4, columns 3..10.
    input.pressDirection("down");
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 1, y: 3 });
    // Next step down hits the wall row.
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 1, y: 3 });
    input.releaseDirection("down");
    expect(collides.some((c) => c.blocked && c.otherId === "map")).toBe(true);
  });

  it("cannot walk off the map boundary", () => {
    const { scene, input } = buildHarness({ playerX: 0, playerY: 1 });
    // Left from column 0 → out of bounds → blocked.
    input.pressDirection("left");
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 0, y: 1 });
    // Up from row 1 → row 0 is in bounds and free → moves.
    input.releaseDirection("left");
    input.pressDirection("up");
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 0, y: 0 });
    // Up from row 0 → out of bounds → blocked.
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 0, y: 0 });
    input.releaseDirection("up");
  });

  it("is blocked by a solid NPC (collide with the NPC entity)", () => {
    const { scene, input, collides } = buildHarness();
    // Player starts at (1,2); the innkeeper is at (6,2). Walk right 4 → (5,2).
    for (let i = 0; i < 5; i++) {
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    }
    expect(scene.playerPosition).toEqual({ x: 5, y: 2 });
    // One more right is blocked by the NPC.
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");
    expect(scene.playerPosition).toEqual({ x: 5, y: 2 });
    expect(collides.some((c) => c.otherId === "evt_innkeeper" && c.blocked)).toBe(true);
  });
});

describe("MapScene dialogue (interpreter integration)", () => {
  it("runs the active event page and queues dialogue", () => {
    const { scene, input, dialogues, state } = buildHarness();
    // Walk to (5,2), face right at the innkeeper at (6,2).
    for (let i = 0; i < 4; i++) {
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    }
    // Blocked step faces right (no move).
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");
    expect(scene.playerDirection).toBe("right");

    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(true);
    expect(scene.currentDialogueText).toBe("Hello, traveler!");
    expect(dialogues).toContain("Hello, traveler!");
    // The default page sets the switch and then the second page is selected.
    expect(state.getSwitch("sw_met_innkeeper")).toBe(true);
  });

  it("advances and closes the dialogue with confirm", () => {
    const { scene, input } = buildHarness();
    for (let i = 0; i < 4; i++) {
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    }
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");

    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(true);
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(false);
  });

  it("selects the switch-gated page on the second interaction", () => {
    const { scene, input, dialogues } = buildHarness();
    const faceNpc = (): void => {
      for (let i = 0; i < 4; i++) {
        input.pressDirection("right");
        waitForStep(scene);
        input.releaseDirection("right");
      }
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    };
    faceNpc();
    input.queueConfirm();
    scene.update(0.016);
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.currentDialogueText).toBeNull();

    // Second interaction: sw_met_innkeeper is now true → "Welcome back!" page.
    faceNpc();
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.currentDialogueText).toBe("Welcome back!");
    expect(dialogues).toContain("Welcome back!");
  });

  it("does nothing when confirming with no NPC in front", () => {
    const { scene, input } = buildHarness();
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(false);
  });
});

describe("MapScene save/load", () => {
  it("save() writes the core save schema and load() restores state", async () => {
    const { scene, input, storage, state } = buildHarness();
    // Move to (3,2), flip a switch via dialogue, then save.
    for (let i = 0; i < 2; i++) {
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    }
    expect(scene.playerPosition).toEqual({ x: 3, y: 2 });
    state.setSwitch("sw_met_innkeeper", true);
    state.setVariable("gold", 42);

    const ok = await scene.save();
    expect(ok).toBe(true);
    const stored = await storage.load();
    expect(stored?.mapId).toBe("map_fixture");
    expect(stored?.player).toEqual({ x: 3, y: 2, direction: "right" });
    expect(stored?.variables).toEqual({ gold: 42 });
    expect(stored?.switches).toEqual({ sw_met_innkeeper: true });
  });

  it("load() applies a saved position and variable/switch state", async () => {
    const { scene, storage } = buildHarness();
    await storage.save(saveFixture({ player: { x: 7, y: 3, direction: "left" } }));
    const ok = await scene.load();
    expect(ok).toBe(true);
    expect(scene.playerPosition).toEqual({ x: 7, y: 3 });
    expect(scene.playerDirection).toBe("left");
    expect(scene.state.getVariable("gold")).toBe(10);
    expect(scene.state.getSwitch("sw_met_innkeeper")).toBe(true);
  });

  it("load() ignores a save for a different map", async () => {
    const { scene, storage } = buildHarness();
    await storage.save(saveFixture({ mapId: "map_other" }));
    const ok = await scene.load();
    expect(ok).toBe(false);
    expect(scene.playerPosition).toEqual({ x: 1, y: 2 });
  });
});

describe("MapScene remote players (network hook)", () => {
  it("renders remote players without crashing when network is null", () => {
    const { scene } = buildHarness();
    expect(() => scene.render(1)).not.toThrow();
  });
});
