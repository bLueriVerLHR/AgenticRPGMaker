/**
 * Tileset format v1 (ADR-003).
 *
 * A tileset describes a tile atlas image plus per-tile metadata: collision
 * flags, optional animation frames, and autotile rules. Tile indices used in a
 * map's layers index into this tileset.
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";

export const TILESET_SCHEMA_VERSION = SCHEMA_VERSIONS.tileset;

/** An animated tile: `frames` are tile indices cycled at `speed` fps. */
export const tilesetAnimationSchema = z.object({
  firstTile: z.number().int().nonnegative(),
  frames: z.array(z.number().int().nonnegative()).min(1),
  speed: z.number().positive().optional(),
});

export const tilesetSchema = z.object({
  schemaVersion: z.literal(TILESET_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Atlas image reference, e.g. "tilesets/grassland". */
  image: z.string().min(1),
  /** Tile size in pixels (matches the map's tileSize). */
  tileSize: z.number().int().positive(),
  /** Grid dimensions of the atlas in tiles. */
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  /** Per-tile collision flags, ordered by tile index (optional in v1). */
  collisions: z.array(z.boolean()).optional(),
  animations: z.array(tilesetAnimationSchema).optional(),
  autotileRules: z.array(z.unknown()).optional(),
});

export type TilesetData = z.infer<typeof tilesetSchema>;
export type TilesetAnimation = z.infer<typeof tilesetAnimationSchema>;