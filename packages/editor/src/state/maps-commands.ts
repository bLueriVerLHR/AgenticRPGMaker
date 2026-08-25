/**
 * Map-list commands (P2, ADR-006): add / remove map documents.
 *
 * These operate on the map *list* rather than a single map's contents, so they
 * are separate from the `MapMutationCommand`s in `commands.ts`. Only the "add
 * map" command is exposed by the MVP UI; "remove map" is provided for
 * completeness but keeps the last map (core map list must never be empty).
 */
import type { MapData } from "@agenticrpg/core";
import type { EditorSnapshot } from "./editor-store.js";
import type { EditorCommand } from "./command-stack.js";

/** Add a new map document (selecting it). */
export function addMapCommand(mapId: string, map: MapData): EditorCommand {
  return {
    label: `add map "${map.name}"`,
    do(snapshot: EditorSnapshot): EditorSnapshot {
      if (snapshot.maps.some((m) => m.id === mapId)) {
        return snapshot;
      }
      return {
        ...snapshot,
        maps: [...snapshot.maps, map],
        currentMapId: mapId,
        selectedEventId: null,
      };
    },
    undo(snapshot: EditorSnapshot): EditorSnapshot {
      const maps = snapshot.maps.filter((m) => m.id !== mapId);
      const currentMapId =
        snapshot.currentMapId === mapId
          ? (maps[0]?.id ?? snapshot.currentMapId)
          : snapshot.currentMapId;
      return { ...snapshot, maps, currentMapId, selectedEventId: null };
    },
  };
}
