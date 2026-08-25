/**
 * Project repository over IndexedDB (P2, D12 / ADR-006).
 *
 * The editor keeps whole projects (project document + map documents + tileset
 * documents) in IndexedDB behind a thin async repository interface — the
 * Storage Adapter pattern (docs/06-architecture.md §7), so a later
 * server/file backend can swap in without touching the editor UI.
 *
 * Every document is validated through the core zod schemas on load
 * (`parseProjectDocument` / `parseMapDocument` / `parseTilesetDocument`):
 * ADR-003 enforcement at the boundary. A corrupt/unknown-version project is
 * reported as `null` from `open()` with a warn log, never a crash (matching
 * the runtime storage adapter's graceful-degradation rule).
 */
import type { MapData, ProjectData, TilesetData } from "@agenticrpg/core";
import { parseMapDocument, parseProjectDocument, parseTilesetDocument } from "@agenticrpg/core";
import type { EditorLogger } from "../logger.js";
import { createNoopLogger } from "../logger.js";
import { newProjectId } from "../model/project.js";

/** IndexedDB database name for editor projects. */
export const EDITOR_DB_NAME = "agenticrpg-editor";

/**
 * The editor's default IndexedDB database name. Mutable so an embedding host
 * (or the test suite, for isolation) can point the editor at a different
 * database without touching the repository class.
 */
export let defaultEditorDbName: string = EDITOR_DB_NAME;

/** Set the default editor database name (embedding/tests). */
export function setDefaultEditorDbName(name: string): void {
  defaultEditorDbName = name;
}

/** Object store holding project records (keyPath "id"). */
export const PROJECTS_STORE = "projects";

/** A project's list entry (lightweight, for the project list screen). */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  mapCount: number;
}

/** A full stored project (the unit persisted in IndexedDB). */
export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  project: ProjectData;
  maps: MapData[];
  tilesets: TilesetData[];
}

/** Input for creating a new project. */
export interface NewProjectInput {
  name: string;
  project: ProjectData;
  maps: MapData[];
  tilesets: TilesetData[];
}

/** The async repository seam (Storage Adapter pattern). */
export interface ProjectRepository {
  /** Whether this backend is usable right now. */
  readonly available: boolean;
  /** List all projects (newest first). */
  list(): Promise<ProjectMeta[]>;
  /** Create a project, returning its meta. */
  create(input: NewProjectInput): Promise<ProjectMeta>;
  /** Open a project's full documents, or null when missing/corrupt. */
  open(id: string): Promise<StoredProject | null>;
  /** Persist an updated project (autosave). */
  save(record: StoredProject): Promise<void>;
  /** Delete a project. */
  remove(id: string): Promise<void>;
}

function resolveIDB(idb: IDBFactory | null | undefined): IDBFactory | null {
  if (idb !== undefined) {
    return idb;
  }
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  return null;
}

/** True when IndexedDB exists in the current environment. */
export function isEditorIndexedDBAvailable(): boolean {
  return resolveIDB(undefined) !== null;
}

interface StoredRecord {
  id: string;
  name: string;
  updatedAt: string;
  mapCount: number;
  project: unknown;
  maps: unknown;
  tilesets: unknown;
}

/** IndexedDB-backed `ProjectRepository`. */
export class IndexedDBProjectRepository implements ProjectRepository {
  private readonly idb: IDBFactory | null;
  private readonly logger: EditorLogger;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: { idb?: IDBFactory | null; logger?: EditorLogger; dbName?: string } = {}) {
    this.idb = resolveIDB(options.idb);
    this.logger = options.logger ?? createNoopLogger();
    this.dbName = options.dbName ?? defaultEditorDbName;
  }

  private readonly dbName: string;

  get available(): boolean {
    return this.idb !== null;
  }

  async list(): Promise<ProjectMeta[]> {
    if (this.idb === null) {
      this.logger.warn("editor storage: indexeddb unavailable, list empty");
      return [];
    }
    try {
      const db = await this.openDb();
      const records = await this.request<StoredRecord[]>(
        db.transaction(PROJECTS_STORE, "readonly"),
        (store) => store.getAll() as IDBRequest<StoredRecord[]>,
      );
      const metas = records.map((record) => ({
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
        mapCount: record.mapCount,
      }));
      metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      this.logger.debug("editor storage: listed projects", { count: metas.length });
      return metas;
    } catch (error) {
      this.logger.warn("editor storage: list failed", { error: String(error) });
      return [];
    }
  }

  async create(input: NewProjectInput): Promise<ProjectMeta> {
    const id = newProjectId();
    const record: StoredRecord = {
      id,
      name: input.name,
      updatedAt: new Date().toISOString(),
      mapCount: input.maps.length,
      project: input.project,
      maps: input.maps,
      tilesets: input.tilesets,
    };
    await this.put(record);
    this.logger.info("editor storage: project created", {
      id,
      name: input.name,
      maps: input.maps.length,
      tilesets: input.tilesets.length,
    });
    return { id, name: input.name, updatedAt: record.updatedAt, mapCount: input.maps.length };
  }

  async open(id: string): Promise<StoredProject | null> {
    if (this.idb === null) {
      this.logger.warn("editor storage: indexeddb unavailable, open returned null", { id });
      return null;
    }
    try {
      const db = await this.openDb();
      const record = await this.request<StoredRecord | undefined>(
        db.transaction(PROJECTS_STORE, "readonly"),
        (store) => store.get(id) as IDBRequest<StoredRecord | undefined>,
      );
      if (record === undefined) {
        return null;
      }
      // Validate every document against the core schemas (ADR-003).
      const project = parseProjectDocument(record.project);
      const maps = (record.maps as unknown[]).map((raw) => parseMapDocument(raw));
      const tilesets = (record.tilesets as unknown[]).map((raw) => parseTilesetDocument(raw));
      this.logger.debug("editor storage: project opened", {
        id,
        maps: maps.length,
        tilesets: tilesets.length,
      });
      return {
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
        project,
        maps,
        tilesets,
      };
    } catch (error) {
      this.logger.warn("editor storage: open failed or corrupt project", {
        id,
        error: String(error),
      });
      return null;
    }
  }

  async save(record: StoredProject): Promise<void> {
    const stored: StoredRecord = {
      id: record.id,
      name: record.name,
      updatedAt: new Date().toISOString(),
      mapCount: record.maps.length,
      project: record.project,
      maps: record.maps,
      tilesets: record.tilesets,
    };
    await this.put(stored);
    this.logger.debug("editor storage: project saved", {
      id: record.id,
      maps: record.maps.length,
    });
  }

  async remove(id: string): Promise<void> {
    if (this.idb === null) {
      return;
    }
    try {
      const db = await this.openDb();
      await this.request<unknown>(
        db.transaction(PROJECTS_STORE, "readwrite"),
        (store) => store.delete(id) as IDBRequest<unknown>,
      );
      this.logger.info("editor storage: project removed", { id });
    } catch (error) {
      this.logger.warn("editor storage: remove failed", { id, error: String(error) });
    }
  }

  private async put(record: StoredRecord): Promise<void> {
    if (this.idb === null) {
      return;
    }
    try {
      const db = await this.openDb();
      await this.request<unknown>(
        db.transaction(PROJECTS_STORE, "readwrite"),
        (store) => store.put(record) as IDBRequest<unknown>,
      );
    } catch (error) {
      this.logger.warn("editor storage: put failed", { id: record.id, error: String(error) });
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise === null) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const factory = this.idb;
        if (factory === null) {
          reject(new Error("indexeddb unavailable"));
          return;
        }
        const request = factory.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
            const store = db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
            store.createIndex("updatedAt", "updatedAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
        request.onblocked = () => reject(new Error("indexeddb open blocked"));
      });
    }
    return this.dbPromise;
  }

  private request<T>(
    tx: IDBTransaction,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = run(tx.objectStore(PROJECTS_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
    });
  }
}
