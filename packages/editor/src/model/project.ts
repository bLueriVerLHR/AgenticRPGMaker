/**
 * Project model helpers (P2, ADR-006 / D12; core `project` schema ADR-003).
 *
 * A project bundles settings (display resolution, initial map), an asset
 * manifest, and the map/tileset documents the editor manages. The editor keeps
 * the project + its documents in IndexedDB and imports/exports them as a
 * portable folder/zip package (www-style `data/` layout).
 */
import type { MapData, ProjectData, TilesetData } from "@agenticrpg/core";
import { PROJECT_SCHEMA_VERSION, projectSchema } from "@agenticrpg/core";
import { newId } from "./ids.js";
import { createMap } from "./map-ops.js";
import { createPlaceholderTileset, PLACEHOLDER_TILESET_ID } from "../tileset/placeholder.js";

/** A freshly-created project: one map + the placeholder tileset. */
export interface NewProject {
  name: string;
  project: ProjectData;
  maps: MapData[];
  tilesets: TilesetData[];
}

/** Validate a project document against the core schema (ADR-003). */
export function validateProject(project: ProjectData): ProjectData {
  const result = projectSchema.safeParse(project);
  if (!result.success) {
    throw new Error(`invalid project: ${result.error.message}`);
  }
  return result.data;
}

/** Create a brand-new default project with a single start map. */
export function createDefaultProject(name = "Untitled Project"): NewProject {
  const tileset = createPlaceholderTileset();
  const map = createMap({ id: "map_start", name: "Start Map" });
  const project: ProjectData = validateProject({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    settings: {
      display: { width: 640, height: 480 },
      initialMap: map.id,
      engineOptions: {},
    },
    assets: {
      images: [],
      audio: [],
      tilesets: [tileset.id],
      maps: [map.id],
    },
  });
  return { name, project, maps: [map], tilesets: [tileset] };
}

/**
 * Rebuild the project manifest (`assets.maps` / `assets.tilesets`) and the
 * `settings.initialMap` from the current document lists, so the project never
 * drifts from the maps/tilesets actually in the editor (single source of
 * truth — the documents are authoritative).
 */
export function syncProjectAssets(
  project: ProjectData,
  maps: MapData[],
  tilesets: TilesetData[],
): ProjectData {
  const mapIds = maps.map((m) => m.id);
  const initialMap = mapIds.includes(project.settings.initialMap)
    ? project.settings.initialMap
    : (mapIds[0] ?? project.settings.initialMap);
  return validateProject({
    ...project,
    settings: { ...project.settings, initialMap },
    assets: {
      ...project.assets,
      tilesets: tilesets.map((t) => t.id),
      maps: mapIds,
    },
  });
}

/** Create a new (unopened) project id. */
export function newProjectId(): string {
  return newId("proj");
}

/** A fresh map id for the default placeholder tileset. */
export function newMapId(): string {
  return newId("map");
}

/** A fresh layer id. */
export function newLayerId(mapId: string, name: string): string {
  return `${mapId}_${slugify(name)}_${newId("l").split("_").pop()}`;
}

/** A fresh event id. */
export function newEventId(): string {
  return newId("evt");
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "layer"
  );
}

/** True when the placeholder tileset is in the tileset list. */
export function hasPlaceholderTileset(tilesets: TilesetData[]): boolean {
  return tilesets.some((t) => t.id === PLACEHOLDER_TILESET_ID);
}
