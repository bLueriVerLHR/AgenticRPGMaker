/**
 * Pure map mutations (P2, ADR-006; single source of truth in `packages/core`).
 *
 * Every editor operation on a map is implemented here as a *pure* function:
 * given a core `MapData` document it returns a *new* `MapData` document
 * (immutable-style updates, no in-place mutation). Because the editor holds no
 * second copy of the world (docs/06-architecture.md §4), these helpers are the
 * only way the map changes; each result is validated against the core `mapSchema`
 * by the editor store before it is committed.
 *
 * All structural invariants of ADR-003 are preserved: layer `data` stays
 * exactly `height` rows of `width` tile indices, layer ids are unique, and
 * event pages keep `min(1)` pages.
 */
import type { EventCommand, EventPage, MapData, MapEvent, TileLayer } from "@agenticrpg/core";
import { MAP_SCHEMA_VERSION, mapSchema } from "@agenticrpg/core";

/** A painted cell: tile coordinates plus the tile index to write. */
export interface PaintCell {
  x: number;
  y: number;
  index: number;
}

export interface CreateMapOptions {
  id: string;
  name: string;
  width?: number;
  height?: number;
  tileSize?: number;
  tileset?: string;
}

/** A layer name that marks collider tiles (sample-map convention). */
export const COLLIDER_LAYER_PATTERN = /collider/i;

/**
 * Validate a map document against the core schema, throwing with a readable
 * message on failure (ADR-003 enforcement: validate on every boundary).
 */
export function validateMap(map: MapData): MapData {
  const result = mapSchema.safeParse(map);
  if (!result.success) {
    throw new Error(`invalid map "${map.id}": ${result.error.message}`);
  }
  return result.data;
}

/** Create a fresh empty map with a ground layer and a hidden collider layer. */
export function createMap(options: CreateMapOptions): MapData {
  const width = options.width ?? 16;
  const height = options.height ?? 12;
  const tileSize = options.tileSize ?? 16;
  const tileset = options.tileset ?? "tilesets/placeholder";
  return validateMap({
    schemaVersion: MAP_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    tileSize,
    width,
    height,
    tileset,
    layers: [
      createTileLayer({ id: `${options.id}_ground`, name: "Ground", width, height, visible: true }),
      createTileLayer({
        id: `${options.id}_colliders`,
        name: "Colliders",
        width,
        height,
        visible: false,
      }),
    ],
    events: [],
    variables: {},
    switches: {},
  });
}

/** Build a tile layer whose `data` is `height` rows of `width` zeros. */
export function createTileLayer(input: {
  id: string;
  name: string;
  width: number;
  height: number;
  visible?: boolean;
  opacity?: number;
}): TileLayer {
  return {
    id: input.id,
    name: input.name,
    type: "tile",
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    data: Array.from({ length: input.height }, () => Array.from({ length: input.width }, () => 0)),
  };
}

/** True when a layer is the collider layer (by id or name). */
export function isColliderLayer(layer: TileLayer): boolean {
  return COLLIDER_LAYER_PATTERN.test(layer.id) || COLLIDER_LAYER_PATTERN.test(layer.name);
}

// ---------------------------------------------------------------------------
// Tile layers
// ---------------------------------------------------------------------------

/**
 * Paint a set of cells on a layer. Cells outside the map or on an unknown
 * layer are ignored; out-of-range tile indices are ignored (kept 0).
 */
export function paintTiles(map: MapData, layerId: string, cells: readonly PaintCell[]): MapData {
  const layer = findLayer(map, layerId);
  if (layer === undefined) {
    return map;
  }
  const clamped = cells.filter(
    (cell) =>
      cell.x >= 0 &&
      cell.x < map.width &&
      cell.y >= 0 &&
      cell.y < map.height &&
      Number.isInteger(cell.index) &&
      cell.index >= 0,
  );
  if (clamped.length === 0) {
    return map;
  }
  const byCell = new Map<string, number>();
  for (const cell of clamped) {
    byCell.set(`${cell.x},${cell.y}`, cell.index);
  }
  const data = layer.data.map((row, y) => row.map((value, x) => byCell.get(`${x},${y}`) ?? value));
  return replaceLayer(map, layerId, { ...layer, data });
}

/** Erase a set of cells (paint tile index 0 = empty). */
export function eraseTiles(
  map: MapData,
  layerId: string,
  cells: readonly { x: number; y: number }[],
): MapData {
  return paintTiles(
    map,
    layerId,
    cells.map((c) => ({ x: c.x, y: c.y, index: 0 })),
  );
}

/** Add a new empty layer at the end of the layer stack. */
export function addLayer(
  map: MapData,
  input: { id: string; name: string; visible?: boolean },
): MapData {
  const layer = createTileLayer({
    id: input.id,
    name: input.name,
    width: map.width,
    height: map.height,
    visible: input.visible ?? true,
  });
  return validateMap({ ...map, layers: [...map.layers, layer] });
}

/** Remove a layer by id (keeps at least one layer). */
export function removeLayer(map: MapData, layerId: string): MapData {
  if (map.layers.length <= 1) {
    return map;
  }
  return validateMap({ ...map, layers: map.layers.filter((l) => l.id !== layerId) });
}

/** Rename a layer by id. */
export function renameLayer(map: MapData, layerId: string, name: string): MapData {
  const layer = findLayer(map, layerId);
  if (layer === undefined) {
    return map;
  }
  return replaceLayer(map, layerId, { ...layer, name });
}

/** Set a layer's visibility. */
export function setLayerVisibility(map: MapData, layerId: string, visible: boolean): MapData {
  const layer = findLayer(map, layerId);
  if (layer === undefined) {
    return map;
  }
  return replaceLayer(map, layerId, { ...layer, visible });
}

/** Reorder a layer by one position (`direction` = -1 up / +1 down). */
export function moveLayer(map: MapData, layerId: string, direction: -1 | 1): MapData {
  const index = map.layers.findIndex((l) => l.id === layerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= map.layers.length) {
    return map;
  }
  const layers = [...map.layers];
  const [moved] = layers.splice(index, 1);
  if (moved === undefined) {
    return map;
  }
  layers.splice(target, 0, moved);
  return validateMap({ ...map, layers });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Add an event, or replace the event with the same id. */
export function upsertEvent(map: MapData, event: MapEvent): MapData {
  const exists = map.events.some((e) => e.id === event.id);
  const events = exists
    ? map.events.map((e) => (e.id === event.id ? event : e))
    : [...map.events, event];
  return validateMap({ ...map, events });
}

/** Remove an event by id. */
export function removeEvent(map: MapData, eventId: string): MapData {
  return validateMap({ ...map, events: map.events.filter((e) => e.id !== eventId) });
}

/** Update an event by id (partial patch applied immutably). */
export function updateEvent(map: MapData, eventId: string, patch: Partial<MapEvent>): MapData {
  const event = map.events.find((e) => e.id === eventId);
  if (event === undefined) {
    return map;
  }
  return upsertEvent(map, { ...event, ...patch });
}

// ---------------------------------------------------------------------------
// Variables / switches (per-map, core GameState model)
// ---------------------------------------------------------------------------

/** Set a variable's value. */
export function setVariable(map: MapData, name: string, value: number): MapData {
  return validateMap({ ...map, variables: { ...map.variables, [name]: value } });
}

/** Remove a variable by name. */
export function removeVariable(map: MapData, name: string): MapData {
  const variables = { ...map.variables };
  delete variables[name];
  return validateMap({ ...map, variables });
}

/** Set a switch's value. */
export function setSwitch(map: MapData, name: string, value: boolean): MapData {
  return validateMap({ ...map, switches: { ...map.switches, [name]: value } });
}

/** Remove a switch by name. */
export function removeSwitch(map: MapData, name: string): MapData {
  const switches = { ...map.switches };
  delete switches[name];
  return validateMap({ ...map, switches });
}

// ---------------------------------------------------------------------------
// Event page / command editing (pure helpers used by the event panel)
// ---------------------------------------------------------------------------

/** Append a command to an event page. */
export function addCommandToPage(page: EventPage, command: EventCommand): EventPage {
  return { ...page, commands: [...page.commands, command] };
}

/** Remove a command from an event page by index. */
export function removeCommandFromPage(page: EventPage, index: number): EventPage {
  return { ...page, commands: page.commands.filter((_, i) => i !== index) };
}

/** Replace a command in an event page by index. */
export function updateCommandInPage(
  page: EventPage,
  index: number,
  command: EventCommand,
): EventPage {
  return {
    ...page,
    commands: page.commands.map((c, i) => (i === index ? command : c)),
  };
}

/** Move a command within a page (indices clamped to valid range). */
export function moveCommandInPage(page: EventPage, from: number, to: number): EventPage {
  const commands = [...page.commands];
  const target = Math.max(0, Math.min(to, commands.length - 1));
  if (from < 0 || from >= commands.length || from === target) {
    return page;
  }
  const [moved] = commands.splice(from, 1);
  if (moved === undefined) {
    return page;
  }
  commands.splice(target, 0, moved);
  return { ...page, commands };
}

/** Set a page's condition (null = always active). */
export function setPageCondition(page: EventPage, condition: EventPage["condition"]): EventPage {
  return { ...page, condition };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function findLayer(map: MapData, layerId: string): TileLayer | undefined {
  return map.layers.find((l) => l.id === layerId);
}

function replaceLayer(map: MapData, layerId: string, layer: TileLayer): MapData {
  return validateMap({
    ...map,
    layers: map.layers.map((l) => (l.id === layerId ? layer : l)),
  });
}
