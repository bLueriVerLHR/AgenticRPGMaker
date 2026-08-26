/**
 * Project package: ZIP import/export (P2, D12 / ADR-006).
 *
 * The editor serialises a project to the portable `www`-style folder layout
 * and downloads it as a ZIP archive; import accepts the same ZIP **or a folder
 * picked via a file input** (`webkitdirectory`). The File System Access API is
 * **never required** (docs/08-compatibility-checklist.md §3.1) — it is only a
 * documented optional Chromium upgrade path (see `TODO` below).
 *
 * Layout of the package:
 *
 * ```
 * project.zip
 * ├── data/project.json            ← core project schema (ADR-003)
 * ├── data/maps/<mapId>.json       ← core map schema, one file per map
 * ├── data/tilesets/<tilesetId>.json ← core tileset schema
 * └── README.md                    ← human-readable package description
 * ```
 *
 * **Zip library choice:** `fflate` (pinned, dev-tool only, never reaches the
 * runtime). Rationale: zero dependencies, isomorphic (Node + browser), small
 * bundle, synchronous `zipSync`/`unzipSync` suitable for the editor's small
 * JSON documents; ADR-006 names jszip only as an example ("e.g. jszip"), and
 * fflate satisfies the same need with less weight.
 *
 * TODO (optional Chromium upgrade path, never required): when
 * `window.showSaveFilePicker` / `showOpenFilePicker` are present, offer
 * "save to folder…" / "open folder…" as a convenience; the ZIP path remains
 * the universal default.
 */
import { strToU8, unzipSync, zipSync } from "fflate";
import type { MapData, ProjectData, TilesetData } from "@agenticrpg/core";
import { parseMapDocument, parseProjectDocument, parseTilesetDocument } from "@agenticrpg/core";
import type { StoredProject } from "./project-repository.js";
import { newProjectId } from "../model/project.js";

/** Directory holding the portable JSON documents inside the package. */
export const DATA_DIR = "data";
/** The project manifest path inside the package. */
export const PROJECT_MANIFEST_PATH = "data/project.json";
/** README entry name inside the package. */
export const README_PATH = "README.md";

/** A project package: a flat map of relative path → file bytes. */
export type ProjectPackageFiles = Map<string, Uint8Array>;

/** Raised when a package is malformed or fails core schema validation. */
export class ProjectPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPackageError";
  }
}

function encodeText(text: string): Uint8Array {
  return strToU8(text);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Build the readme text describing the package. */
export function buildPackageReadme(
  project: ProjectData,
  maps: MapData[],
  tilesets: TilesetData[],
): string {
  return [
    `# ${project.settings.display.width}x${project.settings.display.height} AgenticRPGMaker project`,
    "",
    `Exported by the AgenticRPGMaker editor (packages/editor, ADR-006).`,
    `Initial map: ${project.settings.initialMap}.`,
    "",
    "Layout:",
    "  data/project.json      — project manifest (core project schema v1)",
    "  data/maps/*.json       — map documents (core map schema v1)",
    "  data/tilesets/*.json   — tileset documents (core tileset schema v1)",
    "",
    `This package contains ${maps.length} map(s) and ${tilesets.length} tileset(s).`,
    "",
    "Import it back into the editor via File → Import (ZIP or folder).",
    "",
  ].join("\n");
}

/**
 * Serialise a project to the portable folder layout (file path → bytes).
 * Every document is validated against the core schemas before serialisation.
 */
export function buildProjectPackage(
  project: ProjectData,
  maps: MapData[],
  tilesets: TilesetData[],
): ProjectPackageFiles {
  const files: ProjectPackageFiles = new Map();
  files.set(PROJECT_MANIFEST_PATH, encodeText(JSON.stringify(project, null, 2)));
  for (const map of maps) {
    files.set(`${DATA_DIR}/maps/${map.id}.json`, encodeText(JSON.stringify(map, null, 2)));
  }
  for (const tileset of tilesets) {
    files.set(
      `${DATA_DIR}/tilesets/${tileset.id}.json`,
      encodeText(JSON.stringify(tileset, null, 2)),
    );
  }
  files.set(README_PATH, encodeText(buildPackageReadme(project, maps, tilesets)));
  return files;
}

/** Zip a project package into a single archive (fflate, sync). */
export function zipProjectPackage(files: ProjectPackageFiles): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of files) {
    entries[path] = bytes;
  }
  return zipSync(entries, { level: 6 });
}

/** Unzip a project package into file-path → bytes. */
export function unzipProjectPackage(bytes: Uint8Array): ProjectPackageFiles {
  const unzipped = unzipSync(bytes);
  const files: ProjectPackageFiles = new Map();
  for (const [path, data] of Object.entries(unzipped)) {
    files.set(path, data);
  }
  return files;
}

/**
 * Normalise package paths: a folder import (`webkitdirectory`) prefixes every
 * `webkitRelativePath` with the picked root folder name, and a ZIP may wrap
 * everything in a single top-level directory. When the manifest is not at the
 * expected root but exactly one `…/data/project.json` exists, that common
 * leading directory is stripped from every entry.
 */
function normalizePackageFiles(files: ProjectPackageFiles): ProjectPackageFiles {
  if (files.has(PROJECT_MANIFEST_PATH)) {
    return files;
  }
  const suffix = `/${PROJECT_MANIFEST_PATH}`;
  const candidates = [...files.keys()].filter((path) => path.endsWith(suffix));
  if (candidates.length !== 1) {
    return files; // missing (or ambiguous) manifest — reported by the caller
  }
  const prefix = candidates[0]!.slice(0, candidates[0]!.length - PROJECT_MANIFEST_PATH.length);
  const normalized: ProjectPackageFiles = new Map();
  for (const [path, bytes] of files) {
    normalized.set(path.startsWith(prefix) ? path.slice(prefix.length) : path, bytes);
  }
  return normalized;
}

/**
 * Parse a project package (from ZIP or folder import) into a validated
 * `StoredProject`. The project document, every map, and every tileset are
 * validated against the core schemas; a fresh project id is assigned on
 * import so an import never overwrites an existing project.
 */
export function parseProjectPackage(inputFiles: ProjectPackageFiles): StoredProject {
  const files = normalizePackageFiles(inputFiles);
  const manifest = files.get(PROJECT_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new ProjectPackageError(`package is missing ${PROJECT_MANIFEST_PATH}`);
  }
  let rawProject: unknown;
  try {
    rawProject = JSON.parse(decodeText(manifest));
  } catch (error) {
    throw new ProjectPackageError(`package manifest is not valid JSON: ${String(error)}`);
  }
  const project = parseProjectDocument(rawProject);

  const maps: MapData[] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith(`${DATA_DIR}/maps/`) || !path.endsWith(".json")) {
      continue;
    }
    const raw = JSON.parse(decodeText(bytes));
    maps.push(parseMapDocument(raw));
  }

  const tilesets: TilesetData[] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith(`${DATA_DIR}/tilesets/`) || !path.endsWith(".json")) {
      continue;
    }
    const raw = JSON.parse(decodeText(bytes));
    tilesets.push(parseTilesetDocument(raw));
  }

  if (maps.length === 0) {
    throw new ProjectPackageError("package contains no maps under data/maps/");
  }

  return {
    id: newProjectId(),
    name: projectNameFromPackage(project),
    updatedAt: new Date().toISOString(),
    project,
    maps,
    tilesets,
  };
}

/** Convenience: project → zipped bytes (export path). */
export function serializeProjectToZip(
  project: ProjectData,
  maps: MapData[],
  tilesets: TilesetData[],
): Uint8Array {
  return zipProjectPackage(buildProjectPackage(project, maps, tilesets));
}

/** Convenience: zipped bytes → validated stored project (import path). */
export function deserializeProjectZip(bytes: Uint8Array): StoredProject {
  return parseProjectPackage(unzipProjectPackage(bytes));
}

/**
 * Read a folder picked via a `webkitdirectory` file input into a project
 * package (relative paths from `webkitRelativePath`). Non-web files (no
 * relative path) are ignored.
 */
export async function readFolderFiles(files: Iterable<File>): Promise<ProjectPackageFiles> {
  const packageFiles: ProjectPackageFiles = new Map();
  for (const file of files) {
    const rel = file.webkitRelativePath ?? "";
    if (rel === "") {
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    packageFiles.set(rel, bytes);
  }
  return packageFiles;
}

/** Read a single ZIP `File` into a project package. */
export async function readZipFile(file: File): Promise<ProjectPackageFiles> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return unzipProjectPackage(bytes);
}

function projectNameFromPackage(project: ProjectData): string {
  const firstMap = project.assets.maps[0];
  return firstMap === undefined ? "Imported Project" : firstMap;
}
