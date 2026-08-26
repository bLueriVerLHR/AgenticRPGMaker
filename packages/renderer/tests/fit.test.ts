/**
 * Registered-texture fit math tests (ADR-010 §4, S2).
 *
 * `fitInto` is the single module both backends share for CG still scaling, so
 * its cover/fit geometry carries the backend-parity burden: these cases pin
 * the numbers both backends must produce.
 */
import { describe, expect, it } from "vitest";

import { fitInto } from "../src/fit.js";

const DEST = { x: 0, y: 0, width: 320, height: 240 };

describe("fitInto", () => {
  it("cover: fills the dest, overflowing edges crop (square source)", () => {
    // 16x16 into 320x240 → scale 20 → 320x320, centered → top overflows by 40.
    const rect = fitInto({ sourceWidth: 16, sourceHeight: 16, dest: DEST, mode: "cover" });
    expect(rect).toEqual({ x: 0, y: -40, width: 320, height: 320 });
  });

  it("fit: letterboxes inside the dest (square source)", () => {
    // 16x16 into 320x240 → scale 15 → 240x240 centered horizontally.
    const rect = fitInto({ sourceWidth: 16, sourceHeight: 16, dest: DEST, mode: "fit" });
    expect(rect).toEqual({ x: 40, y: 0, width: 240, height: 240 });
  });

  it("fit: wide source letterboxes vertically", () => {
    // 32x16 into 320x240 → min(10, 15) = 10 → 320x160 centered vertically.
    const rect = fitInto({ sourceWidth: 32, sourceHeight: 16, dest: DEST, mode: "fit" });
    expect(rect).toEqual({ x: 0, y: 40, width: 320, height: 160 });
  });

  it("cover: tall source fills and overflows horizontally", () => {
    // 16x32 into 320x240 → max(20, 7.5) = 20 → 320x640 centered → x=0.
    const rect = fitInto({ sourceWidth: 16, sourceHeight: 32, dest: DEST, mode: "cover" });
    expect(rect).toEqual({ x: 0, y: -200, width: 320, height: 640 });
  });

  it("returns the dest unchanged for non-positive sources", () => {
    expect(fitInto({ sourceWidth: 0, sourceHeight: 16, dest: DEST, mode: "cover" })).toEqual(DEST);
    expect(fitInto({ sourceWidth: 16, sourceHeight: -1, dest: DEST, mode: "fit" })).toEqual(DEST);
  });

  it("rejects non-finite source dimensions", () => {
    expect(() =>
      fitInto({ sourceWidth: Number.NaN, sourceHeight: 16, dest: DEST, mode: "cover" }),
    ).toThrow(/finite/);
  });
});
