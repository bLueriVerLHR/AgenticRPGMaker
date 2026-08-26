/**
 * WorldScene tests (ADR-008 §4 / ADR-010 §3, S3c part 2).
 *
 * Behavioral coverage on a 2×2×8-tile world with an injected input and a fake
 * chunk loader: startup readiness + entity wiring, cross-boundary stepping,
 * world-edge blocking, NPC-occupancy blocking + adjacent-tile dialogue,
 * save-v2 round-trip, and the intro CG handoff (plays once, switch-gated).
 */
import { describe, expect, it } from "vitest";

import type { MapData, WorldData } from "@agenticrpg/core";
import {
  Collider,
  EventInterpreter,
  GameObject,
  GameState,
  PLAYER_ENTITY_ID,
  SceneGraph,
  Sprite,
  Transform,
  TypedEventBus,
  type GameEventMap,
  type MapEvent,
} from "@agenticrpg/core";

import type { CgScript } from "../src/cg.js";
import type { ChunkLoader } from "../src/chunk-store.js";
import { ChunkStore } from "../src/chunk-store.js";
import { Input } from "../src/input.js";
import { createNoopLogger } from "../src/logger.js";
import { MemoryWorldStorage } from "../src/world-storage.js";
import { WorldScene } from "../src/world-scene.js";
import { StubRenderer, stubCanvas } from "./helpers.js";

const SIZE = 8; // chunk edge in tiles

function makeChunkMap(id: string, solids: Array<[number, number]> = []): MapData {
  const ground: number[][] = [];
  const colliders: number[][] = [];
  for (let row = 0; row < SIZE; row++) {
    ground.push(new Array<number>(SIZE).fill(1));
    colliders.push(new Array<number>(SIZE).fill(0));
  }
  for (const [x, y] of solids) {
    colliders[y]![x] = 1;
  }
  return {
    schemaVersion: 1,
    id: `map_${id}`,
    name: id,
    tileSize: 8,
    width: SIZE,
    height: SIZE,
    tileset: "tilesets/placeholder",
    layers: [
      { id: "ground", name: "Ground", type: "tile", opacity: 1, visible: true, data: ground },
      {
        id: "colliders",
        name: "Colliders",
        type: "tile",
        opacity: 1,
        visible: false,
        data: colliders,
      },
    ],
    events: [],
    variables: {},
    switches: {},
  };
}

function makeMapWithEvents(
  id: string,
  events: MapEvent[],
  solids: Array<[number, number]> = [],
): MapData {
  const map = makeChunkMap(id, solids);
  map.events = events;
  return map;
}

function makeFixture(intro: WorldData["intro"] = []): {
  world: WorldData;
  loader: ChunkLoader & { calls: Set<string> };
} {
  const calls = new Set<string>();
  const maps = new Map<string, MapData>([
    [
      "c_0_0",
      makeMapWithEvents("c_0_0", [
        {
          id: "evt_guide",
          name: "Guide",
          x: 3,
          y: 2,
          sprite: "characters/guide",
          pages: [{ condition: null, commands: [{ cmd: "showText", args: ["Follow me."] }] }],
        },
      ]),
    ],
    ["c_0_1", makeChunkMap("c_0_1")],
    ["c_1_0", makeChunkMap("c_1_0")],
    ["c_1_1", makeChunkMap("c_1_1", [[2, 3]])],
  ]);
  const world: WorldData = {
    schemaVersion: 1,
    id: "world_fixture",
    name: "Fixture World",
    chunkSize: SIZE,
    grid: { cols: 2, rows: 2 },
    chunks: [
      {
        id: "c_0_0",
        file: "data/chunks/c_0_0.json",
        col: 0,
        row: 0,
        combatants: [
          { id: "slime_atk", type: "slime", x: 4, y: 3 },
          { id: "turret_doom", type: "turret", x: 2, y: 5 },
          { id: "chaser", type: "slime_fast", x: 2, y: 6 },
        ],
      },
      { id: "c_0_1", file: "data/chunks/c_0_1.json", col: 0, row: 1 },
      { id: "c_1_0", file: "data/chunks/c_1_0.json", col: 1, row: 0 },
      { id: "c_1_1", file: "data/chunks/c_1_1.json", col: 1, row: 1 },
    ],
    combatTypes: {
      slime: { hp: 2, damage: 1, behavior: "chase", speed: 0.1 },
      slime_fast: { hp: 2, damage: 1, behavior: "chase", speed: 1.2 },
      turret: { hp: 3, damage: 1, behavior: "turret", speed: 0 },
    },
    spawn: { chunkId: "c_0_0", x: 2, y: 2, direction: "down" },
    tilesets: ["tilesets/placeholder"],
    global: { variables: {}, switches: {} },
    intro,
  };
  const loader: ChunkLoader & { calls: Set<string> } = {
    calls,
    load(chunk) {
      calls.add(chunk.id);
      const map = maps.get(chunk.id);
      return map === undefined
        ? Promise.reject(new Error(`no fixture map ${chunk.id}`))
        : Promise.resolve(map);
    },
  };
  return { world, loader };
}

function buildPlayerGraph(world: WorldData): SceneGraph {
  const graph = new SceneGraph();
  const player = new GameObject({ id: PLAYER_ENTITY_ID, name: "Player", layer: 1 });
  player.addComponent(
    new Transform({
      x: world.spawn.x,
      y: world.spawn.y,
      direction: world.spawn.direction,
    }),
  );
  player.addComponent(new Sprite({ texture: "characters/player" }));
  player.addComponent(
    new Collider({
      shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
      solid: true,
    }),
  );
  graph.addEntity(player);
  return graph;
}

interface Harness {
  scene: WorldScene;
  input: Input;
  storage: MemoryWorldStorage;
  openedCg: CgScript[];
  state: GameState;
  graph: SceneGraph;
  bus: TypedEventBus<GameEventMap>;
}

function makeHarness(
  overrides: {
    intro?: WorldData["intro"];
    spawn?: { x: number; y: number };
  } = {},
): Harness {
  const fixture = makeFixture(overrides.intro ?? []);
  if (overrides.spawn !== undefined) {
    fixture.world.spawn = {
      chunkId: fixture.world.spawn.chunkId,
      ...overrides.spawn,
      direction: "down",
    };
  }
  const bus = new TypedEventBus<GameEventMap>();
  const state = new GameState(fixture.world.global, bus);
  const graph = buildPlayerGraph(fixture.world);
  const input = new Input({ keyboard: false, virtualControls: false });
  const store = new ChunkStore({
    world: fixture.world,
    loader: fixture.loader,
    logger: createNoopLogger(),
  });
  const storage = new MemoryWorldStorage();
  const openedCg: CgScript[] = [];
  const scene = new WorldScene({
    world: fixture.world,
    chunkStore: store,
    sceneGraph: graph,
    renderer: new StubRenderer(),
    canvas: stubCanvas(),
    bus,
    state,
    interpreter: new EventInterpreter({ state, bus, scene: graph }),
    storage,
    logger: createNoopLogger(),
    input,
    autoLoad: false,
    onOpenCg: (script) => openedCg.push(script),
  });
  return { scene, input, storage, openedCg, state, graph, bus };
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

/** One committed tile step: press + two frames (step duration 0.15s). */
function step(scene: WorldScene, input: Input, direction: "up" | "down" | "left" | "right"): void {
  input.pressDirection(direction);
  scene.update(0.2);
  scene.update(0.2);
  input.releaseDirection(direction);
}

describe("WorldScene", () => {
  it("becomes ready after startup and wires chunk entities", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    expect(h.graph.getEntityById("c_0_0:evt_guide")).not.toBeNull();
    expect(h.scene.playerPosition).toEqual({ x: 2, y: 2 });
    // The guide entity sits at the chunk local (3,2) → global (3,2).
    const guide = h.graph.getEntityById("c_0_0:evt_guide");
    expect(guide?.getComponent("transform")?.x).toBe(3);
    expect(guide?.getComponent("transform")?.y).toBe(2);
    h.scene.exit();
  });

  it("steps across the chunk boundary seamlessly", async () => {
    const h = makeHarness({ spawn: { x: 7, y: 2 } });
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    step(h.scene, h.input, "right");
    expect(h.scene.playerPosition).toEqual({ x: 8, y: 2 }); // c_1_0 local (0,2)
    h.scene.exit();
  });

  it("blocks movement at the world edge", async () => {
    const h = makeHarness({ spawn: { x: 0, y: 0 } });
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    step(h.scene, h.input, "left");
    expect(h.scene.playerPosition).toEqual({ x: 0, y: 0 });
    h.scene.exit();
  });

  it("blocks stepping into an NPC and dialogues from the adjacent tile", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    // Guide at (3,2); player at (2,2) facing right after this step? It's blocked:
    // the step INTO (3,2) is blocked by the NPC, so the player stays at (2,2).
    const before = h.scene.playerPosition;
    step(h.scene, h.input, "right");
    expect(h.scene.playerPosition).toEqual(before); // occupied tile is solid
    // Facing is now "right" (set before the block check) → interact finds the guide.
    h.input.queueConfirm();
    h.scene.update(0.016);
    expect(h.scene.currentDialogueText).toBe("Follow me.");
    h.input.queueConfirm();
    h.scene.update(0.016);
    expect(h.scene.isDialogueOpen).toBe(false);
    h.scene.exit();
  });

  it("save/load round-trips position, gold and switches (save v2)", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    step(h.scene, h.input, "right"); // (3,2) occupied → stays (2,2); use (2,3) instead:
    step(h.scene, h.input, "down"); // (2,3)
    h.state.setVariable("gold", 99);
    h.state.setSwitch("sw_flag", true);
    expect(await h.scene.save()).toBe(true);

    step(h.scene, h.input, "up"); // back to (2,2)
    h.state.setVariable("gold", 0);
    expect(await h.scene.load()).toBe(true);
    expect(h.scene.playerPosition).toEqual({ x: 2, y: 3 });
    expect(h.state.getVariable("gold")).toBe(99);
    expect(h.state.getSwitch("sw_flag")).toBe(true);
    h.scene.exit();
  });

  it("plays the intro CG once (gate: sw_intro_done)", async () => {
    const h = makeHarness({
      intro: [
        { cmd: "bgm", args: ["title"] },
        { cmd: "setSwitch", args: ["sw_intro_done", true] },
        { cmd: "showCg", args: ["img/cg/opening.png"] },
      ],
    });
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    await waitUntil(() => h.openedCg.length > 0, "intro CG");
    expect(h.openedCg).toHaveLength(1);
    expect(h.openedCg[0]![0]).toEqual({ kind: "bgm", ref: "title" });
    expect(h.state.getSwitch("sw_intro_done")).toBe(true);

    h.scene.exit();
    h.openedCg.length = 0;
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    expect(h.openedCg).toHaveLength(0); // switch set → no replay
    h.scene.exit();
  });

  // ------------------------------------------------------------------
  // Combat integration (ADR-009, S4)
  // ------------------------------------------------------------------

  it("sword kills the slime (2 hits) and the defeated id reaches the save", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    step(h.scene, h.input, "down"); // (2,3)
    step(h.scene, h.input, "right"); // (3,3), facing right → slime at (4,3)
    h.input.queueConfirm();
    h.scene.update(0.016); // swing 1 → hit
    const alive = h.scene.combatSystem.views().find((c) => c.docId === "slime_atk");
    expect(alive?.hp).toBe(1);
    h.scene.update(0.4); // cooldown elapses (slime speed 0.1 → no contact)
    h.input.queueConfirm();
    h.scene.update(0.016); // swing 2 → kill + autosave
    expect(h.scene.combatSystem.views().find((c) => c.docId === "slime_atk")).toBeUndefined();

    const start = Date.now();
    let stored: Awaited<ReturnType<MemoryWorldStorage["load"]>> = null;
    while (Date.now() - start < 2000) {
      stored = await h.storage.load();
      if (stored?.chunkState["c_0_0"]?.defeatedIds.includes("slime_atk")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stored?.chunkState["c_0_0"]?.defeatedIds).toContain("slime_atk");
    h.scene.exit();
  });

  it("turret shots drain HP on deterministic ticks; death respawns at the spawn", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");

    h.scene.update(2.5); // fire 1 → hit (i-frames on)
    expect(h.scene.playerHp).toBe(2);
    h.scene.update(2.5); // i-frames decayed → fire 2 → hit
    expect(h.scene.playerHp).toBe(1);
    h.scene.update(2.5); // fire 3 → defeated
    expect(h.scene.isDead).toBe(true);
    h.scene.update(1.3); // death fade elapses → respawn
    expect(h.scene.isDead).toBe(false);
    expect(h.scene.playerHp).toBe(3);
    expect(h.scene.playerPosition).toEqual({ x: 2, y: 2 });
    h.scene.exit();
  });

  it("combat freezes while a dialogue box is open", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    step(h.scene, h.input, "right"); // blocked by the guide at (3,2), facing right
    h.input.queueConfirm();
    h.scene.update(0.016); // guide dialogue opens
    expect(h.scene.isDialogueOpen).toBe(true);
    h.scene.update(3.0); // would fire the turret / move the chaser — frozen
    expect(h.scene.playerHp).toBe(3);
    expect(h.scene.combatSystem.projectiles()).toHaveLength(0);
    h.input.queueConfirm();
    h.scene.update(0.016); // close dialogue
    expect(h.scene.isDialogueOpen).toBe(false);
    h.scene.exit();
  });

  it("Z talks when facing an NPC (no enemy: the sword does not fire)", async () => {
    const h = makeHarness();
    h.scene.enter({ bus: h.bus, state: h.state, logger: createNoopLogger() });
    await waitUntil(() => h.scene.isReady, "readiness");
    h.input.pressDirection("right");
    h.scene.update(0.016); // face the guide at (3,2) — occupied, so we stay at (2,2)
    h.input.releaseDirection("right");
    h.input.queueConfirm();
    h.scene.update(0.016); // no combatant at (3,2) → sword declines → interact runs
    expect(h.scene.isDialogueOpen).toBe(true);
    expect(h.scene.currentDialogueText).toBe("Follow me.");
    h.scene.exit();
  });
});
