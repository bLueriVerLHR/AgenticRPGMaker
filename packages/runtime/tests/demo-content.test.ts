/**
 * Demo world content validation (ADR-008 §3.5, S5a).
 *
 * Reads the generator's committed output and asserts the golden-path story
 * invariants: a full 3×3 grid, spawn in the village, the story's NPCs and
 * interactions in the right chunks, combatants wired to the story switches,
 * and an intro that opens with a CG and ends cleanly. Every document is
 * re-validated against the core schemas (generator is a checked-in artifact).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseMapDocument,
  parseTilesetDocument,
  parseWorldDocument,
  type WorldData,
} from "@agenticrpg/core";

const PUBLIC_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../world-demo/public",
);
const DATA = path.join(PUBLIC_DIR, "data");

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(DATA, rel), "utf8"));
}

describe("The Crossroads demo world", () => {
  const world: WorldData = parseWorldDocument(readJson("world.json"));
  const chunkOf = (id: string) => {
    const map = parseMapDocument(readJson(`chunks/${id}.json`));
    expect(map.id).toBe(`map_${id}`);
    return map;
  };
  const village = chunkOf("ch_village");
  const fortress = chunkOf("ch_fortress");

  it("is a full 3×3 grid with the spawn in the village", () => {
    expect(world.grid).toEqual({ cols: 3, rows: 3 });
    expect(world.chunks).toHaveLength(9);
    expect(world.spawn.chunkId).toBe("ch_village");
    expect(world.spawn.direction).toBe("down");
  });

  it("has 64×64 maps with ground + collider layers", () => {
    for (const chunk of world.chunks) {
      const map = chunkOf(chunk.id);
      expect(map.width).toBe(64);
      expect(map.height).toBe(64);
      expect(map.layers.map((l) => l.id)).toEqual(["ground", "colliders"]);
    }
  });

  it("village has the story NPCs, a signpost, and a chest", () => {
    const ids = village.events.map((e) => e.id);
    expect(ids).toContain("evt_elder");
    expect(ids).toContain("evt_smith");
    expect(ids).toContain("evt_kid");
    expect(ids).toContain("evt_sign");
    expect(ids).toContain("evt_chest");
    const chest = village.events.find((e) => e.id === "evt_chest")!;
    expect(chest.pages).toHaveLength(2); // gold-on-first-open + empty follow-up
    expect(chest.pages[0]!.commands.some((c) => c.cmd === "setVariable")).toBe(true);
  });

  it("wilds spawns two slimes that set sw_wilds_cleared when beaten", () => {
    const chunk = world.chunks.find((c) => c.id === "ch_wilds")!;
    expect(chunk.combatants).toHaveLength(2);
    for (const combatant of chunk.combatants) {
      expect(combatant.type).toBe("slime");
      expect(combatant.onDefeatSwitch).toBe("sw_wilds_cleared");
    }
  });

  it("fortress guards the gate and the boss unlocks the ending beacon", () => {
    const ids = fortress.events.map((e) => e.id);
    expect(ids).toContain("evt_guard");
    expect(ids).toContain("evt_beacon");
    const guard = fortress.events.find((e) => e.id === "evt_guard")!;
    expect(guard.pages[0]!.condition?.switchId).toBe("sw_wilds_cleared");
    const beacon = fortress.events.find((e) => e.id === "evt_beacon")!;
    expect(beacon.pages[0]!.condition?.switchId).toBe("sw_boss_defeated");
    const beaconCommands = beacon.pages[0]!.commands;
    expect(beaconCommands[0]!.cmd).toBe("bgm");
    expect(
      beaconCommands.some((c) => c.cmd === "showCg" && c.args[0] === "img/cg/ending.svg"),
    ).toBe(true);
    expect(beaconCommands.some((c) => c.cmd === "endCg")).toBe(true);

    const chunk = world.chunks.find((c) => c.id === "ch_fortress")!;
    expect(chunk.combatants).toHaveLength(1);
    expect(chunk.combatants[0]!.type).toBe("turret");
    expect(chunk.combatants[0]!.onDefeatSwitch).toBe("sw_boss_defeated");
  });

  it("the intro opens with the opening CG and closes with endCg", () => {
    expect(world.intro.length).toBeGreaterThan(0);
    const cmds = world.intro.map((c) => c.cmd);
    expect(cmds).toContain("showCg");
    expect(cmds).toContain("endCg");
    expect(world.intro[1]!.cmd).toBe("fadeOut");
  });

  it("the shared placeholder tileset is valid", () => {
    const tileset = parseTilesetDocument(readJson("tilesets/placeholder.tileset.json"));
    expect(tileset.id).toBe("tilesets/placeholder");
    expect(tileset.columns).toBe(8);
    expect(tileset.rows).toBe(8);
  });
});
