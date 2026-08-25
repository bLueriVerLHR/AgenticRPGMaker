/**
 * Map format v1 (ADR-003).
 *
 * A map is the playable world: dimensions, a tileset reference, tile layers
 * (rows x cols of tile indices), placed events (pages with a condition and an
 * ordered command list), and the shared variables/switches state used by event
 * conditions.
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";

export const MAP_SCHEMA_VERSION = SCHEMA_VERSIONS.map;

/** One event command line, e.g. `{ cmd: "showText", args: ["Welcome!"] }`. */
export const eventCommandSchema = z.object({
  cmd: z.string().min(1),
  /** Command-specific arguments; interpreted by the core event interpreter. */
  args: z.array(z.unknown()).default([]),
});

/** Event page condition: a switch check, or `null` = always active. */
export const eventPageConditionSchema = z
  .object({
    switchId: z.string().min(1),
    value: z.boolean(),
  })
  .nullable();

/** One event page: an optional condition and an ordered command list. */
export const eventPageSchema = z.object({
  condition: eventPageConditionSchema,
  commands: z.array(eventCommandSchema),
});

/** A placed map event (NPC, trigger, ...). */
export const mapEventSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Tile coordinates in map space. */
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  /** Sprite/texture reference (optional in v1). */
  sprite: z.string().optional(),
  pages: z.array(eventPageSchema).min(1),
});

/** A tile layer: `data` is exactly `height` rows of `width` tile indices. */
export const tileLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.literal("tile"),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  /** Tile indices into the referenced tileset (0 = empty/transparent). */
  data: z.array(z.array(z.number().int().nonnegative())).min(1),
});

const baseMapSchema = z.object({
  schemaVersion: z.literal(MAP_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Tile size in pixels (both width and height of one tile). */
  tileSize: z.number().int().positive(),
  /** Map dimensions in tiles. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Reference to a tileset document (ADR-003), e.g. "tilesets/grassland". */
  tileset: z.string().min(1),
  layers: z.array(tileLayerSchema).min(1),
  events: z.array(mapEventSchema).default([]),
  variables: z.record(z.string(), z.number()).default({}),
  switches: z.record(z.string(), z.boolean()).default({}),
});

/**
 * Map v1 — the canonical map format. Cross-field refine enforces the ADR-003
 * requirement that every tile layer's `data` is exactly `height` rows of
 * `width` integers at load time.
 */
export const mapSchema = baseMapSchema.refine(
  (m) =>
    m.layers.every(
      (layer) =>
        layer.type !== "tile" ||
        (layer.data.length === m.height && layer.data.every((row) => row.length === m.width)),
    ),
  {
    message: "tile layer data must have exactly height rows of width tile indices",
    path: ["layers"],
  },
);

export type MapData = z.infer<typeof mapSchema>;
export type TileLayer = z.infer<typeof tileLayerSchema>;
export type MapEvent = z.infer<typeof mapEventSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;
export type EventPageCondition = z.infer<typeof eventPageConditionSchema>;
export type EventCommand = z.infer<typeof eventCommandSchema>;
