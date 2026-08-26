/**
 * Save format v2 (ADR-008 §7).
 *
 * The world-mode save: world id, player (chunk + tile + direction + HP), the
 * global variables/switches, and per-chunk deltas (defeated combatant ids).
 * Save v1 (`save.js`) stays untouched for the legacy single-map path; the
 * runtime storage adapter discriminates on the top-level `schemaVersion`.
 */
import { z } from "zod";

import { directionSchema } from "./save.js";

export const SAVE_V2_SCHEMA_VERSION = 2;

export const saveV2Schema = z.object({
  schemaVersion: z.literal(SAVE_V2_SCHEMA_VERSION),
  /** ISO-8601 timestamp of when the save was written. */
  savedAt: z.string().datetime(),
  /** The world the save belongs to (rejected on mismatch, ADR-008 §7). */
  worldId: z.string().min(1),
  player: z.object({
    /** The chunk the player stands in. */
    chunkId: z.string().min(1),
    /** Tile-space coordinates inside the chunk. */
    x: z.number(),
    y: z.number(),
    direction: directionSchema,
    /** Current HP (ADR-009 §5; restores to max on death respawn). */
    hp: z.number().positive().default(3),
  }),
  variables: z.record(z.string(), z.number()).default({}),
  switches: z.record(z.string(), z.boolean()).default({}),
  chunkState: z
    .record(
      z.string(),
      z.object({
        defeatedIds: z.array(z.string()).default([]),
      }),
    )
    .default({}),
});

export type SaveDataV2 = z.infer<typeof saveV2Schema>;
