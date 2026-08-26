/**
 * World format v1 (ADR-008).
 *
 * A world is a manifest, not the play field itself: a chunk grid whose
 * payloads are legal map-v1 documents (ADR-003) referenced by file path,
 * combat data in the world layer (map v1 stays untouched — ADR-009), the
 * player spawn, and the global variables/switches store. How chunks are
 * fetched/resident is the runtime chunk pool's business (ADR-008 §4); this
 * schema only claims layout + validation.
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";
import { directionSchema } from "./save.js";
import { eventCommandSchema } from "./map.js";

export const WORLD_SCHEMA_VERSION = SCHEMA_VERSIONS.world;

/** One combatant placed in a chunk (world layer — ADR-009 §5). */
export const worldCombatantSchema = z.object({
  id: z.string().min(1),
  /** Combat type key into the world's `combatTypes` table. */
  type: z.string().min(1),
  /** Local tile coordinates inside the chunk. */
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  /** Optional global switch set to true when this combatant is defeated. */
  onDefeatSwitch: z.string().min(1).optional(),
});

/** Combat tuning per type (ADR-009 §5: HP, contact damage, behavior, speed). */
export const combatTypeSchema = z.object({
  hp: z.number().positive(),
  damage: z.number().positive(),
  behavior: z.enum(["chase", "turret"]),
  /** Movement in tile-steps per second (0 = stationary, e.g. turret). */
  speed: z.number().min(0),
  /**
   * Chebyshev aggro range in tiles: a chaser only pursues/contacts the player
   * within this distance (leash — otherwise a long overland walk would get
   * worn down by a cross-chunk chase). Turrets are unaffected (their shot
   * range is PROJECTILE_MAX_TILES).
   */
  aggroRange: z.number().int().positive().optional(),
});

export const worldChunkSchema = z.object({
  id: z.string().min(1),
  /** File path of the map-v1 chunk document, e.g. "data/chunks/ch_village.json". */
  file: z.string().min(1),
  /** Grid cell of this chunk (col = floor(x / chunkSize)). */
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  combatants: z.array(worldCombatantSchema).default([]),
});

export const worldSchema = z
  .object({
    schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    /** Chunk edge length in tiles. */
    chunkSize: z.number().int().positive(),
    grid: z.object({
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    chunks: z.array(worldChunkSchema).min(1),
    combatTypes: z.record(z.string(), combatTypeSchema).default({}),
    spawn: z.object({
      chunkId: z.string().min(1),
      /** Global tile coordinates of the spawn point. */
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      direction: directionSchema,
    }),
    tilesets: z.array(z.string().min(1)).min(1),
    global: z
      .object({
        variables: z.record(z.string(), z.number()).default({}),
        switches: z.record(z.string(), z.boolean()).default({}),
      })
      .default({ variables: {}, switches: {} }),
    /**
     * Optional opening narrative: event commands (ADR-010 presentation
     * commands plus setVariable/setSwitch) run once at world enter when the
     * `sw_intro_done` switch is false — the demo's opening CG lives here.
     */
    intro: z.array(eventCommandSchema).default([]),
  })
  .refine(
    (w) => {
      const ids = new Set<string>();
      const cells = new Set<string>();
      for (const chunk of w.chunks) {
        if (ids.has(chunk.id)) {
          return false;
        }
        ids.add(chunk.id);
        const cellKey = `${chunk.col}:${chunk.row}`;
        if (cells.has(cellKey)) {
          return false;
        }
        cells.add(cellKey);
        if (chunk.col >= w.grid.cols || chunk.row >= w.grid.rows) {
          return false;
        }
      }
      return true;
    },
    { message: "chunk ids and grid cells must be unique and inside the grid", path: ["chunks"] },
  )
  .refine((w) => w.chunks.length === w.grid.cols * w.grid.rows, {
    message: "the chunk list must cover the whole grid (cols × rows entries)",
    path: ["chunks"],
  })
  .refine((w) => w.chunks.some((chunk) => chunk.id === w.spawn.chunkId), {
    message: "spawn.chunkId must reference a listed chunk",
    path: ["spawn", "chunkId"],
  })
  .refine(
    (w) =>
      w.chunks.every((chunk) =>
        chunk.combatants.every((e) => e.x < w.chunkSize && e.y < w.chunkSize),
      ),
    {
      message: "combatant coordinates must be inside the chunk (0..chunkSize-1)",
      path: ["chunks"],
    },
  );

export type WorldData = z.infer<typeof worldSchema>;
export type WorldChunk = z.infer<typeof worldChunkSchema>;
export type WorldCombatant = z.infer<typeof worldCombatantSchema>;
export type CombatType = z.infer<typeof combatTypeSchema>;
