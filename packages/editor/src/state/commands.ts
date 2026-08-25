/**
 * Concrete editor commands (P2, docs/06-architecture.md §7 — Command pattern).
 *
 * Each factory builds an `EditorCommand` that mutates one map document through
 * the pure `map-ops` helpers. A command captures the *before* map from the
 * snapshot at `do` time and the *after* map produced by the op, so `undo` can
 * restore the exact prior document. Selection side-effects (e.g. selecting a
 * newly-placed event) are applied on `do` and reverted on `undo`.
 */
import type { MapData, MapEvent } from "@agenticrpg/core";
import type { EditorSnapshot } from "./editor-store.js";
import { replaceMap } from "./editor-store.js";
import type { EditorCommand } from "./command-stack.js";
import {
  addLayer,
  moveLayer,
  paintTiles,
  removeEvent,
  removeLayer,
  removeSwitch,
  removeVariable,
  renameLayer,
  setLayerVisibility,
  setSwitch,
  setVariable,
  type PaintCell,
  updateEvent,
  upsertEvent,
} from "../model/map-ops.js";

/** Selection side effects a command may carry. */
export interface CommandSelection {
  selectedLayerId?: string | null;
  selectedEventId?: string | null;
}

/**
 * A command that replaces one map document by the result of `transform`,
 * remembering the before/after maps for undo/redo.
 */
export class MapMutationCommand implements EditorCommand {
  private before: MapData | null = null;

  constructor(
    readonly label: string,
    private readonly mapId: string,
    private readonly transform: (map: MapData) => MapData,
    private readonly selection?: (map: MapData) => CommandSelection | undefined,
  ) {}

  do(snapshot: EditorSnapshot): EditorSnapshot {
    const before = snapshot.maps.find((m) => m.id === this.mapId);
    if (before === undefined) {
      return snapshot;
    }
    const after = this.transform(before);
    this.before = before;
    let next = replaceMap(snapshot, this.mapId, after);
    const sel = this.selection?.(after);
    if (sel !== undefined) {
      next = { ...next, ...sel };
    }
    return next;
  }

  undo(snapshot: EditorSnapshot): EditorSnapshot {
    if (this.before === null) {
      return snapshot;
    }
    return replaceMap(snapshot, this.mapId, this.before);
  }
}

/** A command that also carries an explicit selection for both directions. */
export class SelectionMapMutationCommand extends MapMutationCommand {
  constructor(
    label: string,
    mapId: string,
    transform: (map: MapData) => MapData,
    doSelection: CommandSelection,
  ) {
    super(label, mapId, transform, () => doSelection);
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Paint a set of cells onto a layer (single undoable gesture). */
export function paintCommand(
  mapId: string,
  layerId: string,
  cells: readonly PaintCell[],
): EditorCommand {
  return new MapMutationCommand(
    `paint ${cells.length} tile${cells.length === 1 ? "" : "s"}`,
    mapId,
    (map) => paintTiles(map, layerId, cells),
  );
}

/** Erase a set of cells (paint index 0). */
export function eraseCommand(
  mapId: string,
  layerId: string,
  cells: readonly { x: number; y: number }[],
): EditorCommand {
  return new MapMutationCommand(
    `erase ${cells.length} tile${cells.length === 1 ? "" : "s"}`,
    mapId,
    (map) =>
      paintTiles(
        map,
        layerId,
        cells.map((c) => ({ x: c.x, y: c.y, index: 0 })),
      ),
  );
}

/** Add a new layer and select it. */
export function addLayerCommand(mapId: string, id: string, name: string): EditorCommand {
  return new SelectionMapMutationCommand(
    `add layer "${name}"`,
    mapId,
    (map) => addLayer(map, { id, name }),
    {
      selectedLayerId: id,
    },
  );
}

/** Remove a layer (keeps at least one). */
export function removeLayerCommand(mapId: string, layerId: string): EditorCommand {
  return new MapMutationCommand(`remove layer "${layerId}"`, mapId, (map) =>
    removeLayer(map, layerId),
  );
}

/** Rename a layer. */
export function renameLayerCommand(mapId: string, layerId: string, name: string): EditorCommand {
  return new MapMutationCommand(`rename layer to "${name}"`, mapId, (map) =>
    renameLayer(map, layerId, name),
  );
}

/** Toggle a layer's visibility. */
export function setLayerVisibilityCommand(
  mapId: string,
  layerId: string,
  visible: boolean,
): EditorCommand {
  return new MapMutationCommand(visible ? "show layer" : "hide layer", mapId, (map) =>
    setLayerVisibility(map, layerId, visible),
  );
}

/** Reorder a layer (direction -1 = up, +1 = down). */
export function moveLayerCommand(mapId: string, layerId: string, direction: -1 | 1): EditorCommand {
  return new MapMutationCommand(direction < 0 ? "move layer up" : "move layer down", mapId, (map) =>
    moveLayer(map, layerId, direction),
  );
}

/** Place a new event and select it. */
export function addEventCommand(mapId: string, event: MapEvent): EditorCommand {
  return new SelectionMapMutationCommand(
    `place event "${event.name}"`,
    mapId,
    (map) => upsertEvent(map, event),
    {
      selectedEventId: event.id,
    },
  );
}

/** Update an event (name / position / pages / condition / commands). */
export function updateEventCommand(mapId: string, eventId: string, next: MapEvent): EditorCommand {
  return new MapMutationCommand(`edit event "${eventId}"`, mapId, (map) =>
    updateEvent(map, eventId, { ...next }),
  );
}

/** Remove an event. */
export function removeEventCommand(mapId: string, eventId: string): EditorCommand {
  return new MapMutationCommand(`remove event "${eventId}"`, mapId, (map) =>
    removeEvent(map, eventId),
  );
}

/** Set a variable's value. */
export function setVariableCommand(mapId: string, name: string, value: number): EditorCommand {
  return new MapMutationCommand(`set variable "${name}"`, mapId, (map) =>
    setVariable(map, name, value),
  );
}

/** Remove a variable. */
export function removeVariableCommand(mapId: string, name: string): EditorCommand {
  return new MapMutationCommand(`remove variable "${name}"`, mapId, (map) =>
    removeVariable(map, name),
  );
}

/** Set a switch's value. */
export function setSwitchCommand(mapId: string, name: string, value: boolean): EditorCommand {
  return new MapMutationCommand(`set switch "${name}"`, mapId, (map) =>
    setSwitch(map, name, value),
  );
}

/** Remove a switch. */
export function removeSwitchCommand(mapId: string, name: string): EditorCommand {
  return new MapMutationCommand(`remove switch "${name}"`, mapId, (map) => removeSwitch(map, name));
}
