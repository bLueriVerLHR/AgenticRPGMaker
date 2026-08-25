/**
 * Minimal 3x3 matrix helpers (P1b).
 *
 * Matrices are column-major `Float32Array(9)`, matching GLSL `mat3` layout so
 * the result can be handed straight to `uniformMatrix3fv`. Only the affine 2D
 * operations the renderer needs are implemented (orthographic projection,
 * translation/scale/rotation). Typed-array storage also sidesteps
 * `noUncheckedIndexedAccess` noise in the hot path.
 */

/** 3x3 column-major matrix (9 elements). */
export type Mat3 = Float32Array;

export function mat3Identity(): Mat3 {
  const m = new Float32Array(9);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
}

/** Returns `a * b` (apply `b` first). */
export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        // Array elements are always present (Mat3 is always length 9); the
        // `?? 0` only satisfies noUncheckedIndexedAccess.
        sum += (a[k * 3 + row] ?? 0) * (b[col * 3 + k] ?? 0);
      }
      out[col * 3 + row] = sum;
    }
  }
  return out;
}

export function mat3Translation(tx: number, ty: number): Mat3 {
  const m = mat3Identity();
  m[6] = tx;
  m[7] = ty;
  return m;
}

export function mat3Scale(sx: number, sy: number): Mat3 {
  const m = mat3Identity();
  m[0] = sx;
  m[4] = sy;
  return m;
}

export function mat3Rotation(radians: number): Mat3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = mat3Identity();
  m[0] = c;
  m[1] = s;
  m[3] = -s;
  m[4] = c;
  return m;
}

/**
 * Orthographic projection mapping `[left,right] x [top,bottom]` to NDC.
 * Pass `bottom > top` (e.g. `(0, w, h, 0)`) for the screen convention where y
 * increases downward — the standard 2D setup.
 */
export function mat3Ortho(left: number, right: number, bottom: number, top: number): Mat3 {
  const m = mat3Identity();
  const rl = right - left;
  const tb = top - bottom;
  m[0] = 2 / rl;
  m[4] = 2 / tb;
  m[6] = -(right + left) / rl;
  m[7] = -(top + bottom) / tb;
  return m;
}

/** Transform a 2D point by a matrix; returns `[x, y]`. */
export function mat3TransformPoint(m: Mat3, x: number, y: number): [number, number] {
  const nx = (m[0] ?? 0) * x + (m[3] ?? 0) * y + (m[6] ?? 0);
  const ny = (m[1] ?? 0) * x + (m[4] ?? 0) * y + (m[7] ?? 0);
  return [nx, ny];
}
