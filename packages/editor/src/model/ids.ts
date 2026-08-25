/**
 * Identifier helpers for the editor (ADR-006).
 *
 * Map/event/layer/project ids are strings that must satisfy the core schema's
 * `min(1)` constraints. `newId` produces deterministic-enough, collision-free
 * ids using the platform crypto RNG when available and a random fallback
 * otherwise (tests, older browsers).
 */

/** Generate a prefixed id, e.g. `newId("map")` → "map_k3j9f2…". */
export function newId(prefix: string): string {
  const rand = randomSuffix();
  return `${prefix}_${rand}`;
}

function randomSuffix(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c !== undefined && typeof c.randomUUID === "function") {
    return c.randomUUID().replaceAll("-", "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}
