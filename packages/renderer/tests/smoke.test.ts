/**
 * Renderer smoke test (P0): the Renderer/TextureManager interface types and
 * the isRenderer guard are importable and behave minimally. Real backend
 * behavior is tested in P1b.
 */
import { describe, expect, it } from "vitest";

import { isRenderer } from "../src/index.js";

describe("@agenticrpg/renderer (P0 skeleton)", () => {
  it("rejects non-renderer values via isRenderer", () => {
    expect(isRenderer(null)).toBe(false);
    expect(isRenderer(undefined)).toBe(false);
    expect(isRenderer({})).toBe(false);
  });
});
