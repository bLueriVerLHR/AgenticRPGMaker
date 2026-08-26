/**
 * Registered-texture fit math (ADR-010 §4, S2).
 *
 * Pure, backend-shared geometry for `drawTexture`: given a source image size
 * and a destination rect, compute the scaled draw rect per fit mode. "cover"
 * fills the rect (edges overflow — the canvas clips them); "fit" letterboxes
 * inside it. Tests assert both modes and backend parity via this one module.
 */

/** A rectangle in pixels. */
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitInput {
  /** Source image size in pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** Destination rect to fit into, in pixels. */
  dest: FitRect;
  mode: "cover" | "fit";
}

/** Compute the centered draw rect that fits `source` into `dest` per `mode`. */
export function fitInto(input: FitInput): FitRect {
  if (!Number.isFinite(input.sourceWidth) || !Number.isFinite(input.sourceHeight)) {
    throw new Error("fit: expected finite source dimensions");
  }
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    return input.dest;
  }
  const scale =
    input.mode === "cover"
      ? Math.max(input.dest.width / input.sourceWidth, input.dest.height / input.sourceHeight)
      : Math.min(input.dest.width / input.sourceWidth, input.dest.height / input.sourceHeight);
  const width = input.sourceWidth * scale;
  const height = input.sourceHeight * scale;
  return {
    x: input.dest.x + (input.dest.width - width) / 2,
    y: input.dest.y + (input.dest.height - height) / 2,
    width,
    height,
  };
}
