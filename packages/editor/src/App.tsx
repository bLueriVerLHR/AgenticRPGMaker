/**
 * Editor app shell (P2, ADR-006; docs/06-architecture.md §4 boot flow).
 *
 * Boot flow:
 *   1. open the IndexedDB project repository,
 *   2. show the project list (create / open / import),
 *   3. on open: build an `EditorStore` over the stored documents (validated
 *      against the core schemas at the repository boundary),
 *   4. wire a debounced autosave (500ms) on every store mutation,
 *   5. render the editor workspace (tree / canvas / panels / preview).
 *
 * Import/export uses the portable ZIP project package (D12); File System
 * Access is never required. The store + repository are exposed on
 * `window.__editor` for the Playwright E2E (mirroring `window.__game`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorLogger } from "./logger.js";
import { createDefaultProject, newMapId } from "./model/project.js";
import { createMap } from "./model/map-ops.js";
import { createInitialSnapshot, EditorStore } from "./state/editor-store.js";
import { addMapCommand } from "./state/maps-commands.js";
import { useStoreSelector } from "./use-editor-store.js";
import { DebouncedAutosave } from "./storage/autosave.js";
import {
  parseProjectPackage,
  readFolderFiles,
  readZipFile,
  serializeProjectToZip,
  type ProjectPackageFiles,
} from "./storage/zip-project.js";
import {
  IndexedDBProjectRepository,
  defaultEditorDbName,
  type ProjectMeta,
  type ProjectRepository,
  type StoredProject,
} from "./storage/project-repository.js";
import { Toolbar } from "./ui/Toolbar.js";
import { ProjectTree } from "./ui/ProjectTree.js";
import { MapCanvas } from "./ui/MapCanvas.js";
import { TilePalette } from "./ui/TilePalette.js";
import { LayersPanel } from "./ui/LayersPanel.js";
import { EventPanel } from "./ui/EventPanel.js";
import { VariablesPanel } from "./ui/VariablesPanel.js";
import { PreviewPanel } from "./ui/PreviewPanel.js";
import { ProjectListScreen } from "./ui/ProjectListScreen.js";

type Screen = "loading" | "projects" | "editor";
type Tab = "layers" | "event" | "variables";

interface EditorScreenState {
  store: EditorStore;
  projectId: string;
  projectName: string;
}

export function App(): React.JSX.Element {
  const loggerRef = useRef<EditorLogger | null>(null);
  if (loggerRef.current === null) {
    loggerRef.current = new EditorLogger({ scope: "editor", level: "info" });
  }
  const logger = loggerRef.current;

  const repositoryRef = useRef<ProjectRepository | null>(null);
  if (repositoryRef.current === null) {
    repositoryRef.current = new IndexedDBProjectRepository({ dbName: defaultEditorDbName, logger });
  }
  const repository = repositoryRef.current;

  const [screen, setScreen] = useState<Screen>("loading");
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorScreenState | null>(null);
  const [tab, setTab] = useState<Tab>("layers");
  const autosaveRef = useRef<DebouncedAutosave | null>(null);

  // Expose for E2E (window.__editor).
  useEffect(() => {
    (window as unknown as { __editor?: unknown }).__editor = {
      store: editor?.store ?? null,
      repository,
    };
  }, [editor, repository]);

  // Initial load: list projects.
  useEffect(() => {
    void repository
      .list()
      .then(setProjects)
      .catch((reason: unknown) => {
        logger.error("app: failed to list projects", { error: String(reason) });
        setError(`Failed to list projects: ${String(reason)}`);
      })
      .finally(() => setScreen("projects"));
  }, [repository, logger]);

  const openStoredProject = useCallback(
    (stored: StoredProject): void => {
      const store = new EditorStore(
        createInitialSnapshot({
          projectId: stored.id,
          project: stored.project,
          maps: stored.maps,
          tilesets: stored.tilesets,
          projectName: stored.name,
        }),
      );
      const autosave = new DebouncedAutosave(
        () => repository.save(serializeStore(stored.id, store)),
        500,
        logger.child("autosave"),
      );
      const unsubscribe = store.onMutated(() => autosave.schedule());
      const beforeUnload = (): void => {
        void autosave.flush();
      };
      window.addEventListener("beforeunload", beforeUnload);
      autosaveRef.current?.dispose();
      autosaveRef.current = autosave;
      (store as unknown as { _dispose?: () => void })._dispose = () => {
        unsubscribe();
        window.removeEventListener("beforeunload", beforeUnload);
        autosave.dispose();
      };
      setEditor({ store, projectId: stored.id, projectName: stored.name });
      setScreen("editor");
      setTab("layers");
      logger.info("app: opened project", { id: stored.id, name: stored.name });
    },
    [repository, logger],
  );

  const handleCreate = useCallback(
    (name: string): void => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          const created = createDefaultProject(name.trim() || "Untitled Project");
          const meta = await repository.create({
            name: created.name,
            project: created.project,
            maps: created.maps,
            tilesets: created.tilesets,
          });
          const stored = await repository.open(meta.id);
          if (stored === null) {
            throw new Error("created project could not be reopened");
          }
          openStoredProject(stored);
        } catch (reason: unknown) {
          logger.error("app: create project failed", { error: String(reason) });
          setError(`Failed to create project: ${String(reason)}`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [repository, openStoredProject, logger],
  );

  const handleOpen = useCallback(
    (id: string): void => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          const stored = await repository.open(id);
          if (stored === null) {
            throw new Error("project not found or corrupt");
          }
          openStoredProject(stored);
        } catch (reason: unknown) {
          logger.error("app: open project failed", { id, error: String(reason) });
          setError(`Failed to open project: ${String(reason)}`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [repository, openStoredProject, logger],
  );

  const handleDelete = useCallback(
    (id: string): void => {
      void (async () => {
        try {
          await repository.remove(id);
          setProjects((prev) => prev.filter((p) => p.id !== id));
        } catch (reason: unknown) {
          logger.error("app: delete project failed", { id, error: String(reason) });
          setError(`Failed to delete project: ${String(reason)}`);
        }
      })();
    },
    [repository, logger],
  );

  const importStoredProject = useCallback(
    (stored: StoredProject): void => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          await repository.create({
            name: stored.name,
            project: stored.project,
            maps: stored.maps,
            tilesets: stored.tilesets,
          });
          setProjects(await repository.list());
          openStoredProject(stored);
        } catch (reason: unknown) {
          logger.error("app: import failed", { error: String(reason) });
          setError(`Failed to import project: ${String(reason)}`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [repository, openStoredProject, logger],
  );

  const handleImportPackage = useCallback(
    (files: ProjectPackageFiles): void => {
      try {
        const stored = parseProjectPackage(files);
        importStoredProject(stored);
      } catch (reason: unknown) {
        logger.error("app: import package failed", { error: String(reason) });
        setError(`Import failed: ${String(reason)}`);
      }
    },
    [importStoredProject, logger],
  );

  const handleImportZip = useCallback(
    (file: File): void => {
      void readZipFile(file)
        .then(handleImportPackage)
        .catch((reason: unknown) => {
          logger.error("app: import zip failed", { error: String(reason) });
          setError(`Import failed: ${String(reason)}`);
        });
    },
    [handleImportPackage, logger],
  );

  const handleImportFolder = useCallback(
    (files: FileList | null): void => {
      if (files === null || files.length === 0) {
        return;
      }
      void readFolderFiles(files)
        .then(handleImportPackage)
        .catch((reason: unknown) => {
          logger.error("app: import folder failed", { error: String(reason) });
          setError(`Import failed: ${String(reason)}`);
        });
    },
    [handleImportPackage, logger],
  );

  const handleExport = useCallback((): void => {
    if (editor === null) {
      return;
    }
    const snapshot = editor.store.getSnapshot();
    const bytes = serializeProjectToZip(snapshot.project, snapshot.maps, snapshot.tilesets);
    downloadBlob(bytes, `${editor.projectName || "project"}.zip`);
    logger.info("app: exported project zip", { project: editor.projectName });
  }, [editor, logger]);

  const handleSave = useCallback((): void => {
    void autosaveRef.current?.flush();
  }, []);

  const handleClose = useCallback((): void => {
    const current = editor;
    if (current === null) {
      return;
    }
    void (autosaveRef.current?.flush() ?? Promise.resolve()).then(() => {
      (current.store as unknown as { _dispose?: () => void })._dispose?.();
      setEditor(null);
      setScreen("projects");
      void repository
        .list()
        .then(setProjects)
        .catch(() => {});
    });
  }, [editor, repository]);

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl+Y redo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (editor === null) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          editor.store.redo();
        } else {
          editor.store.undo();
        }
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editor.store.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  if (screen === "loading") {
    return (
      <div className="app" data-testid="app-loading">
        Loading…
      </div>
    );
  }

  if (screen === "projects" || editor === null) {
    return (
      <div className="app" data-testid="app-projects">
        <ProjectListScreen
          projects={projects}
          repository={repository}
          onCreate={handleCreate}
          onOpen={handleOpen}
          onDelete={handleDelete}
          onImportZip={handleImportZip}
          onImportFolder={handleImportFolder}
          busy={busy}
          error={error}
        />
      </div>
    );
  }

  return (
    <EditorScreen
      editor={editor}
      logger={logger}
      tab={tab}
      onTabChange={setTab}
      onExport={handleExport}
      onImportZip={handleImportZip}
      onImportFolder={handleImportFolder}
      onSave={handleSave}
      onClose={handleClose}
    />
  );
}

/** The editor workspace (extracted so hooks obey the Rules of Hooks). */
function EditorScreen({
  editor,
  logger,
  tab,
  onTabChange,
  onExport,
  onImportZip,
  onImportFolder,
  onSave,
  onClose,
}: {
  editor: EditorScreenState;
  logger: EditorLogger;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onExport: () => void;
  onImportZip: (file: File) => void;
  onImportFolder: (files: FileList | null) => void;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const store = editor.store;
  const previewOpen = useStoreSelector(store, (s) => s.previewOpen);

  const rightPanel =
    tab === "event" ? (
      <EventPanel store={store} />
    ) : tab === "variables" ? (
      <VariablesPanel store={store} />
    ) : (
      <LayersPanel store={store} />
    );

  return (
    <div className="app" data-testid="app-editor">
      <Toolbar
        store={store}
        projectName={editor.projectName}
        onExport={onExport}
        onImportZip={onImportZip}
        onImportFolder={onImportFolder}
        onSave={onSave}
        onClose={onClose}
      />
      <div className="workspace">
        <ProjectTree
          store={store}
          onOpenVariables={() => onTabChange("variables")}
          onNewMap={() => {
            const id = newMapId();
            const map = createMap({ id, name: "New Map" });
            store.execute(addMapCommand(id, map));
          }}
        />
        <main className="center">
          {previewOpen ? (
            <PreviewPanel store={store} logger={logger} />
          ) : (
            <>
              <MapCanvas store={store} />
              <TilePalette store={store} />
            </>
          )}
        </main>
        <aside className="sidebar right">
          <div className="tabs" data-testid="right-tabs">
            <button
              type="button"
              className={`tab${tab === "layers" ? " active" : ""}`}
              data-testid="tab-layers"
              onClick={() => onTabChange("layers")}
            >
              Layers
            </button>
            <button
              type="button"
              className={`tab${tab === "event" ? " active" : ""}`}
              data-testid="tab-event"
              onClick={() => onTabChange("event")}
            >
              Event
            </button>
            <button
              type="button"
              className={`tab${tab === "variables" ? " active" : ""}`}
              data-testid="tab-variables"
              onClick={() => onTabChange("variables")}
            >
              Vars/Sw
            </button>
          </div>
          {rightPanel}
        </aside>
      </div>
    </div>
  );
}

/** Serialize the current store state into a StoredProject for autosave. */
function serializeStore(projectId: string, store: EditorStore): StoredProject {
  const snapshot = store.getSnapshot();
  return {
    id: projectId,
    name: snapshot.projectName,
    updatedAt: new Date().toISOString(),
    project: snapshot.project,
    maps: snapshot.maps,
    tilesets: snapshot.tilesets,
  };
}

/** Trigger a browser download of `bytes`. */
function downloadBlob(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
