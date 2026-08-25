/**
 * Public barrel for all versioned data schemas (ADR-003).
 *
 * Every schema exports the zod schema, a `*_SCHEMA_VERSION` constant, and the
 * inferred TS types. Editor, runtime, and tests import these — never a
 * duplicated local declaration (no type drift).
 */
export * from "./map.js";
export * from "./tileset.js";
export * from "./save.js";
export * from "./project.js";
export * from "./protocol.js";
