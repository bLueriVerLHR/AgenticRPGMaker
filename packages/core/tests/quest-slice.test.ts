/**
 * Vertical-slice quest data test (tasks 18/20, D24): "The Lost Shipment"
 * ships as pure data, so its integrity must be proven at the data level.
 * Parses the four quest maps + project against the schemas and asserts the
 * quest's structural invariants: the transfer graph is closed over the
 * shipped maps, every condition references a declared switch/variable, the
 * find → reward switch chain exists, and the chapter-2 ladders (elder, Old
 * Pol, Mira) resolve each session state to exactly one page.
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
  "maps/quest-river.map.json",
] as const;

const QUEST_IDS = new Set([
  "map_quest_village",
  "map_quest_forest",
  "map_quest_cave",
  "map_quest_river",
]);

function loadQuestMaps(): MapData[] {
  return QUEST_MAPS.map((file) => parseMapDocument(loadJson(file)));
}

describe("vertical-slice quest data (tasks 18/20)", () => {
  it("parses all four quest maps and the project against the schemas", () => {
    const maps = loadQuestMaps();
    expect(maps.map((m) => m.id)).toEqual([
      "map_quest_village",
      "map_quest_forest",
      "map_quest_cave",
      "map_quest_river",
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
    // First-match ladder (task 20): the chapter-2 pages sit ABOVE the
    // chapter-1 pages so every session state resolves to exactly one page —
    // settled-thanks (by choice), in-progress, ch-2 hook, ch-1 reward, intro.
    const elderOrder = elder?.pages.map((page) => page.condition) ?? [];
    expect(elderOrder).toEqual([
      { variableId: "ferry_choice", op: "eq", value: 0 },
      { variableId: "ferry_choice", op: "eq", value: 1 },
      { switchId: "sw_ch2_started", value: true },
      { switchId: "sw_quest_done", value: true },
      { switchId: "sw_crate_found", value: true },
      null,
    ]);
    // The hook page starts chapter 2; both final pages close it.
    for (const index of [0, 1]) {
      const page = elder?.pages[index];
      expect(
        page?.commands.some((line) => line.cmd === "setSwitch" && line.args[0] === "sw_ch2_done"),
      ).toBe(true);
    }
    expect(
      elder?.pages[3]?.commands.some(
        (line) => line.cmd === "setSwitch" && line.args[0] === "sw_ch2_started",
      ),
    ).toBe(true);
  });

  it("guards chapter 2: Pol pays once, Mira sells once, the east gate is gated", () => {
    const [village, , , river] = loadQuestMaps();

    // Old Pol: the settled guard page must precede both payment pages so a
    // re-talk can never re-run a gold reward; the choice offer sits below
    // (ferry_choice < 0 only until an answer is recorded).
    const pol = river.events.find((event) => event.id === "evt_pol");
    expect(pol).toBeDefined();
    const polOrder = pol?.pages.map((page) => page.condition) ?? [];
    expect(polOrder).toEqual([
      { switchId: "sw_debt_settled", value: true },
      { variableId: "ferry_choice", op: "eq", value: 0 },
      { variableId: "ferry_choice", op: "eq", value: 1 },
      { variableId: "ferry_choice", op: "lt", value: 0 },
    ]);
    for (const index of [1, 2]) {
      expect(
        pol?.pages[index]?.commands.some(
          (line) => line.cmd === "setSwitch" && line.args[0] === "sw_debt_settled",
        ),
      ).toBe(true);
    }
    expect(
      pol?.pages[1]?.commands.some(
        (line) => line.cmd === "setVariable" && line.args[0] === "gold" && line.args[2] === 30,
      ),
    ).toBe(true);
    expect(
      pol?.pages[2]?.commands.some(
        (line) => line.cmd === "setVariable" && line.args[0] === "gold" && line.args[2] === 20,
      ),
    ).toBe(true);

    // Herbalist Mira: owned → purchase → offer (affordable) → too poor.
    const mira = village.events.find((event) => event.id === "evt_mira");
    expect(mira).toBeDefined();
    const miraOrder = mira?.pages.map((page) => page.condition) ?? [];
    expect(miraOrder).toEqual([
      { switchId: "sw_remedy", value: true },
      { variableId: "remedy_buy", op: "eq", value: 0 },
      { variableId: "gold", op: "gte", value: 10 },
      null,
    ]);
    expect(
      mira?.pages[1]?.commands.some(
        (line) => line.cmd === "setVariable" && line.args[0] === "gold" && line.args[2] === -10,
      ),
    ).toBe(true);

    // The east road transfers only after the chapter-2 hook fired.
    const eastGate = village.events.find((event) => event.id === "evt_village_east");
    expect(eastGate?.pages[0]?.condition).toEqual({ switchId: "sw_ch2_started", value: true });
    expect(
      eastGate?.pages[0]?.commands.some(
        (line) => line.cmd === "transfer" && line.args[0] === "map_quest_river",
      ),
    ).toBe(true);
    expect(eastGate?.pages[1]?.condition).toBeNull();
  });
});
