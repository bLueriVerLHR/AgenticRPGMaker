/**
 * CombatSystem tests (ADR-009 §5, S4).
 *
 * Pure system behavior with fake deps (no WorldScene): spawn/despawn,
 * dx-first chasing, wall blocking, contact damage, sword hits + cooldown +
 * defeat persistence, turret range gating + projectile travel/wall stop, and
 * defeated-callback firing.
 */
import { describe, expect, it } from "vitest";

import type { SceneGraph, Vec2, WorldData } from "@agenticrpg/core";
import { SceneGraph as SceneGraphClass } from "@agenticrpg/core";

import { CombatSystem, type CombatSystemDeps } from "../src/world-combat.js";
import type { InputDirection } from "../src/input.js";

function makeWorld(): WorldData {
  return {
    schemaVersion: 1,
    id: "world_combat",
    name: "Combat World",
    chunkSize: 8,
    grid: { cols: 2, rows: 2 },
    chunks: [
      {
        id: "c_0_0",
        file: "a.json",
        col: 0,
        row: 0,
        combatants: [
          { id: "slimeA", type: "slime", x: 2, y: 2 },
          { id: "slimeB", type: "slime", x: 5, y: 5 },
          { id: "turretT", type: "turret", x: 0, y: 4 },
        ],
      },
      { id: "c_0_1", file: "b.json", col: 0, row: 1 },
      { id: "c_1_0", file: "c.json", col: 1, row: 0 },
      { id: "c_1_1", file: "d.json", col: 1, row: 1 },
    ],
    combatTypes: {
      slime: { hp: 2, damage: 1, behavior: "chase", speed: 1 },
      turret: { hp: 3, damage: 1, behavior: "turret", speed: 0 },
    },
    spawn: { chunkId: "c_0_0", x: 1, y: 1, direction: "down" },
    tilesets: ["t"],
    global: { variables: {}, switches: {} },
    intro: [],
  };
}

interface Harness {
  system: CombatSystem;
  graph: SceneGraph;
  player: Vec2;
  direction: InputDirection;
  damages: number[];
  defeated: Array<[string, string]>;
  sfxRefs: string[];
  blocked: Set<string>;
}

function makeHarness(): Harness {
  const graph = new SceneGraphClass();
  const player = { x: 1, y: 1 };
  let direction: InputDirection = "right";
  const damages: number[] = [];
  const defeated: Array<[string, string]> = [];
  const sfxRefs: string[] = [];
  const blocked = new Set<string>();
  const deps: CombatSystemDeps = {
    world: makeWorld(),
    sceneGraph: graph as unknown as SceneGraph,
    playerTile: () => ({ ...player }),
    playerDirection: () => direction,
    isTileBlocked: (tile) => blocked.has(`${tile.x},${tile.y}`),
    applyDamageToPlayer: (amount) => damages.push(amount),
    onCombatantDefeated: (chunkId, combatantId) => defeated.push([chunkId, combatantId]),
    sfx: (ref) => sfxRefs.push(ref),
  };
  const system = new CombatSystem(deps);
  return {
    system,
    graph,
    get player() {
      return player;
    },
    set player(p: Vec2) {
      player.x = p.x;
      player.y = p.y;
    },
    get direction() {
      return direction;
    },
    set direction(d: InputDirection) {
      direction = d;
    },
    damages,
    defeated,
    sfxRefs,
    blocked,
  };
}

describe("CombatSystem", () => {
  it("spawns chunk combatants as entities and despawns them on eviction", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    expect(h.system.views()).toHaveLength(3);
    expect(h.graph.getEntityById("combatant:c_0_0:slimeA")).not.toBeNull();

    h.system.despawnForChunk("c_0_0");
    expect(h.system.views()).toHaveLength(0);
    expect(h.graph.getEntityById("combatant:c_0_0:slimeA")).toBeNull();
  });

  it("chases along the dominant axis (dx-first)", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.player = { x: 4, y: 4 };
    h.system.update(1.0); // slime A (2,2) speed 1 → one step
    const a = h.system.views().find((c) => c.docId === "slimeA");
    expect(a).toMatchObject({ x: 3, y: 2 }); // dx preferred
  });

  it("stays put when boxed in by walls", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.blocked.add("3,2");
    h.blocked.add("2,3");
    h.player = { x: 4, y: 4 };
    h.system.update(2.0);
    const a = h.system.views().find((c) => c.docId === "slimeA");
    expect(a).toMatchObject({ x: 2, y: 2 });
  });

  it("idles beyond its aggro range (leash), then chases when approached", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    // slimeA (2,2) speed 1; player far away (aggro default 8, chebyshev 9).
    h.player = { x: 11, y: 2 };
    h.system.update(5.0);
    expect(h.system.views().find((c) => c.docId === "slimeA")).toMatchObject({ x: 2, y: 2 });
    // Bring the player within range → it chases now.
    h.player = { x: 9, y: 2 }; // chebyshev 7 ≤ 8
    h.system.update(1.0);
    expect(h.system.views().find((c) => c.docId === "slimeA")).toMatchObject({ x: 3, y: 2 });
  });

  it("deals contact damage when stepping into the player's tile", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.player = { x: 2, y: 4 };
    // slimeA at (2,2): 4,0 → wait; reposition the player below it.
    h.system.update(1.0); // → (2,3)
    h.system.update(1.0); // step target (2,4) = player → contact
    expect(h.damages).toEqual([1]);
  });

  it("sword: hits, respects the cooldown, and defeats (defeated callback)", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    // Stand above slimeB (5,5) and face it.
    h.player = { x: 5, y: 4 };
    h.direction = "down";
    expect(h.system.attack()).toBe(true); // hit
    const b = h.system.views().find((c) => c.docId === "slimeB");
    expect(b?.hp).toBe(1);
    expect(h.system.attack()).toBe(false); // cooldown blocks the second swing
    h.system.update(0.4);
    expect(h.system.attack()).toBe(true); // kill
    expect(h.system.views().find((c) => c.docId === "slimeB")).toBeUndefined();
    expect(h.defeated).toContainEqual(["c_0_0", "slimeB"]);
    expect(h.sfxRefs).toContain("defeated");
  });

  it("turret: fires at a player in range and the projectile damages", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.player = { x: 0, y: 6 }; // same column below the turret (0,4), far from both slimes
    h.system.update(2.5); // first fire happens at the interval boundary
    expect(h.damages).toEqual([1]); // one projectile crossed 2 tiles in one tick
  });

  it("turret: does not fire out of range", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.player = { x: 20, y: 10 }; // far beyond PROJECTILE_MAX_TILES
    h.system.update(10);
    expect(h.damages).toHaveLength(0);
  });

  it("projectiles die on solid tiles", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.blocked.add("3,4"); // wall between turret and a far player
    h.player = { x: 7, y: 4 }; // same row, at distance 7 ≤ 8, clear of the slimes
    h.system.update(2.5);
    expect(h.damages).toHaveLength(0); // stopped at the wall before reaching (7,4)
    expect(h.system.projectiles()).toHaveLength(0);
  });

  it("clear() removes every combatant entity", () => {
    const h = makeHarness();
    h.system.spawnForChunk("c_0_0");
    h.system.clear();
    expect(h.system.views()).toHaveLength(0);
    expect(h.graph.getEntityById("combatant:c_0_0:slimeA")).toBeNull();
  });
});
