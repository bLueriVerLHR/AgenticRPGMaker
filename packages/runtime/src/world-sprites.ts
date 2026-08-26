/**
 * Composed mini-sprites for WorldScene (playtest feedback: "everything is an
 * abstract colored square").
 *
 * Every sprite is built from `Renderer.drawRect` calls only — no new renderer
 * API, no texture assets required — so both backends render them identically
 * and unit tests can assert on plain rect draws. Coordinates are rounded to
 * whole pixels so the art stays crisp at 16 px tiles and still scales when a
 * tileset declares another size.
 */
import type { Renderer } from "@agenticrpg/renderer";

/**
 * Sprite-less event names that render as props (chest / signpost / beacon).
 * Single source of truth so the chunk wiring (they are SOLID — playtest round
 * 2: "I can stand on the chest") and the renderer prop pass stay in sync.
 * Sprite-less events NOT in this set stay invisible and walkable (area
 * triggers, etc.). Matching is on lowercased `event.name`.
 */
export const PROP_EVENT_NAMES: ReadonlySet<string> = new Set(["signpost", "chest", "beacon"]);

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const SKIN = "#eec39a";
const SKIN_SHADE = "#d9a878";
const HAIR_BROWN = "#4e342e";
const HAIR_GRAY = "#cfd2d8";
const LEG_DARK = "#5d4037";
const OUTLINE = "rgba(0,0,0,0.35)";
const HERO_TUNIC = "#3f6fd1";
const HERO_TUNIC_SHADE = "#3157a6";
const HERO_HAIR = "#b04a2f";
const VILLAGER_TUNICS: Record<string, string> = {
  elder: "#7e57c2",
  smith: "#c96f4a",
  kid: "#ef9a5c",
};
const SLIME_BODY = "#ff7043";
const SLIME_RIM = "#ffab91";
const SLIME_SHADE = "#e64a19";
const TURRET_STONE = "#8a93a6";
const TURRET_STONE_DARK = "#5c6577";
const TURRET_BARREL = "#2f3640";
const WOOD = "#8a5a2b";
const WOOD_DARK = "#6d4420";
const WOOD_LIGHT = "#a9743c";
const GOLD = "#c9a227";
const STONE = "#9aa3b2";
const STONE_DARK = "#707888";
const FLAME_OUTER = "#ff9800";
const FLAME_INNER = "#ffd54f";
const SIGN_BOARD = "#a1887f";
const SIGN_POST = "#6d4c41";

function r(renderer: Renderer, x: number, y: number, w: number, h: number, color: string): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.max(1, Math.round(w));
  const rh = Math.max(1, Math.round(h));
  renderer.drawRect(rx, ry, rw, rh, color);
}

/** Soft ground shadow under a standing figure. */
function shadow(renderer: Renderer, x: number, y: number, s: number, w = 0.75): void {
  r(renderer, x + (s * (1 - w)) / 2, y + s * 0.82, s * w, Math.max(2, s * 0.14), OUTLINE);
}

/** Head with hair; used by every human sprite (feet-anchored layout). */
function head(renderer: Renderer, cx: number, topY: number, size: number, hairColor: string): void {
  // Face
  r(renderer, cx - size / 2, topY, size, size, SKIN);
  // Hair cap + fringe
  r(renderer, cx - size / 2, topY, size, Math.max(2, size * 0.32), hairColor);
  r(renderer, cx - size / 2, topY, Math.max(1, size * 0.18), size * 0.55, hairColor);
  r(
    renderer,
    cx + size / 2 - Math.max(1, size * 0.18),
    topY,
    Math.max(1, size * 0.18),
    size * 0.55,
    hairColor,
  );
}

// ---------------------------------------------------------------------------
// Player hero (~1.3 tiles tall, anchored to the tile)
// ---------------------------------------------------------------------------

export interface HeroSpriteOptions {
  /** True while the post-hit red flash is visible. */
  flashing?: boolean;
}

export function drawHero(
  renderer: Renderer,
  x: number,
  y: number,
  s: number,
  options: HeroSpriteOptions = {},
): void {
  shadow(renderer, x, y, s, 0.7);
  const bodyW = s * 0.56;
  const bx = x + (s - bodyW) / 2;
  const tunicTop = y + s * 0.52;
  const tunicH = s * 0.42;
  const legH = Math.max(2, s * 0.18);
  const legW = Math.max(2, s * 0.16);
  // Legs
  r(renderer, x + s * 0.28, tunicTop + tunicH, legW, legH, LEG_DARK);
  r(renderer, x + s * 0.58, tunicTop + tunicH, legW, legH, LEG_DARK);
  if (options.flashing === true) {
    // Whole-tile red flash on hit — reads instantly even at 16 px.
    r(renderer, x, y, s, s, "#ff5252");
    return;
  }
  // Tunic + belt
  r(renderer, bx, tunicTop, bodyW, tunicH, HERO_TUNIC);
  r(renderer, bx, tunicTop + tunicH * 0.62, bodyW, Math.max(1, s * 0.08), HERO_TUNIC_SHADE);
  // Sword hilt peeking over the shoulder (reads "armed")
  r(renderer, x + s * 0.66, tunicTop - s * 0.06, Math.max(2, s * 0.08), s * 0.24, "#cfd2d8");
  // Head
  const headS = s * 0.46;
  head(renderer, x + s / 2, y + s * 0.14, headS, HERO_HAIR);
  // Eyes depend on nothing — two dark pixels under the fringe
  const eyeY = y + s * 0.14 + headS * 0.62;
  r(renderer, x + s * 0.38, eyeY, Math.max(1, s * 0.07), Math.max(1, s * 0.09), "#212121");
  r(renderer, x + s * 0.56, eyeY, Math.max(1, s * 0.07), Math.max(1, s * 0.09), "#212121");
}

// ---------------------------------------------------------------------------
// Villager NPC (~1.3 tiles tall). `role` selects the tunic color.
// ---------------------------------------------------------------------------

export function drawVillager(
  renderer: Renderer,
  x: number,
  y: number,
  s: number,
  role: string,
): void {
  const roleKey = role.split("/").pop() ?? "";
  const tunic = VILLAGER_TUNICS[roleKey] ?? "#8d6e63";
  const hair = roleKey === "elder" ? HAIR_GRAY : HAIR_BROWN;
  shadow(renderer, x, y, s, 0.72);
  const bodyW = s * 0.6;
  const bx = x + (s - bodyW) / 2;
  const tunicTop = y + s * 0.5;
  const tunicH = s * 0.44;
  const legH = Math.max(2, s * 0.16);
  const legW = Math.max(2, s * 0.15);
  // Legs
  r(renderer, x + s * 0.29, tunicTop + tunicH, legW, legH, LEG_DARK);
  r(renderer, x + s * 0.57, tunicTop + tunicH, legW, legH, LEG_DARK);
  // Robe/tunic (fuller than the hero's — silhouette difference by faction)
  r(renderer, bx, tunicTop, bodyW, tunicH, tunic);
  r(renderer, bx, tunicTop + tunicH * 0.7, bodyW, Math.max(1, s * 0.08), SKIN_SHADE);
  // Head
  const headS = s * 0.46;
  head(renderer, x + s / 2, y + s * 0.12, headS, hair);
  // Eyes
  const eyeY = y + s * 0.12 + headS * 0.62;
  r(renderer, x + s * 0.39, eyeY, Math.max(1, s * 0.07), Math.max(1, s * 0.09), "#212121");
  r(renderer, x + s * 0.57, eyeY, Math.max(1, s * 0.07), Math.max(1, s * 0.09), "#212121");
}

// ---------------------------------------------------------------------------
// Slime (chaser enemy) — dome body, eyes, shine
// ---------------------------------------------------------------------------

export function drawSlime(
  renderer: Renderer,
  x: number,
  y: number,
  s: number,
  flash = false,
): void {
  const body = flash ? "#ffffff" : SLIME_BODY;
  shadow(renderer, x, y, s, 0.85);
  // Dome: three stacked bands, wider toward the base.
  r(renderer, x + s * 0.22, y + s * 0.18, s * 0.56, s * 0.2, body);
  r(renderer, x + s * 0.12, y + s * 0.38, s * 0.76, s * 0.22, body);
  r(renderer, x + s * 0.05, y + s * 0.6, s * 0.9, s * 0.28, body);
  if (!flash) {
    // Rim light (top-left) + grounding shade (bottom).
    r(renderer, x + s * 0.26, y + s * 0.2, s * 0.2, Math.max(1, s * 0.08), SLIME_RIM);
    r(renderer, x + s * 0.05, y + s * 0.78, s * 0.9, Math.max(1, s * 0.1), SLIME_SHADE);
    // Eyes
    r(renderer, x + s * 0.28, y + s * 0.42, s * 0.14, s * 0.18, "#ffffff");
    r(renderer, x + s * 0.58, y + s * 0.42, s * 0.14, s * 0.18, "#ffffff");
    r(renderer, x + s * 0.33, y + s * 0.47, s * 0.07, s * 0.1, "#212121");
    r(renderer, x + s * 0.6, y + s * 0.47, s * 0.07, s * 0.1, "#212121");
  }
}

// ---------------------------------------------------------------------------
// Turret sentinel — stone plinth + barrel + charge core (telegraph)
// ---------------------------------------------------------------------------

export function drawTurret(
  renderer: Renderer,
  x: number,
  y: number,
  s: number,
  charge: number,
  flash = false,
): void {
  shadow(renderer, x, y, s, 0.9);
  if (flash) {
    r(renderer, x, y, s, s, "#ffffff");
    return;
  }
  // Plinth
  r(renderer, x + s * 0.06, y + s * 0.42, s * 0.88, s * 0.5, flash ? "#ffffff" : TURRET_STONE);
  r(renderer, x + s * 0.06, y + s * 0.84, s * 0.88, Math.max(2, s * 0.08), TURRET_STONE_DARK);
  // Barrel pointing up from the plinth center.
  r(renderer, x + s * 0.4, y + s * 0.02, s * 0.2, s * 0.46, TURRET_BARREL);
  r(renderer, x + s * 0.44, y + s * 0.02, s * 0.05, s * 0.4, "#454e5c");
  // Charge telegraph core (grows as the next shot approaches).
  if (charge > 0.15) {
    const core = Math.max(3, Math.round(s * (0.2 + charge * 0.5)));
    const color = charge > 0.85 ? "#ff5252" : "#ffe082";
    r(renderer, x + s * 0.5 - core / 2, y + s * 0.24 - core / 2, core, core, color);
  }
}

// ---------------------------------------------------------------------------
// Props: chest, signpost, beacon
// ---------------------------------------------------------------------------

export function drawChest(renderer: Renderer, x: number, y: number, s: number): void {
  shadow(renderer, x, y, s, 0.8);
  const boxW = s * 0.86;
  const boxX = x + (s - boxW) / 2;
  const boxY = y + s * 0.34;
  // Body + lid band
  r(renderer, boxX, boxY, boxW, s * 0.54, WOOD);
  r(renderer, boxX, boxY, boxW, Math.max(2, s * 0.14), WOOD_LIGHT);
  r(renderer, boxX, boxY + s * 0.26, boxW, Math.max(2, s * 0.1), WOOD_DARK);
  // Gold latch + corner brackets
  r(renderer, x + s * 0.44, boxY + s * 0.2, Math.max(2, s * 0.12), Math.max(2, s * 0.16), GOLD);
  r(renderer, boxX, boxY, Math.max(1, s * 0.06), s * 0.54, WOOD_DARK);
  r(
    renderer,
    boxX + boxW - Math.max(1, s * 0.06),
    boxY,
    Math.max(1, s * 0.06),
    s * 0.54,
    WOOD_DARK,
  );
}

export function drawSignpost(renderer: Renderer, x: number, y: number, s: number): void {
  shadow(renderer, x, y, s, 0.5);
  // Post
  r(renderer, x + s * 0.44, y + s * 0.3, Math.max(2, s * 0.12), s * 0.62, SIGN_POST);
  // Board + text lines
  r(renderer, x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.34, SIGN_BOARD);
  r(renderer, x + s * 0.06, y + s * 0.1, s * 0.88, Math.max(1, s * 0.07), WOOD_LIGHT);
  r(renderer, x + s * 0.16, y + s * 0.21, s * 0.68, Math.max(1, s * 0.05), "#5d4037");
  r(renderer, x + s * 0.16, y + s * 0.31, s * 0.5, Math.max(1, s * 0.05), "#5d4037");
}

export function drawBeacon(
  renderer: Renderer,
  x: number,
  y: number,
  s: number,
  lit: boolean,
): void {
  shadow(renderer, x, y, s, 0.95);
  // Pedestal + column
  r(renderer, x + s * 0.04, y + s * 0.76, s * 0.92, s * 0.2, STONE_DARK);
  r(renderer, x + s * 0.36, y + s * 0.14, s * 0.28, s * 0.64, STONE);
  r(renderer, x + s * 0.36, y + s * 0.14, Math.max(2, s * 0.08), s * 0.64, "#b8c0cd");
  // Bowl
  r(renderer, x + s * 0.2, y + s * 0.04, s * 0.6, s * 0.14, STONE_DARK);
  r(renderer, x + s * 0.24, y + s * 0.02, s * 0.52, Math.max(2, s * 0.08), STONE);
  if (lit) {
    // Layered flame
    r(renderer, x + s * 0.3, y - s * 0.24, s * 0.4, s * 0.28, FLAME_OUTER);
    r(renderer, x + s * 0.38, y - s * 0.12, s * 0.24, s * 0.18, FLAME_INNER);
  } else {
    // Cold embers — dim, so the unlit objective still draws the eye.
    r(renderer, x + s * 0.42, y - s * 0.04, s * 0.16, Math.max(2, s * 0.06), "#4a3b2a");
  }
}
