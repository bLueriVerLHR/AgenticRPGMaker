/**
 * Project list screen (P2, ADR-006 / D12): create, open, delete, and import
 * projects. Shown on first load so the user can choose which IndexedDB
 * project to edit.
 */
import { useRef, useState } from "react";
import type { ProjectMeta } from "../storage/project-repository.js";
import type { ProjectRepository } from "../storage/project-repository.js";

export function ProjectListScreen({
  projects,
  repository,
  onCreate,
  onOpen,
  onDelete,
  onImportZip,
  onImportFolder,
  busy,
  error,
}: {
  projects: ProjectMeta[];
  repository: ProjectRepository;
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onImportZip: (file: File) => void;
  onImportFolder: (files: FileList | null) => void;
  busy: boolean;
  error: string | null;
}): React.JSX.Element {
  const [name, setName] = useState("Untitled Project");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="project-list" data-testid="project-list">
      <h1>AgenticRPGMaker — Editor</h1>
      <p className="status-line">
        {repository.available
          ? "Projects are stored in your browser (IndexedDB). Export a ZIP to keep them safe."
          : "IndexedDB is unavailable — projects cannot be saved in this browser."}
      </p>
      {error !== null && (
        <div className="empty" data-testid="project-list-error" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <h3>Create project</h3>
      <div className="row">
        <input
          type="text"
          value={name}
          data-testid="new-project-name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onCreate(name);
            }
          }}
        />
        <button
          type="button"
          className="btn"
          data-testid="new-project-create"
          disabled={busy}
          onClick={() => onCreate(name)}
        >
          New Project
        </button>
      </div>

      <h3>Open project</h3>
      {projects.length === 0 && (
        <div className="empty">No projects yet — create one above or import a ZIP.</div>
      )}
      {projects.map((project) => (
        <div
          key={project.id}
          className="project-row"
          data-testid={`project-row-${project.id}`}
          onClick={() => onOpen(project.id)}
        >
          <span className="project-name" data-testid="project-name-open">
            {project.name}
          </span>
          <span className="project-meta">
            {project.mapCount} map{project.mapCount === 1 ? "" : "s"} ·{" "}
            {new Date(project.updatedAt).toLocaleString()}
          </span>
          {confirmDelete === project.id ? (
            <button
              type="button"
              className="btn danger"
              data-testid={`project-delete-confirm-${project.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(project.id);
                setConfirmDelete(null);
              }}
            >
              Confirm
            </button>
          ) : (
            <button
              type="button"
              className="btn danger"
              data-testid={`project-delete-${project.id}`}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmDelete(project.id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      ))}

      <h3>Import</h3>
      <div className="row">
        <button
          type="button"
          className="btn"
          data-testid="import-zip"
          onClick={() => zipInputRef.current?.click()}
        >
          Import ZIP…
        </button>
        <button
          type="button"
          className="btn"
          data-testid="import-folder"
          onClick={() => folderInputRef.current?.click()}
        >
          Import Folder…
        </button>
      </div>
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
        {...{ webkitdirectory: "", directory: "", multiple: true }}
        style={{ display: "none" }}
        onChange={(event) => {
          onImportFolder(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
