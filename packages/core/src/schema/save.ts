/**
 * Save format v1 (ADR-003).
 *
 * A save is one self-describing JSON document: the current map id, the player's
 * position/direction, and the exact variable/switch state. Resuming a game is
 * deterministic from this single document — portable to IndexedDB (RQ1) or a
 * C++ local file.
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";

export const SAVE_SCHEMA_VERSION = SCHEMA_VERSIONS.save;

/** Player facing direction; a fixed token catalog shared by runtime + protocol. */
export const directionSchema = z.enum(["up", "down", "left", "right"]);

export const saveSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  /** ISO-8601 timestamp of when the save was written. */
  savedAt: z.string().datetime(),
  /** The map the player was on when the save was created. */
  mapId: z.string().min(1),
  player: z.object({
    /** Tile-space coordinates. */
    x: z.number(),
    y: z.number(),
    direction: directionSchema,
  }),
  variables: z.record(z.string(), z.number()).default({}),
  switches: z.record(z.string(), z.boolean()).default({}),
});

export type SaveData = z.infer<typeof saveSchema>;
export type Direction = z.infer<typeof directionSchema>;
