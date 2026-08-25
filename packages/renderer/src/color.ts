/**
 * Color parsing helpers (P1b).
 *
 * Draw options carry `tint` as a CSS-ish string and `opacity` as a number.
 * Backends need normalized RGBA floats for vertex colors / alpha blending, so
 * parsing is centralized here as a pure, testable function.
 */

/** RGBA color with channels normalized to 0..1 (matches vertex color bytes). */
export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const WHITE_RGBA: ColorRGBA = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+)\s*)?\)$/i;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Convert an 8-bit channel (0..255) to a 0..1 float. */
function c255(value: number): number {
  return clamp01(value / 255);
}

function hexChannel(high: string, low: string): number {
  return parseInt(`${high}${low}`, 16);
}

/**
 * Parse a CSS-ish tint string into RGBA floats. Supported: `#rgb`, `#rrggbb`,
 * `rgb(r,g,b)` and `rgba(r,g,b,a)`. Unknown/empty input falls back to white so
 * a bad tint never breaks rendering (backends log the degradation instead).
 */
export function parseColor(tint: string | undefined, opacity = 1): ColorRGBA {
  const alpha = clamp01(opacity);
  if (tint === undefined || tint === "") {
    return { r: 1, g: 1, b: 1, a: alpha };
  }
  const hex = HEX_RE.exec(tint);
  if (hex !== null) {
    const raw = hex[1];
    if (raw !== undefined) {
      let r = 0;
      let g = 0;
      let b = 0;
      if (raw.length === 3) {
        r = hexChannel(raw[0] as string, raw[0] as string);
        g = hexChannel(raw[1] as string, raw[1] as string);
        b = hexChannel(raw[2] as string, raw[2] as string);
      } else {
        r = hexChannel(raw[0] as string, raw[1] as string);
        g = hexChannel(raw[2] as string, raw[3] as string);
        b = hexChannel(raw[4] as string, raw[5] as string);
      }
      return { r: c255(r), g: c255(g), b: c255(b), a: alpha };
    }
  }
  const rgb = RGB_RE.exec(tint);
  if (rgb !== null) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const a = rgb[4] === undefined ? alpha : clamp01(Number(rgb[4]) * alpha);
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a };
  }
  return { r: 1, g: 1, b: 1, a: alpha };
}
