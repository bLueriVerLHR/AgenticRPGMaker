/**
 * Runtime smoke test (P0): the boot seam is a stub that throws at call time
 * (not import time), and the Transport interface is importable. Real boot and
 * the WebSocket transport are P1c.
 */
import { describe, expect, it } from "vitest";

import { boot } from "../src/index.js";

describe("@agenticrpg/runtime (P0 skeleton)", () => {
  it("exports a boot seam that throws not-implemented at call time", () => {
    // Minimal DOM-free options — the seam should not run any browser code.
    expect(() =>
      boot({
        canvas: {} as HTMLCanvasElement,
        renderer: {} as never,
        dataUrl: "data/",
      }),
    ).toThrowError(/not implemented yet \(P1c\)/);
  });
});
