/**
 * Versioned-data-format helpers (ADR-003).
 *
 * Every game data format carries a top-level `schemaVersion` integer; the
 * protocol carries a top-level `v` (ADR-004). A reader must know which schema
 * it is looking at BEFORE parsing anything else, so an unknown/newer version
 * fails fast with a clear error — never a silent misparse.
 */

/** Canonical schema versions, one per data format, keyed by format name. */
export const SCHEMA_VERSIONS = {
  map: 1,
  tileset: 1,
  save: 1,
  project: 1,
  protocol: 1,
  world: 1,
} as const;

export type SchemaName = keyof typeof SCHEMA_VERSIONS;

/** The current protocol version carried in every protocol message (`v`). */
export const PROTOCOL_VERSION = 1;

/**
 * Throws a readable error when `actual` does not match the canonical version
 * of `name`. Used by validation paths to fail fast on unknown/newer schemas.
 */
export function assertSchemaVersion(name: SchemaName, actual: number): void {
  const expected = SCHEMA_VERSIONS[name];
  if (actual !== expected) {
    throw new Error(
      `unsupported ${name} schemaVersion ${actual}: this build supports v${expected}. ` +
        `Refusing to parse a file with an unknown or newer format.`,
    );
  }
}

/** Type of the leading `schemaVersion` field shared by all data formats. */
export type VersionedDocument = { schemaVersion: number };
