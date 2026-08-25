/**
 * Variables / switches panel (P2, ADR-006 §feature 5).
 *
 * The editor edits the current map's variables/switches — the core `GameState`
 * model (packages/core/src/interpreter/game-state.ts) that event conditions
 * evaluate. All mutations go through commands (undoable) against the core map
 * document, keeping core as the single source of truth.
 */
import { useState } from "react";
import type { EditorStore } from "../state/editor-store.js";
import { currentMapOf } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";
import {
  removeSwitchCommand,
  removeVariableCommand,
  setSwitchCommand,
  setVariableCommand,
} from "../state/commands.js";

export function VariablesPanel({ store }: { store: EditorStore }): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const map = currentMapOf(snapshot);
  const [newName, setNewName] = useState("");
  const [addKind, setAddKind] = useState<"variable" | "switch">("variable");

  const variableNames = Object.keys(map.variables);
  const switchNames = Object.keys(map.switches);

  const handleAdd = (): void => {
    const name = newName.trim();
    if (name === "") {
      return;
    }
    if (addKind === "variable") {
      if (!variableNames.includes(name)) {
        store.execute(setVariableCommand(map.id, name, 0));
      }
    } else if (!switchNames.includes(name)) {
      store.execute(setSwitchCommand(map.id, name, false));
    }
    setNewName("");
  };

  return (
    <div className="panel" data-testid="variables-panel">
      <h3>Variables</h3>
      {variableNames.length === 0 && <div className="empty">No variables yet.</div>}
      {variableNames.map((name) => (
        <div className="row" key={name} data-testid={`variable-row-${name}`}>
          <label>{name}</label>
          <input
            type="number"
            defaultValue={map.variables[name]}
            data-testid={`variable-value-${name}`}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (value !== map.variables[name]) {
                store.execute(setVariableCommand(map.id, name, value));
              }
            }}
          />
          <button
            type="button"
            className="icon-btn"
            title="Remove variable"
            data-testid={`variable-remove-${name}`}
            onClick={() => store.execute(removeVariableCommand(map.id, name))}
          >
            ✕
          </button>
        </div>
      ))}

      <h3>Switches</h3>
      {switchNames.length === 0 && <div className="empty">No switches yet.</div>}
      {switchNames.map((name) => (
        <div className="row" key={name} data-testid={`switch-row-${name}`}>
          <label>{name}</label>
          <input
            type="checkbox"
            checked={map.switches[name]}
            data-testid={`switch-value-${name}`}
            onChange={(event) =>
              store.execute(setSwitchCommand(map.id, name, event.target.checked))
            }
          />
          <button
            type="button"
            className="icon-btn"
            title="Remove switch"
            data-testid={`switch-remove-${name}`}
            onClick={() => store.execute(removeSwitchCommand(map.id, name))}
          >
            ✕
          </button>
        </div>
      ))}

      <h3>Add</h3>
      <div className="row">
        <select
          value={addKind}
          data-testid="add-kind"
          onChange={(event) => setAddKind(event.target.value as "variable" | "switch")}
        >
          <option value="variable">Variable</option>
          <option value="switch">Switch</option>
        </select>
      </div>
      <div className="row">
        <input
          type="text"
          value={newName}
          placeholder="name"
          data-testid="add-name"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleAdd();
            }
          }}
        />
        <button type="button" className="btn" data-testid="add-confirm" onClick={handleAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
