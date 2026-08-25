/**
 * Layers panel (P2, ADR-006 §feature 1): list, add/remove/rename/reorder
 * tile layers and toggle visibility. All mutations go through commands
 * (undoable) against the core model.
 */
import { useState } from "react";
import type { EditorStore } from "../state/editor-store.js";
import { currentMapOf } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";
import { isColliderLayer } from "../model/map-ops.js";
import {
  addLayerCommand,
  moveLayerCommand,
  removeLayerCommand,
  renameLayerCommand,
  setLayerVisibilityCommand,
} from "../state/commands.js";
import { newLayerId } from "../model/project.js";

export function LayersPanel({ store }: { store: EditorStore }): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const map = currentMapOf(snapshot);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleAdd = (): void => {
    const name = newName.trim() || `Layer ${map.layers.length + 1}`;
    const id = newLayerId(map.id, name);
    store.execute(addLayerCommand(map.id, id, name));
    setAdding(false);
    setNewName("");
  };

  const handleRename = (id: string): void => {
    const name = renameValue.trim();
    if (name !== "") {
      store.execute(renameLayerCommand(map.id, id, name));
    }
    setRenamingId(null);
  };

  return (
    <div className="panel" data-testid="layers-panel">
      <h3>Layers</h3>
      {map.layers.map((layer, index) => (
        <div
          key={layer.id}
          className={`layer-row${layer.id === snapshot.selectedLayerId ? " selected" : ""}`}
          data-testid={`layer-row-${layer.id}`}
          onClick={() => store.set({ selectedLayerId: layer.id })}
        >
          <input
            type="checkbox"
            checked={layer.visible}
            data-testid={`layer-visible-${layer.id}`}
            onChange={(event) =>
              store.execute(setLayerVisibilityCommand(map.id, layer.id, event.target.checked))
            }
            onClick={(event) => event.stopPropagation()}
            title="Visibility"
          />
          {renamingId === layer.id ? (
            <input
              type="text"
              value={renameValue}
              data-testid={`layer-rename-input-${layer.id}`}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleRename(layer.id);
                }
                if (event.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              onBlur={() => handleRename(layer.id)}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span
              className="layer-name"
              data-testid={`layer-name-${layer.id}`}
              onDoubleClick={() => {
                setRenamingId(layer.id);
                setRenameValue(layer.name);
              }}
            >
              {layer.name}
              {isColliderLayer(layer) ? " (collider)" : ""}
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Move up"
            data-testid={`layer-up-${layer.id}`}
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation();
              store.execute(moveLayerCommand(map.id, layer.id, -1));
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Move down"
            data-testid={`layer-down-${layer.id}`}
            disabled={index === map.layers.length - 1}
            onClick={(event) => {
              event.stopPropagation();
              store.execute(moveLayerCommand(map.id, layer.id, 1));
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Remove layer"
            data-testid={`layer-remove-${layer.id}`}
            disabled={map.layers.length <= 1}
            onClick={(event) => {
              event.stopPropagation();
              store.execute(removeLayerCommand(map.id, layer.id));
            }}
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <div className="row">
          <input
            type="text"
            value={newName}
            data-testid="layer-new-name"
            placeholder="Layer name"
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAdd();
              }
              if (event.key === "Escape") {
                setAdding(false);
              }
            }}
          />
          <button type="button" className="btn" data-testid="layer-add-confirm" onClick={handleAdd}>
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          data-testid="layer-add"
          onClick={() => setAdding(true)}
        >
          + Add Layer
        </button>
      )}
    </div>
  );
}
