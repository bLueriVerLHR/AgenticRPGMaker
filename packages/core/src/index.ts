/**
 * @agenticrpg/core — shared engine core (ADR-001).
 *
 * The single source of truth for the data model and versioned JSON schemas
 * (ADR-003), consumed by the editor, the runtime, and the protocol. This
 * package is deliberately dependency-free apart from the one documented
 * runtime dependency: zod (the schema-validation library chosen in ADR-003).
 *
 * It has zero DOM/browser dependencies and runs identically in Node (tests)
 * and the browser.
 */
import type { z } from "zod";

import {
  mapSchema,
  protocolEnvelopeSchema,
  projectSchema,
  saveSchema,
  tilesetSchema,
} from "./schema/index.js";
import { assertSchemaVersion, SCHEMA_VERSIONS } from "./version.js";

export * from "./version.js";
export * from "./schema/index.js";
export * from "./entity/index.js";
export * from "./events/index.js";
export * from "./behavior/index.js";
export * from "./scene/index.js";
export * from "./interpreter/index.js";
export * from "./protocol/index.js";

/** A readonly view of every canonical schema version (for tooling/debug). */
export const schemaVersions = SCHEMA_VERSIONS;

/**
 * Parse `input` against `schema`, failing fast with a readable error that
 * includes the schema name and, on version mismatch, a migration hint.
 *
 * This is the recommended entry point for loading versioned data at the
 * editor/runtime boundary (ADR-003 enforcement: validate on every load).
 */
export function parseWithSchema<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}

/**
 * Pre-parse version gate: read the `schemaVersion` (or protocol `v`) field
 * before full validation, so an unknown/newer format fails fast instead of
 * being silently misparsed. Returns the raw value for callers that need it.
 */
export function readSchemaVersion(input: unknown): number {
  if (typeof input !== "object" || input === null) {
    throw new Error("cannot read schemaVersion: expected a JSON object");
  }
  const candidate = (input as Record<string, unknown>).schemaVersion;
  if (typeof candidate !== "number") {
    throw new Error("cannot read schemaVersion: missing or non-integer schemaVersion field");
  }
  return candidate;
}

/** Version-gated map parse: rejects unknown/newer map formats before parsing. */
export function parseMapDocument(input: unknown) {
  assertSchemaVersion("map", readSchemaVersion(input));
  return mapSchema.parse(input);
}

/** Version-gated tileset parse. */
export function parseTilesetDocument(input: unknown) {
  assertSchemaVersion("tileset", readSchemaVersion(input));
  return tilesetSchema.parse(input);
}

/** Version-gated save parse. */
export function parseSaveDocument(input: unknown) {
  assertSchemaVersion("save", readSchemaVersion(input));
  return saveSchema.parse(input);
}

/** Version-gated project parse. */
export function parseProjectDocument(input: unknown) {
  assertSchemaVersion("project", readSchemaVersion(input));
  return projectSchema.parse(input);
}

/** Version-gated protocol message parse (checks `v`, not `schemaVersion`). */
export function parseProtocolMessage(input: unknown) {
  if (typeof input !== "object" || input === null) {
    throw new Error("cannot read protocol version: expected a JSON object");
  }
  const candidate = (input as Record<string, unknown>).v;
  if (typeof candidate !== "number") {
    throw new Error("cannot read protocol version: missing or non-integer v field");
  }
  assertSchemaVersion("protocol", candidate);
  return protocolEnvelopeSchema.parse(input);
}
