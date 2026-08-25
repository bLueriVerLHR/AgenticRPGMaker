/**
 * Toolbar (P2, ADR-006): tools, undo/redo, preview toggle, import/export.
 */
import { useRef } from "react";
import type { EditorStore } from "../state/editor-store.js";
import type { EditorTool } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";

const TOOLS: { id: EditorTool; label: string; testid: string }[] = [
  { id: "select", label: "Select", testid: "tool-select" },
  { id: "paint", label: "Paint", testid: "tool-paint" },
  { id: "erase", label: "Erase", testid: "tool-erase" },
  { id: "event", label: "Event", testid: "tool-event" },
];

export function Toolbar({
  store,
  projectName,
  onExport,
  onImportZip,
  onImportFolder,
  onSave,
  onClose,
}: {
  store: EditorStore;
  projectName: string;
  onExport: () => void;
  onImportZip: (file: File) => void;
  onImportFolder: (files: FileList | null) => void;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="toolbar" data-testid="toolbar">
      <span className="brand">AgenticRPGMaker</span>
      <span className="project-name" data-testid="project-name">
        {projectName}
      </span>
      <span className="spacer" />
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`btn${snapshot.tool === tool.id ? " active" : ""}`}
          data-testid={tool.testid}
          onClick={() => store.set({ tool: tool.id })}
        >
          {tool.label}
        </button>
      ))}
      <span className="toolbar-sep" />
      <button
        type="button"
        className="btn"
        data-testid="toolbar-undo"
        disabled={!store.canUndo}
        title={store.undoLabel ?? "Undo"}
        onClick={() => store.undo()}
      >
        Undo
      </button>
      <button
        type="button"
        className="btn"
        data-testid="toolbar-redo"
        disabled={!store.canRedo}
        title={store.redoLabel ?? "Redo"}
        onClick={() => store.redo()}
      >
        Redo
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        className={`btn${snapshot.previewOpen ? " active" : ""}`}
        data-testid="preview-toggle"
        onClick={() => store.set({ previewOpen: !snapshot.previewOpen })}
      >
        {snapshot.previewOpen ? "Stop Preview" : "Play"}
      </button>
      <span className="toolbar-sep" />
      <button type="button" className="btn" data-testid="toolbar-export" onClick={onExport}>
        Export ZIP
      </button>
      <button
        type="button"
        className="btn"
        data-testid="toolbar-import"
        onClick={() => zipInputRef.current?.click()}
      >
        Import ZIP
      </button>
      <button
        type="button"
        className="btn"
        data-testid="toolbar-import-folder"
        onClick={() => folderInputRef.current?.click()}
      >
        Import Folder
      </button>
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        data-testid="import-zip-input"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            onImportZip(file);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        data-testid="import-folder-input"
        // webkitdirectory is a Chromium extension; the folder picker is an
        // optional convenience (never a requirement — docs/08 §3.1).
        {...{ webkitdirectory: "", directory: "", multiple: true }}
        style={{ display: "none" }}
        onChange={(event) => {
          onImportFolder(event.target.files);
          event.target.value = "";
        }}
      />
      <button type="button" className="btn" data-testid="toolbar-save" onClick={onSave}>
        Save
      </button>
      <button type="button" className="btn" data-testid="toolbar-close" onClick={onClose}>
        Close
      </button>
    </header>
  );
}
