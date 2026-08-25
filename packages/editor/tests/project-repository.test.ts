/**
 * Project repository tests (P2, D12 / ADR-006) — IndexedDB backed by
 * `fake-indexeddb` (the storage logic is the real code path; only the
 * IndexedDB engine is faked, mirroring the runtime storage tests).
 */
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  IndexedDBProjectRepository,
  isEditorIndexedDBAvailable,
  type StoredProject,
} from "../src/storage/project-repository.js";
import { createDefaultProject } from "../src/model/project.js";
import { createNoopLogger } from "../src/logger.js";
import { paintTiles } from "../src/model/map-ops.js";

function makeRepository(dbName: string): IndexedDBProjectRepository {
  return new IndexedDBProjectRepository({ dbName, logger: createNoopLogger() });
}

function fixtureProject(name: string): StoredProject {
  const created = createDefaultProject(name);
  return {
    id: "proj_fixture",
    name,
    updatedAt: new Date().toISOString(),
    project: created.project,
    maps: created.maps,
    tilesets: created.tilesets,
  };
}

describe("IndexedDBProjectRepository (fake-indexeddb)", () => {
  it("reports availability under fake-indexeddb", () => {
    expect(isEditorIndexedDBAvailable()).toBe(true);
    expect(makeRepository("db-a").available).toBe(true);
  });

  it("create → list → open round-trips a project", async () => {
    const repo = makeRepository("db-roundtrip");
    const created = createDefaultProject("My Game");
    const meta = await repo.create({
      name: created.name,
      project: created.project,
      maps: created.maps,
      tilesets: created.tilesets,
    });
    expect(meta.name).toBe("My Game");
    expect(meta.mapCount).toBe(1);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(meta.id);

    const opened = await repo.open(meta.id);
    expect(opened).not.toBeNull();
    expect(opened!.project.settings.initialMap).toBe("map_start");
    expect(opened!.maps).toHaveLength(1);
    expect(opened!.tilesets[0]!.id).toBe("tilesets/placeholder");
  });

  it("open() returns null for a missing project", async () => {
    const repo = makeRepository("db-missing");
    expect(await repo.open("nope")).toBeNull();
  });

  it("save() persists updates (autosave path)", async () => {
    const repo = makeRepository("db-save");
    const record = fixtureProject("Save Me");
    await repo.save(record);

    const opened = await repo.open(record.id);
    expect(opened).not.toBeNull();

    // Mutate a map through core ops, then save again.
    const painted = paintTiles(opened!.maps[0]!, opened!.maps[0]!.layers[0]!.id, [
      { x: 3, y: 3, index: 12 },
    ]);
    await repo.save({ ...opened!, maps: [painted] });

    const reopened = await repo.open(record.id);
    expect(reopened!.maps[0]!.layers[0]!.data[3]![3]).toBe(12);
  });

  it("keeps projects separate", async () => {
    const repo = makeRepository("db-separate");
    const a = fixtureProject("A"); // id "proj_fixture"
    const b = { ...fixtureProject("B"), id: "proj_b" };
    await repo.save(a);
    await repo.save(b);

    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(await repo.open("proj_fixture")).not.toBeNull();
    expect(await repo.open("proj_b")).not.toBeNull();
  });

  it("remove() deletes a project", async () => {
    const repo = makeRepository("db-remove");
    const record = fixtureProject("Delete Me");
    await repo.save(record);
    expect(await repo.open(record.id)).not.toBeNull();

    await repo.remove(record.id);
    expect(await repo.open(record.id)).toBeNull();
    expect(await repo.list()).toHaveLength(0);
  });

  it("open() validates documents against the core schemas; corrupt → null", async () => {
    const repo = makeRepository("db-corrupt");
    const record = fixtureProject("Corrupt");
    // Persist a corrupt project document directly through the IDB engine.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("db-corrupt", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects")) {
          request.result.createObjectStore("projects", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put({
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
        mapCount: 1,
        project: { schemaVersion: 1, settings: {}, assets: {} }, // invalid project
        maps: record.maps,
        tilesets: record.tilesets,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const opened = await repo.open(record.id);
    expect(opened).toBeNull(); // graceful degradation: warn + null, never crash
  });
});
