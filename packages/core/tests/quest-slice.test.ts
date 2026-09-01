/**
 * Vertical-slice quest data test (task 18, D24): "The Lost Shipment" ships as
 * pure data, so its integrity must be proven at the data level. Parses the
 * three quest maps + project against the schemas and asserts the quest's
 * structural invariants: the transfer graph is closed over the shipped maps,
 * every condition references a declared switch/variable, and the
 * find → reward switch chain exists.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseMapDocument, parseProjectDocument, type MapData } from "../src/index.js";

const QUEST_DIR = new URL("../../../samples/", import.meta.url);

function loadJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, QUEST_DIR), "utf8")) as unknown;
}

const QUEST_MAPS = [
  "maps/quest-village.map.json",
  "maps/quest-forest.map.json",
  "maps/quest-cave.map.json",
] as const;

const QUEST_IDS = new Set(["map_quest_village", "map_quest_forest", "map_quest_cave"]);

function loadQuestMaps(): MapData[] {
  return QUEST_MAPS.map((file) => parseMapDocument(loadJson(file)));
}

describe("vertical-slice quest data (task 18)", () => {
  it("parses all three quest maps and the project against the schemas", () => {
    const maps = loadQuestMaps();
    expect(maps.map((m) => m.id)).toEqual([
      "map_quest_village",
      "map_quest_forest",
      "map_quest_cave",
    ]);
    const project = parseProjectDocument(loadJson("projects/lost-shipment.project.json"));
    expect(project.settings.initialMap).toBe("map_quest_village");
    for (const id of project.assets.maps) {
      expect(QUEST_IDS.has(id)).toBe(true);
    }
  });

  it("closes the transfer graph: every transfer target is a shipped quest map", () => {
    for (const map of loadQuestMaps()) {
      for (const event of map.events) {
        for (const page of event.pages) {
          for (const line of page.commands) {
            if (line.cmd === "transfer") {
              expect(QUEST_IDS.has(String(line.args[0]))).toBe(true);
            }
          }
        }
      }
    }
  });

  it("references only declared switches/variables in conditions, sets, and choices", () => {
    const maps = loadQuestMaps();
    const declaredSwitches = new Set(maps.flatMap((m) => Object.keys(m.switches)));
    const declaredVariables = new Set(maps.flatMap((m) => Object.keys(m.variables)));
    for (const map of maps) {
      for (const event of map.events) {
        for (const page of event.pages) {
          const condition = page.condition;
          if (condition !== null && "switchId" in condition) {
            expect(declaredSwitches.has(condition.switchId)).toBe(true);
          }
          if (condition !== null && "variableId" in condition) {
            expect(declaredVariables.has(condition.variableId)).toBe(true);
          }
          for (const line of page.commands) {
            if (line.cmd === "setSwitch") {
              expect(declaredSwitches.has(String(line.args[0]))).toBe(true);
            }
            if (line.cmd === "setVariable") {
              expect(declaredVariables.has(String(line.args[0]))).toBe(true);
            }
            if (line.cmd === "showChoices") {
              expect(declaredVariables.has(String(line.args[0]))).toBe(true);
            }
          }
        }
      }
    }
  });

  it("chains the win condition: cave crate sets sw_crate_found, village elder rewards once", () => {
    const [village, , cave] = loadQuestMaps();
    const crate = cave.events.find((event) => event.id === "evt_crate");
    expect(crate).toBeDefined();
    const findPage = crate?.pages.find((page) =>
      page.commands.some((line) => line.cmd === "setSwitch" && line.args[0] === "sw_crate_found"),
    );
    expect(findPage).toBeDefined();

    const elder = village.events.find((event) => event.id === "evt_elder");
    const rewardPage = elder?.pages.find((page) =>
      page.commands.some(
        (line) => line.cmd === "setVariable" && line.args[0] === "gold" && line.args[2] === 25,
      ),
    );
    expect(rewardPage?.condition).toEqual({ switchId: "sw_crate_found", value: true });
    // Reward-once: a later page consumes sw_quest_done so the +25 gold runs once.
    const donePage = elder?.pages.find((page) =>
      page.commands.some((line) => line.cmd === "setSwitch" && line.args[0] === "sw_quest_done"),
    );
    expect(donePage).toBeDefined();
    const elderOrder = elder?.pages.map((page) => page.condition) ?? [];
    expect(elderOrder[0]).toEqual({ switchId: "sw_quest_done", value: true });
    expect(elderOrder[1]).toEqual({ switchId: "sw_crate_found", value: true });
  });
});
