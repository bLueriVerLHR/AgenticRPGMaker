/**
 * Composed mini-sprite tests (playtest feedback: "everything is an abstract
 * colored square"). The sprites must render as recognizable rect
 * compositions — anchored inside/at their tile, palette-stable, integer-
 * pixel-crisp — and never draw outside the renderer seam.
 */
import { describe, expect, it } from "vitest";

import type { Renderer } from "@agenticrpg/renderer";

import { StubRenderer } from "./helpers.js";
import {
  drawBeacon,
  drawChest,
  drawHero,
  drawSignpost,
  drawSlime,
  drawTurret,
  drawVillager,
} from "../src/world-sprites.js";

const S = 16; // standard test tile size

/** All recorded drawRect rects. */
function rects(renderer: StubRenderer): Array<[number, number, number, number, string]> {
  return renderer.calls
    .filter((c): c is { method: "drawRect"; args: unknown[] } => c.method === "drawRect")
    .map((c) => c.args as [number, number, number, number, string]);
}

expect.extend({
  toDrawWithin(
    received: ReturnType<typeof rects>,
    bounds: { x: number; y: number; w: number; h: number },
  ) {
    const outside = received.filter(
      ([x, y, w, h]) =>
        x < bounds.x ||
        y < bounds.y - 32 || // ~1 tile of headroom is fine (sprites are taller than wide)
        x + w > bounds.x + bounds.w + 1 || // ±1 px rounding tolerance on the right/bottom
        y + h > bounds.y + bounds.h + 4,
    );
    return {
      pass: outside.length === 0,
      message: () =>
        `expected all rects within ${JSON.stringify(bounds)}; ${outside.length} outside (first: ${JSON.stringify(outside[0] ?? null)})`,
    };
  },
});

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the vitest matcher augmentation requires any
  interface Assertion<T = any> {
    toDrawWithin(bounds: { x: number; y: number; w: number; h: number }): T;
  }
}

describe("world-sprites", () => {
  it("hero draws a composition anchored in its tile with headroom above", () => {
    const r = new StubRenderer();
    drawHero(r, 0, 0, S);
    const calls = rects(r);
    expect(calls.length).toBeGreaterThan(6); // legs, tunic, belt, sword, head, hair, eyes…
    // Head/hair sit high in the tile (compact humanoid silhouette).
    expect(calls.some(([, y]) => y >= 0 && y <= S * 0.2)).toBe(true);
    expect(calls).toDrawWithin({ x: 0, y: 0, w: S, h: S });
    // Integer pixels everywhere (crisp art).
    for (const [x, y] of calls) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  it("hit flash replaces the hero body with a full red tile", () => {
    const r = new StubRenderer();
    drawHero(r, 32, 48, S, { flashing: true });
    const calls = rects(r);
    expect(calls).toContainEqual([32, 48, S, S, "#ff5252"]);
  });

  it("villagers differ by role tint but share the same layout budget", () => {
    const elder = new StubRenderer();
    drawVillager(elder, 0, 0, S, "characters/elder");
    const smith = new StubRenderer();
    drawVillager(smith, 0, 0, S, "characters/smith");
    const unknown = new StubRenderer();
    drawVillager(unknown, 0, 0, S, "characters/nobody");
    expect(rects(elder).length).toBeGreaterThan(6);
    expect(rects(smith).length).toBeGreaterThan(6);
    expect(rects(unknown).length).toBeGreaterThan(6);
    // Elder robe color present for elder, not for smith.
    expect(rects(elder).some((c) => c[4] === "#7e57c2")).toBe(true);
    expect(rects(smith).every((c) => c[4] !== "#7e57c2")).toBe(true);
    for (const r of [elder, smith, unknown]) {
      expect(rects(r)).toDrawWithin({ x: 0, y: 0, w: S, h: S });
    }
  });

  it("slime dome stays inside its tile and flashes white when hit", () => {
    const normal = new StubRenderer();
    drawSlime(normal, 0, 0, S);
    const hit = new StubRenderer();
    drawSlime(hit, 0, 0, S, true);
    expect(rects(normal)).toDrawWithin({ x: 0, y: 0, w: S, h: S });
    // Flash: the body palette detail is replaced by white (the ground shadow
    // stays translucent black).
    const hitRects = rects(hit);
    expect(hitRects.filter((c) => !c[4].startsWith("rgba")).length).toBeGreaterThan(0);
    expect(hitRects.filter((c) => !c[4].startsWith("rgba")).every((c) => c[4] === "#ffffff")).toBe(
      true,
    );
    expect(hitRects).toContainEqual([1, 10, 14, 4, "#ffffff"]);
  });

  it("turret draws plinth+barrel and grows the charge core toward red", () => {
    const idle = new StubRenderer();
    drawTurret(idle, 0, 0, S, 0);
    expect(rects(idle).some((c) => c[4] === "#8a93a6")).toBe(true);
    // No telegraph while charge <= 0.15.
    expect(rects(idle).every((c) => c[4] !== "#ffe082" && c[4] !== "#ff5252")).toBe(true);

    const charging = new StubRenderer();
    drawTurret(charging, 0, 0, S, 0.5);
    expect(rects(charging).some((c) => c[4] === "#ffe082")).toBe(true);

    const aboutToFire = new StubRenderer();
    drawTurret(aboutToFire, 0, 0, S, 0.9);
    expect(rects(aboutToFire).some((c) => c[4] === "#ff5252")).toBe(true);

    const bigCore = Math.max(3, Math.round(S * (0.2 + 0.9 * 0.5)));
    const midCore = Math.max(3, Math.round(S * (0.2 + 0.5 * 0.5)));
    expect(bigCore).toBeGreaterThanOrEqual(midCore);
  });

  it("props (chest/signpost/beacon) stay within their tiles and the beacon lights up", () => {
    for (const draw of [
      (r: Renderer) => drawChest(r, 0, 0, S),
      (r: Renderer) => drawSignpost(r, 0, 0, S),
    ]) {
      const r = new StubRenderer();
      draw(r);
      expect(rects(r).length).toBeGreaterThan(3);
      expect(rects(r)).toDrawWithin({ x: 0, y: 0, w: S, h: S });
    }

    const cold = new StubRenderer();
    drawBeacon(cold, 0, 0, S, false);
    expect(rects(cold).every((c) => c[4] !== "#ff9800")).toBe(true);

    const lit = new StubRenderer();
    drawBeacon(lit, 0, 0, S, true);
    // Flame rises above the tile top.
    expect(rects(lit).some((c) => c[4] === "#ff9800" && c[1] < 0)).toBe(true);
  });
});
