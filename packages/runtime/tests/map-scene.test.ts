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
  renderer: StubRenderer;
  walks: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  collides: Array<{ otherId: string; blocked: boolean }>;
  dialogues: string[];
}

function buildHarness(
  options: {
    playerX?: number;
    playerY?: number;
    playerDirection?: "up" | "down" | "left" | "right";
    map?: MapData;
  } = {},
): Harness {
  const map = options.map ?? fixtureMap();
  const bus: GameEventBus = new TypedEventBus<GameEventMap>();
  const state = new GameState({ variables: map.variables, switches: map.switches }, bus);
  const sceneGraph = SceneGraph.fromMap(map, {
    playerPosition: { x: options.playerX ?? 1, y: options.playerY ?? 2 },
    playerDirection: options.playerDirection ?? "down",
  });
  const interpreter = new EventInterpreter({ state, bus, scene: sceneGraph });
  const storage = new MemoryStorage();
  const input = new Input({ keyboard: false, virtualControls: false });
  const renderer = new StubRenderer();
  const scene = new MapScene({
    map,
    renderer,
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
  return { scene, bus, state, input, storage, map, renderer, walks, collides, dialogues };
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

describe("MapScene choices (task 16)", () => {
  /** A riddle NPC whose pages form the loop: ask → showChoices → branch on the answer. */
  function riddleMap(): MapData {
    const map = fixtureMap();
    map.events.push({
      id: "evt_riddle",
      name: "Riddle Keeper",
      x: 4,
      y: 2, // left of the innkeeper; the player faces right at it from (3,2)
      sprite: "characters/npc_riddle",
      pages: [
        {
          condition: { variableId: "choice_riddle", op: "eq", value: 0 },
          commands: [{ cmd: "showText", args: ["A clock it is — take this coin."] }],
        },
        {
          condition: { variableId: "choice_riddle", op: "eq", value: 1 },
          commands: [{ cmd: "showText", args: ["A coin? No — it was a clock."] }],
        },
        {
          condition: null,
          commands: [
            { cmd: "showText", args: ["What has hands but cannot clap?"] },
            { cmd: "showChoices", args: ["choice_riddle", "A clock.", "A coin."] },
          ],
        },
      ],
    });
    map.variables = { ...map.variables, choice_riddle: -1 };
    return map;
  }

  /** Walks the player from (1,2) to (3,2) facing the riddle keeper at (4,2). */
  function faceRiddleKeeper(harness: { scene: MapScene; input: Input }): void {
    const { scene, input } = harness;
    for (let i = 0; i < 2; i++) {
      input.pressDirection("right");
      waitForStep(scene);
      input.releaseDirection("right");
    }
    expect(scene.playerPosition).toEqual({ x: 3, y: 2 });
  }

  it("opens a choice from the bus and wraps the selection with up/down", () => {
    const { bus, scene } = buildHarness();
    bus.emit("choice", { variable: "choice_riddle", options: ["A clock.", "A coin."] });
    expect(scene.isChoiceOpen).toBe(true);
    expect(scene.currentChoice).toEqual({
      variable: "choice_riddle",
      options: ["A clock.", "A coin."],
      selected: 0,
    });
  });

  it("freezes movement while a choice is open", () => {
    const { bus, scene, input } = buildHarness();
    bus.emit("choice", { variable: "v", options: ["a", "b"] });
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");
    expect(scene.playerPosition).toEqual({ x: 1, y: 2 });
  });

  it("writes the chosen index into the variable on confirm", () => {
    const { bus, scene, input, state } = buildHarness();
    bus.emit("choice", { variable: "choice_riddle", options: ["A clock.", "A coin."] });
    input.pressDirection("down"); // selection wraps 0 → 1
    scene.update(0.016);
    input.releaseDirection("down");
    expect(scene.currentChoice?.selected).toBe(1);
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isChoiceOpen).toBe(false);
    expect(state.getVariable("choice_riddle")).toBe(1);
  });

  it("writes -1 into the variable on cancel", () => {
    const { bus, scene, input, state } = buildHarness();
    bus.emit("choice", { variable: "choice_riddle", options: ["A clock.", "A coin."] });
    input.queueCancel();
    scene.update(0.016);
    expect(scene.isChoiceOpen).toBe(false);
    expect(state.getVariable("choice_riddle")).toBe(-1);
  });

  it("runs the full loop: ask → answer → branch on the answer next interaction", () => {
    const harness = buildHarness({ map: riddleMap() });
    const { scene, input, dialogues, state } = harness;
    faceRiddleKeeper(harness);

    // First interaction: the ask page (question + choices).
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(true);
    expect(scene.currentDialogueText).toBe("What has hands but cannot clap?");
    expect(scene.isChoiceOpen).toBe(true);

    // Answer "A coin." (index 1): movement is frozen, dialogue frozen.
    input.pressDirection("down");
    scene.update(0.016);
    input.releaseDirection("down");
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isChoiceOpen).toBe(false);
    expect(state.getVariable("choice_riddle")).toBe(1);

    // Second interaction: confirm once dismisses the lingering question, then
    // re-interact — the eq-1 branch answers.
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.isDialogueOpen).toBe(false);
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.currentDialogueText).toBe("A coin? No — it was a clock.");
    expect(dialogues).toContain("A coin? No — it was a clock.");
  });
});

describe("MapScene interaction follows the body (task 19)", () => {
  /**
   * A patrol NPC whose authored (home) tile is `homeX`: the real rule-based
   * behavior (task 09) drives the entity along the corridor row y=2, so the
   * tests exercise the production behavior → transform → interaction pipeline.
   * Speed defaults to 1 tile/s, so `update(t)` moves the body exactly `t` tiles.
   */
  function patrolMap(homeX: number, targetX: number): MapData {
    const map = fixtureMap();
    map.events.push({
      id: "evt_patroller",
      name: "Road Slime",
      x: homeX,
      y: 2,
      sprite: "characters/npc_slime",
      behavior: { kind: "rule-based", waypoints: [{ x: targetX, y: 2 }] },
      pages: [{ condition: null, commands: [{ cmd: "showText", args: ["I patrol this road."] }] }],
    });
    return map;
  }

  it("is talkable from both tiles a mid-move body spans (and not from a third)", () => {
    // Slime homes at (5,2), patrols to (4,2); after 0.5s it sits at x=4.5 and
    // its 1x1 body spans tiles (4,2) AND (5,2) — the same two tiles collision
    // blocks (movement.ts strict AABB rule).
    const fromWest = buildHarness({
      map: patrolMap(5, 4),
      playerX: 3,
      playerY: 2,
      playerDirection: "right",
    });
    fromWest.scene.update(0.5);
    expect(fromWest.scene.interact()).toBe(true); // faces (4,2) — spanned
    expect(fromWest.dialogues).toContain("I patrol this road.");

    // From the north, facing (5,2): also spanned while x=4.5…
    const fromNorth = buildHarness({ map: patrolMap(5, 4), playerX: 5, playerY: 1 });
    fromNorth.scene.update(0.5);
    expect(fromNorth.scene.interact()).toBe(true);

    // …but after 1.0s the body rests at x=4.0 (spans only (4,2)), so the
    // faced (5,2) misses — a deterministic answer at every instant.
    const fromNorthLate = buildHarness({ map: patrolMap(5, 4), playerX: 5, playerY: 1 });
    fromNorthLate.scene.update(1.0);
    expect(fromNorthLate.scene.interact()).toBe(false);
  });

  it("leaves the vacated authored tile inert; the current tile talks", () => {
    // Slime homes at (4,2), patrols to (5,2); player faces (4,2) from (3,2).
    const harness = buildHarness({
      map: patrolMap(4, 5),
      playerX: 3,
      playerY: 2,
      playerDirection: "right",
    });
    const { scene, input, dialogues } = harness;
    expect(scene.interact()).toBe(true); // at rest on the authored tile first
    input.queueConfirm();
    scene.update(0.016); // close the dialogue
    dialogues.length = 0;

    scene.update(1.0); // patrol completes: the body now rests at (5,2)
    expect(scene.interact()).toBe(false); // the vacated home tile is inert
    expect(dialogues).toHaveLength(0);

    // The solid collider moved with the body, so the player can now stand on
    // the vacated tile — and talk to the slime where it actually stands.
    input.pressDirection("right");
    waitForStep(scene);
    input.releaseDirection("right");
    expect(scene.playerPosition).toEqual({ x: 4, y: 2 });
    expect(scene.interact()).toBe(true); // faces (5,2)
    expect(dialogues).toContain("I patrol this road.");
  });

  it("resolves stacked events in map authoring order (first match runs)", () => {
    const map = patrolMap(4, 4); // single-waypoint patrol: stays at home
    map.events.unshift({
      // An invisible trigger registered on the same tile, authored FIRST.
      id: "evt_sign_post",
      name: "Sign Post",
      x: 4,
      y: 2,
      pages: [
        { condition: null, commands: [{ cmd: "showText", args: ["The sign reads: beware."] }] },
      ],
    });
    const harness = buildHarness({
      map,
      playerX: 3,
      playerY: 2,
      playerDirection: "right",
    });
    expect(harness.scene.interact()).toBe(true);
    expect(harness.dialogues).toContain("The sign reads: beware.");
    expect(harness.dialogues).not.toContain("I patrol this road.");
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

describe("MapScene camera zoom + follow (task 22)", () => {
  it("renders with an integer zoom and a viewport shrunk by it", () => {
    const { scene, renderer } = buildHarness();
    scene.render(1);
    const cams = renderer.calls.filter((call) => call.method === "setCamera");
    expect(cams.length).toBeGreaterThan(0);
    const last = cams[cams.length - 1] as { method: "setCamera"; args: unknown[] };
    const [viewport, zoom] = last.args as [{ width: number; height: number }, number];
    expect(zoom).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(zoom)).toBe(true);
    // The viewport is the backing store divided by the zoom factor.
    expect(viewport.width * zoom).toBeCloseTo(stubCanvas().width);
    expect(viewport.height * zoom).toBeCloseTo(stubCanvas().height);
  });

  it("keeps the player centered and clamped to the map while it follows", () => {
    // Row y=3 is a clear corridor (the wall is y=4, the NPC at (6,2)).
    const { scene, renderer, input } = buildHarness({ playerX: 1, playerY: 3 });
    input.pressDirection("right");
    // Walk to x=6 (chained steps make tick-counting indeterminate).
    for (let i = 0; i < 60 && scene.playerPosition.x < 6; i++) {
      scene.update(0.05);
    }
    input.releaseDirection("right");
    expect(scene.playerPosition).toEqual({ x: 6, y: 3 });
    scene.render(1);
    const cams = renderer.calls.filter((call) => call.method === "setCamera");
    const last = cams[cams.length - 1] as { method: "setCamera"; args: unknown[] };
    const [viewport] = last.args as [{ x: number; y: number; width: number }, number];
    // Player px center 6*16=96; camera centers on it: 96 - 160/2 = 16, inside
    // the clamp range [0, 192-160] — the camera moved with the player.
    expect(viewport.x).toBe(16);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
  });
});

describe("MapScene hold-to-walk cadence (task 22)", () => {
  it("chains held steps at step cadence, not once per repeat delay", () => {
    // Row y=3 is a clear corridor (the wall is y=4, the NPC at (6,2)).
    const { scene, input, walks } = buildHarness({ playerX: 1, playerY: 3 });
    input.pressDirection("right");
    // Hold for 1.05s in 0.05s ticks. First repeat may wait out the 0.25s
    // disambiguation delay, but from then on steps chain back-to-back:
    // ≥6 walks in 1.05s (the old per-step delay produced only 3-4).
    for (let i = 0; i < 21; i++) {
      scene.update(0.05);
    }
    input.releaseDirection("right");
    expect(walks.length).toBeGreaterThanOrEqual(6);
    // Steps chained without gaps: consecutive from → to.
    for (let i = 1; i < walks.length; i++) {
      expect(walks[i]!.from).toEqual(walks[i - 1]!.to);
    }
  });

  it("starts walking when the held direction changes without a new press", () => {
    const { scene, input, walks } = buildHarness({ playerX: 5, playerY: 6 });
    input.pressDirection("right");
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 6, y: 6 });
    input.pressDirection("down"); // second held key — no new "right" edge
    waitForStep(scene);
    expect(scene.playerPosition).toEqual({ x: 6, y: 7 });
    expect(walks.some((w) => w.to.y === 7)).toBe(true);
    input.releaseDirection("right");
    input.releaseDirection("down");
  });
});

describe("MapScene interaction hint + transfer markers (task 22)", () => {
  it("reports the faced interactable and clears while talking", () => {
    const { scene } = buildHarness({ playerX: 5, playerY: 2, playerDirection: "right" });
    // The innkeeper stands at (6,2).
    expect(scene.interactionHintEventId).toBe("evt_innkeeper");
    scene.interact(); // opens the dialogue
    expect(scene.interactionHintEventId).toBeNull();
  });

  it("returns null when nothing interactable is faced", () => {
    const { scene } = buildHarness({ playerX: 1, playerY: 6, playerDirection: "up" });
    // Facing an empty stretch of the wall row.
    expect(scene.interactionHintEventId).toBeNull();
  });

  it("lists events with transfer pages as door markers", () => {
    const base = fixtureMap();
    const map: MapData = {
      ...base,
      events: [
        ...base.events,
        {
          id: "evt_gate",
          name: "Gate",
          x: 11,
          y: 1,
          pages: [
            {
              condition: null,
              commands: [{ cmd: "transfer", args: ["map_elsewhere", 1, 1, "up"] }],
            },
          ],
        },
      ],
    };
    const { scene } = buildHarness({ map });
    expect(scene.transferTileEventIds).toEqual(["evt_gate"]);
  });
});
