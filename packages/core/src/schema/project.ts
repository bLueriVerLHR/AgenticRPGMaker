/**
 * Editor project format v1 (ADR-003, ADR-006).
 *
 * A project bundles everything the editor manages for one game: display
 * settings, the initial map, asset references, and optional open-editor state.
 * The editor stores projects in IndexedDB (D12) and imports/exports them as a
 * portable folder/zip package.
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";

export const PROJECT_SCHEMA_VERSION = SCHEMA_VERSIONS.project;

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  settings: z.object({
    display: z.object({
      /** Logical display resolution in pixels (scaled to the canvas). */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    /** Map loaded when the project boots (a map document id). */
    initialMap: z.string().min(1),
    /** Engine options (reserved, additive). */
    engineOptions: z.record(z.string(), z.unknown()).optional(),
  }),
  /** Asset manifest — references, not embedded content (v1). */
  assets: z.object({
    images: z.array(z.string()).default([]),
    audio: z.array(z.string()).default([]),
    tilesets: z.array(z.string()).default([]),
    maps: z.array(z.string()).default([]),
  }),
  /** Editor-only view state (camera, selection, ...); ignored by the runtime. */
  openEditorState: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectData = z.infer<typeof projectSchema>;
