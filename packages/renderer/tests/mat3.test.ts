/**
 * Matrix helper tests (P1b) — pure math used by the WebGL projection and the
 * transform stack.
 */
import { describe, expect, it } from "vitest";

import {
  mat3Identity,
  mat3Multiply,
  mat3Ortho,
  mat3Rotation,
  mat3Scale,
  mat3TransformPoint,
  mat3Translation,
} from "../src/math/mat3.js";

describe("mat3 helpers", () => {
  it("identity leaves points unchanged", () => {
    const [x, y] = mat3TransformPoint(mat3Identity(), 3, 4);
    expect(x).toBeCloseTo(3);
    expect(y).toBeCloseTo(4);
  });

  it("translation moves points", () => {
    const [x, y] = mat3TransformPoint(mat3Translation(10, 20), 1, 2);
    expect(x).toBeCloseTo(11);
    expect(y).toBeCloseTo(22);
  });

  it("scale multiplies points", () => {
    const [x, y] = mat3TransformPoint(mat3Scale(2, 3), 4, 5);
    expect(x).toBeCloseTo(8);
    expect(y).toBeCloseTo(15);
  });

  it("rotation rotates 90 degrees", () => {
    const [x, y] = mat3TransformPoint(mat3Rotation(Math.PI / 2), 1, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
  });

  it("multiplication composes right-to-left", () => {
    // translate(10,0) * scale(2,1): p -> scale -> translate
    const m = mat3Multiply(mat3Translation(10, 0), mat3Scale(2, 1));
    const [x, y] = mat3TransformPoint(m, 3, 1);
    expect(x).toBeCloseTo(16);
    expect(y).toBeCloseTo(1);
  });

  it("ortho maps the screen box to NDC", () => {
    // screen convention: y increases downward
    const m = mat3Ortho(0, 320, 240, 0);
    const [tlX, tlY] = mat3TransformPoint(m, 0, 0);
    const [brX, brY] = mat3TransformPoint(m, 320, 240);
    const [cX, cY] = mat3TransformPoint(m, 160, 120);
    expect(tlX).toBeCloseTo(-1);
    expect(tlY).toBeCloseTo(1);
    expect(brX).toBeCloseTo(1);
    expect(brY).toBeCloseTo(-1);
    expect(cX).toBeCloseTo(0);
    expect(cY).toBeCloseTo(0);
  });
});
