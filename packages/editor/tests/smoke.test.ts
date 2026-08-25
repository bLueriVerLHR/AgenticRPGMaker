/**
 * Editor smoke test (P2): the package resolves the shared core, builds a
 * default project that passes core schema validation, and round-trips it
 * through the ZIP project package (the core P2 flows in one test).
 */
import { describe, expect, it } from "vitest";
import { mapSchema, projectSchema, tilesetSchema } from "@agenticrpg/core";

import { createDefaultProject } from "../src/model/project.js";
import { serializeProjectToZip, deserializeProjectZip } from "../src/storage/zip-project.js";

describe("@agenticrpg/editor (P2)", () => {
  it("creates a default project that validates against the core schemas", () => {
    const created = createDefaultProject("Smoke");
    expect(projectSchema.safeParse(created.project).success).toBe(true);
    expect(created.maps.length).toBeGreaterThan(0);
    for (const map of created.maps) {
      expect(mapSchema.safeParse(map).success).toBe(true);
    }
    for (const tileset of created.tilesets) {
      expect(tilesetSchema.safeParse(tileset).success).toBe(true);
    }
  });

  it("round-trips the default project through the ZIP package", () => {
    const created = createDefaultProject("Smoke");
    const bytes = serializeProjectToZip(created.project, created.maps, created.tilesets);
    const restored = deserializeProjectZip(bytes);
    expect(restored.maps[0]!.id).toBe(created.maps[0]!.id);
    expect(restored.project.settings.initialMap).toBe(created.project.settings.initialMap);
  });
});
