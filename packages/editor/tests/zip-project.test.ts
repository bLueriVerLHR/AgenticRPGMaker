/**
 * ZIP project package tests (P2, D12 / ADR-006): project → www-style folder
 * layout → ZIP bytes → back → identical project, validated against the core
 * schemas at every boundary. Uses fflate (isomorphic, works in Node).
 */
import { describe, expect, it } from "vitest";

import {
  buildProjectPackage,
  deserializeProjectZip,
  parseProjectPackage,
  serializeProjectToZip,
  unzipProjectPackage,
  zipProjectPackage,
  ProjectPackageError,
  DATA_DIR,
  README_PATH,
} from "../src/storage/zip-project.js";
import { createDefaultProject } from "../src/model/project.js";
import { createMap, paintTiles, upsertEvent } from "../src/model/map-ops.js";
import { createEvent } from "../src/model/event-model.js";
import { newEventId } from "../src/model/project.js";

function makeProjectWithContent() {
  const created = createDefaultProject("Zip Me");
  let map = created.maps[0]!;
  map = paintTiles(map, map.layers[0]!.id, [
    { x: 1, y: 1, index: 5 },
    { x: 2, y: 2, index: 8 },
  ]);
  const event = createEvent({ id: newEventId(), name: "Guard", x: 5, y: 5 });
  event.pages[0]!.commands.push({ cmd: "showText", args: ["Stop!"] });
  map = upsertEvent(map, event);
  return {
    ...created,
    maps: [map],
  };
}

describe("buildProjectPackage", () => {
  it("serialises to the www-style data/ layout with a readme", () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, maps, tilesets);

    expect(files.has("data/project.json")).toBe(true);
    expect(files.has(`data/maps/${maps[0]!.id}.json`)).toBe(true);
    expect(files.has(`data/tilesets/${tilesets[0]!.id}.json`)).toBe(true);
    expect(files.has(README_PATH)).toBe(true);
  });

  it("project.json inside the package is the core project document", () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, maps, tilesets);
    const manifest = JSON.parse(
      new TextDecoder().decode(files.get("data/project.json")!),
    ) as typeof project;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assets.maps).toEqual(maps.map((m) => m.id));
  });
});

describe("zip round-trip", () => {
  it("project → zip → unzip → parse reproduces the same content", () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const bytes = serializeProjectToZip(project, maps, tilesets);
    expect(bytes.length).toBeGreaterThan(0);

    const unzipped = unzipProjectPackage(bytes);
    const restored = parseProjectPackage(unzipped);

    expect(restored.project.settings).toEqual(project.settings);
    expect(restored.maps).toHaveLength(maps.length);
    expect(restored.maps[0]!.layers[0]!.data).toEqual(maps[0]!.layers[0]!.data);
    expect(restored.maps[0]!.events[0]!.pages[0]!.commands).toEqual([
      { cmd: "showText", args: ["Stop!"] },
    ]);
    expect(restored.tilesets).toHaveLength(tilesets.length);
  });

  it("round-trips through the convenience deserializer", async () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const bytes = serializeProjectToZip(project, maps, tilesets);
    const restored = deserializeProjectZip(bytes);
    expect(restored.maps[0]!.id).toBe(maps[0]!.id);
    expect(restored.maps[0]!.layers[0]!.data[1]![1]).toBe(5);
    // A fresh id is assigned so an import never overwrites an existing project.
    expect(restored.id).toMatch(/^proj_/);
  });

  it("zipProjectPackage/unzipProjectPackage are inverse for the data files", () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, maps, tilesets);
    const zipped = zipProjectPackage(files);
    const unzipped = unzipProjectPackage(zipped);
    expect([...unzipped.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, bytes] of files) {
      const got = unzipped.get(path);
      expect(got).toBeDefined();
      // Compare contents explicitly: vitest's toEqual on fflate-produced
      // Uint8Arrays has a diff quirk even for byte-identical arrays.
      expect([...got!]).toEqual([...bytes]);
    }
  });
});

describe("parseProjectPackage validation", () => {
  it("rejects a package missing data/project.json", () => {
    expect(() => parseProjectPackage(new Map([["data/maps/x.json", new Uint8Array()]]))).toThrow(
      ProjectPackageError,
    );
  });

  it("rejects an invalid map document in the package", () => {
    const { project, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, [], tilesets);
    files.set(
      `${DATA_DIR}/maps/bad.json`,
      new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, id: "bad" })),
    );
    expect(() => parseProjectPackage(files)).toThrow();
  });

  it("rejects a package with no maps", () => {
    const { project, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, [], tilesets);
    files.delete(`${DATA_DIR}/maps/map_start.json`);
    expect(() => parseProjectPackage(files)).toThrow(ProjectPackageError);
  });

  it("accepts a package with multiple maps and tilesets", () => {
    const created = makeProjectWithContent();
    const secondMap = createMap({ id: "map_second", name: "Second" });
    const files = buildProjectPackage(
      created.project,
      [...created.maps, secondMap],
      created.tilesets,
    );
    const restored = parseProjectPackage(files);
    expect(restored.maps).toHaveLength(2);
  });

  it("accepts a folder import wrapped in a root directory (webkitRelativePath)", () => {
    const { project, maps, tilesets } = makeProjectWithContent();
    const files = buildProjectPackage(project, maps, tilesets);
    // Simulate a `webkitdirectory` pick: every path gains the picked root
    // folder as a prefix, plus a stray non-package file.
    const wrapped = new Map(
      [...files.entries()].map(([path, bytes]) => [`MyProject/${path}`, bytes] as const),
    );
    wrapped.set("MyProject/notes.txt", new TextEncoder().encode("not a package file"));
    const restored = parseProjectPackage(wrapped);
    expect(restored.maps).toHaveLength(maps.length);
    expect(restored.maps[0]!.layers[0]!.data).toEqual(maps[0]!.layers[0]!.data);
    expect(restored.tilesets).toHaveLength(tilesets.length);
  });
});
