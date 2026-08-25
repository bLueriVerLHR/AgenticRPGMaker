/**
 * Project schema v1 tests (ADR-003 enforcement).
 */
import { describe, expect, it } from "vitest";

import { projectSchema } from "../../src/index.js";

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    settings: {
      display: { width: 320, height: 240 },
      initialMap: "map_town_square",
      engineOptions: { strictMode: true },
    },
    assets: {
      images: ["characters/npc_innkeeper"],
      audio: ["audio/coin.ogg"],
      tilesets: ["tilesets/grassland"],
      maps: ["map_town_square"],
    },
    openEditorState: { cameraX: 10, cameraY: 5 },
    ...overrides,
  };
}

describe("projectSchema (v1)", () => {
  it("parses a valid project document", () => {
    const result = projectSchema.safeParse(makeProject());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.initialMap).toBe("map_town_square");
      expect(result.data.settings.display.width).toBe(320);
      expect(result.data.assets.maps).toEqual(["map_town_square"]);
    }
  });

  it("parses a project without editor state (optional)", () => {
    const { openEditorState: _openEditorState, ...rest } = makeProject();
    expect(projectSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a missing schemaVersion", () => {
    const input = makeProject();
    delete input.schemaVersion;
    expect(projectSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown/newer schemaVersion", () => {
    expect(projectSchema.safeParse(makeProject({ schemaVersion: 2 })).success).toBe(false);
  });

  it("rejects non-positive display dimensions", () => {
    const input = makeProject({
      settings: { display: { width: 0, height: 240 }, initialMap: "m" },
    });
    expect(projectSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a missing initialMap", () => {
    const input = makeProject();
    delete input.settings;
    expect(projectSchema.safeParse(input).success).toBe(false);
  });

  it("round-trips stably", () => {
    const parsed = projectSchema.parse(makeProject());
    const reparsed = projectSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });
});
