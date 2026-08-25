/**
 * Editor smoke test (P0): the package and its React entry are resolvable in the
 * test runner. Real editor component tests arrive in P2.
 */
import { describe, expect, it } from "vitest";

describe("@agenticrpg/editor (P0 skeleton)", () => {
  it("baseline test runner is green", () => {
    expect(1 + 1).toBe(2);
  });
});
