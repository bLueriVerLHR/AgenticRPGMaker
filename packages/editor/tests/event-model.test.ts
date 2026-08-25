/**
 * Event model / command editor state tests (P2, ADR-006 §feature 3).
 *
 * The pure helpers behind the event-page command editor: adding/removing/
 * updating/moving commands, page conditions, and the visual command catalog
 * mapping to core `EventCommand` lines the interpreter runs.
 */
import { describe, expect, it } from "vitest";

import {
  addCommandToPage,
  moveCommandInPage,
  removeCommandFromPage,
  setPageCondition,
  updateCommandInPage,
} from "../src/model/map-ops.js";
import {
  COMMAND_CATALOG,
  commandDefFor,
  commandSummary,
  createCommand,
  createEvent,
  createPage,
} from "../src/model/event-model.js";

describe("command catalog", () => {
  it("covers the core interpreter command set", () => {
    const cmds = COMMAND_CATALOG.map((def) => def.cmd);
    for (const expected of ["showText", "setVariable", "setSwitch", "playSound", "walk", "move"]) {
      expect(cmds).toContain(expected);
    }
  });

  it("createCommand builds schema-valid lines with defaults", () => {
    const showText = createCommand("showText");
    expect(showText).toEqual({ cmd: "showText", args: [""] });

    const setVariable = createCommand("setVariable");
    expect(setVariable).toEqual({ cmd: "setVariable", args: ["var_0", "set", 0] });

    const setSwitch = createCommand("setSwitch");
    expect(setSwitch).toEqual({ cmd: "setSwitch", args: ["sw_0", true] });
  });

  it("commandSummary renders a readable one-liner", () => {
    expect(commandSummary({ cmd: "showText", args: ["Hello!"] })).toBe('Show Text: "Hello!"');
    expect(commandSummary(createCommand("setVariable"))).toContain("Set Variable");
    expect(commandSummary({ cmd: "unknownCmd", args: [1] })).toBe("unknownCmd: 1");
  });

  it("commandDefFor resolves catalog entries", () => {
    expect(commandDefFor("playSound")?.label).toBe("Play Sound");
    expect(commandDefFor("nope")).toBeUndefined();
  });
});

describe("event page command editing", () => {
  it("adds commands to a page", () => {
    let page = createPage();
    page = addCommandToPage(page, createCommand("showText"));
    page = addCommandToPage(page, createCommand("playSound"));
    expect(page.commands).toHaveLength(2);
    expect(page.commands[0]).toEqual({ cmd: "showText", args: [""] });
  });

  it("removes a command by index", () => {
    let page = createPage();
    page = addCommandToPage(page, createCommand("showText"));
    page = addCommandToPage(page, createCommand("playSound"));
    page = addCommandToPage(page, createCommand("walk"));
    page = removeCommandFromPage(page, 1);
    expect(page.commands.map((c) => c.cmd)).toEqual(["showText", "walk"]);
  });

  it("updates a command by index", () => {
    let page = createPage();
    page = addCommandToPage(page, createCommand("showText"));
    page = updateCommandInPage(page, 0, { cmd: "showText", args: ["Updated!"] });
    expect(page.commands[0]!.args).toEqual(["Updated!"]);
  });

  it("moves a command within the page with clamping", () => {
    let page = createPage();
    for (const cmd of ["showText", "playSound", "walk"]) {
      page = addCommandToPage(page, createCommand(cmd));
    }
    page = moveCommandInPage(page, 0, 2);
    expect(page.commands.map((c) => c.cmd)).toEqual(["playSound", "walk", "showText"]);
    page = moveCommandInPage(page, 2, 99); // clamp to last → no-op
    expect(page.commands.map((c) => c.cmd)).toEqual(["playSound", "walk", "showText"]);
    page = moveCommandInPage(page, 1, -5); // clamp to first → moves to front
    expect(page.commands.map((c) => c.cmd)).toEqual(["walk", "playSound", "showText"]);
  });

  it("sets a page condition (switch vs always)", () => {
    let page = createPage();
    expect(page.condition).toBeNull();
    page = setPageCondition(page, { switchId: "door_open", value: true });
    expect(page.condition).toEqual({ switchId: "door_open", value: true });
    page = setPageCondition(page, null);
    expect(page.condition).toBeNull();
  });
});

describe("createEvent / createPage", () => {
  it("creates a schema-valid event with one default page", () => {
    const event = createEvent({ id: "evt_1", name: "NPC", x: 5, y: 6 });
    expect(event.id).toBe("evt_1");
    expect(event.x).toBe(5);
    expect(event.y).toBe(6);
    expect(event.pages).toHaveLength(1);
    expect(event.pages[0]).toEqual({ condition: null, commands: [] });
  });
});
