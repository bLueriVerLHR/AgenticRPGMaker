/**
 * Project tree (P2, ADR-006 §feature 4): maps / tilesets / global data.
 *
 * Global data maps to the current map's variables/switches — in the core v1
 * schema variables/switches live on the map document (core `GameState` model),
 * so "global data" is the current map's variables/switches (see report note).
 */
import type { EditorStore } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";

export function ProjectTree({
  store,
  onOpenVariables,
  onNewMap,
}: {
  store: EditorStore;
  onOpenVariables: () => void;
  onNewMap: () => void;
}): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);

  const handleNewMap = (): void => {
    onNewMap();
  };

  return (
    <div className="sidebar" data-testid="project-tree">
      <div className="tree-section">
        <h3>Maps</h3>
        {snapshot.maps.map((map) => (
          <div
            key={map.id}
            className={`tree-item${map.id === snapshot.currentMapId ? " active" : ""}`}
            data-testid={`tree-map-${map.id}`}
            onClick={() => store.set({ currentMapId: map.id, selectedEventId: null })}
          >
            <span className="tree-name">{map.name}</span>
          </div>
        ))}
        <button type="button" className="btn" data-testid="tree-new-map" onClick={handleNewMap}>
          + New Map
        </button>
      </div>

      <div className="tree-section">
        <h3>Assets</h3>
        <div className="tree-section">
          <h3>Tilesets</h3>
          {snapshot.tilesets.map((tileset) => (
            <div key={tileset.id} className="tree-item">
              <span className="tree-name">{tileset.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tree-section">
        <h3>Global Data</h3>
        <div className="tree-item" data-testid="tree-global-data" onClick={onOpenVariables}>
          <span className="tree-name">Variables / Switches</span>
        </div>
      </div>
    </div>
  );
}
