#!/usr/bin/env node
/**
 * AgenticRPGMaker — open-world demo content generator (ADR-008 §3.5, S5a).
 *
 * Deterministically generates "The Crossroads" demo world:
 *
 *   packages/runtime/world-demo/public/
 *     data/world.json                  world manifest (3×3 × 64×64 tiles)
 *     data/chunks/<chunk>.json         9 map-v1 chunk documents
 *     data/tilesets/placeholder.tileset.json  shared placeholder tileset
 *     img/cg/opening.svg / ending.svg  placeholder CG stills
 *
 * Reproducible (seeded RNG), validated against the core schemas before
 * writing (a bad document aborts with a non-zero exit). Chunk documents are
 * legal map v1 — the existing editor can open any of them unchanged.
 *
 * Usage:  node scripts/gen-open-world.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  parseMapDocument,
  parseTilesetDocument,
  parseWorldDocument,
} from "../packages/core/dist/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OUT = path.join(REPO, "packages", "runtime", "world-demo", "public");
const DATA = path.join(OUT, "data");
const CHUNKS = path.join(DATA, "chunks");
const TILESETS = path.join(DATA, "tilesets");
const IMG = path.join(OUT, "img", "cg");

const CHUNK = 64;
const GRID = 3;
const TILESET = "tilesets/placeholder";

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) so every run is byte-identical.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tile painters (placeholder atlas indices: 1 grass, 2 path, 3 water, 4 rock,
// 5 flower). Colliders are implicit: 3 (water) and 4 (rock) are solid.
// ---------------------------------------------------------------------------
const GRASS = 1;
const PATH = 2;
const WATER = 3;
const ROCK = 4;
const FLOWER = 5;

function solidOf(tile) {
  return tile === WATER || tile === ROCK ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Minimal deterministic PNG encoder (RGBA, no interlace) — pure Node
// (zlib.deflateSync), so the demo ships real terrain art with zero
// dependencies and byte-identical output. Used for the ground atlas below;
// the P5 pipeline (`build-www.mjs`) keeps its own generated placeholder.
// ---------------------------------------------------------------------------
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA Uint8Array (w*h*4 bytes) as a PNG buffer. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Ground atlas painters. The atlas is 128×128 (8×8 cells of 16 px); cells are
// laid out to match map tile indices minus one: cell 0 = grass, 1 = path,
// 2 = water, 3 = rock (masonry — doubles as fortress wall), 4 = flowers.
// ---------------------------------------------------------------------------
const ATLAS_SIZE = 128;
const ATLAS_CELL = 16;

/** Create a fully transparent RGBA canvas. */
function makeAtlas() {
  return new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
}

function px(atlas, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= ATLAS_SIZE || y >= ATLAS_SIZE) {
    return;
  }
  const i = (y * ATLAS_SIZE + x) * 4;
  atlas[i] = r;
  atlas[i + 1] = g;
  atlas[i + 2] = b;
  atlas[i + 3] = a;
}

function fillRect(atlas, cx, cy, w, h, color) {
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
      px(atlas, x, y, color);
    }
  }
}

function paintGrass(atlas, ox, oy, rng) {
  const base = [62, 125, 58];
  fillRect(atlas, ox, oy, ATLAS_CELL, ATLAS_CELL, base);
  // Subtle horizontal striping for texture without noise.
  for (let y = 0; y < ATLAS_CELL; y += 2) {
    for (let x = 0; x < ATLAS_CELL; x++) {
      if ((x * 7 + y * 3) % 5 === 0) {
        px(atlas, ox + x, oy + y, [55, 112, 52]);
      }
    }
  }
  // Sparse blades (lighter green).
  for (let n = 0; n < 7; n++) {
    const bx = Math.floor(rng() * ATLAS_CELL);
    const by = Math.floor(rng() * ATLAS_CELL);
    px(atlas, ox + bx, oy + by, [111, 174, 75]);
    px(atlas, ox + bx, oy + by - 1, [86, 146, 63]);
  }
  // A dark speck or two.
  for (let n = 0; n < 2; n++) {
    px(
      atlas,
      ox + Math.floor(rng() * ATLAS_CELL),
      oy + Math.floor(rng() * ATLAS_CELL),
      [44, 94, 43],
    );
  }
}

function paintPath(atlas, ox, oy, rng) {
  fillRect(atlas, ox, oy, ATLAS_CELL, ATLAS_CELL, [200, 164, 100]);
  // Sandy grain.
  for (let n = 0; n < 14; n++) {
    px(
      atlas,
      ox + Math.floor(rng() * ATLAS_CELL),
      oy + Math.floor(rng() * ATLAS_CELL),
      [182, 147, 87],
    );
  }
  // Pebbles.
  for (let n = 0; n < 3; n++) {
    const bx = 1 + Math.floor(rng() * (ATLAS_CELL - 4));
    const by = 1 + Math.floor(rng() * (ATLAS_CELL - 4));
    fillRect(atlas, ox + bx, oy + by, 2, 2, [168, 131, 74]);
    px(atlas, ox + bx, oy + by, [219, 184, 122]);
  }
}

function paintWater(atlas, ox, oy) {
  fillRect(atlas, ox, oy, ATLAS_CELL, ATLAS_CELL, [43, 90, 166]);
  // Wave bands.
  fillRect(atlas, ox, oy + 3, ATLAS_CELL, 1, [74, 127, 208]);
  fillRect(atlas, ox + 5, oy + 4, 6, 1, [96, 149, 226]);
  fillRect(atlas, ox, oy + 10, ATLAS_CELL, 1, [74, 127, 208]);
  fillRect(atlas, ox + 9, oy + 11, 5, 1, [96, 149, 226]);
  // Sparkles.
  px(atlas, ox + 3, oy + 6, [214, 232, 255]);
  px(atlas, ox + 12, oy + 1, [214, 232, 255]);
  px(atlas, ox + 7, oy + 13, [214, 232, 255]);
}

function paintRock(atlas, ox, oy) {
  // Masonry: reads as both natural cliff and fortress wall.
  fillRect(atlas, ox, oy, ATLAS_CELL, ATLAS_CELL, [71, 76, 86]); // mortar
  const brickTop = [123, 132, 148];
  const brickLite = [152, 162, 179];
  const brickDark = [95, 102, 115];
  // Two rows of offset bricks (row heights 8 px, joints staggered).
  const rows = [
    { y: 1, joints: [5, 11] },
    { y: 9, joints: [2, 8, 14] },
  ];
  for (const row of rows) {
    fillRect(atlas, ox + 1, oy + row.y, ATLAS_CELL - 2, 6, brickTop);
    fillRect(atlas, ox + 1, oy + row.y, ATLAS_CELL - 2, 1, brickLite);
    fillRect(atlas, ox + 1, oy + row.y + 5, ATLAS_CELL - 2, 1, brickDark);
    for (const j of row.joints) {
      fillRect(atlas, ox + j, oy + row.y, 1, 6, [71, 76, 86]);
    }
  }
}

function paintFlowers(atlas, ox, oy, rng) {
  paintGrass(atlas, ox, oy, rng);
  const colors = [
    [229, 107, 140],
    [242, 193, 78],
    [245, 245, 245],
  ];
  for (let n = 0; n < 3; n++) {
    const fx = 2 + Math.floor(rng() * (ATLAS_CELL - 4));
    const fy = 2 + Math.floor(rng() * (ATLAS_CELL - 4));
    const color = colors[n % colors.length];
    // Plus-shaped bloom + petal ring on 16 px it reads as a flower dot.
    px(atlas, ox + fx, oy + fy, color);
    px(atlas, ox + fx - 1, oy + fy, color);
    px(atlas, ox + fx + 1, oy + fy, color);
    px(atlas, ox + fx, oy + fy - 1, color);
    px(atlas, ox + fx, oy + fy + 1, color);
    px(atlas, ox + fx, oy + fy, [250, 240, 160]); // center
  }
}

/** Paint the shared ground atlas (cells in map-index-minus-one order). */
function buildGroundAtlas() {
  const atlas = makeAtlas();
  paintGrass(atlas, 0, 0, mulberry32(101));
  paintPath(atlas, ATLAS_CELL, 0, mulberry32(202));
  paintWater(atlas, ATLAS_CELL * 2, 0);
  paintRock(atlas, ATLAS_CELL * 3, 0);
  paintFlowers(atlas, ATLAS_CELL * 4, 0, mulberry32(303));
  return encodePng(ATLAS_SIZE, ATLAS_SIZE, atlas);
}

function makeChunk(name) {
  const ground = [];
  const colliders = [];
  for (let row = 0; row < CHUNK; row++) {
    ground.push(new Array(CHUNK).fill(GRASS));
    colliders.push(new Array(CHUNK).fill(0));
  }
  return { name, ground, colliders };
}

function paint(chunk, x0, y0, w, h, tile) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < CHUNK && y < CHUNK) {
        chunk.ground[y][x] = tile;
        chunk.colliders[y][x] = solidOf(tile);
      }
    }
  }
}

function scatter(chunk, rng, count, tile) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * CHUNK);
    const y = Math.floor(rng() * CHUNK);
    if (chunk.ground[y][x] === GRASS) {
      chunk.ground[y][x] = tile;
      chunk.colliders[y][x] = solidOf(tile);
    }
  }
}

function crossRoads(chunk) {
  paint(chunk, 0, 32, CHUNK, 1, PATH); // horizontal
  paint(chunk, 32, 0, 1, CHUNK, PATH); // vertical
}

// ---------------------------------------------------------------------------
// Events (dialogue is player data and may be Chinese — ADR-007).
// ---------------------------------------------------------------------------
function event(id, name, x, y, sprite, pages) {
  return { id, name, x, y, ...(sprite === undefined ? {} : { sprite }), pages };
}

function textPage(text) {
  return { condition: null, commands: [{ cmd: "showText", args: [text] }] };
}

function villageEvents() {
  return [
    event("evt_elder", "Elder", 36, 30, "characters/elder", [
      textPage("「孩子,北方的烽火已经熄灭三天了。……带上这把剑,穿过荒野,点亮北关的烽火。」"),
    ]),
    event("evt_smith", "Blacksmith", 40, 30, "characters/smith", [
      textPage("「这剑是镇上的老货,砍起荒野的史莱姆来倒是趁手。」"),
    ]),
    event("evt_kid", "Child", 30, 36, "characters/kid", [
      textPage("「嘘——野地里石头多,绕开石头走就安全些。」"),
    ]),
    event("evt_sign", "Signpost", 34, 26, undefined, [
      textPage("路标:向北 → 荒野(小心史莱姆);向东 → 北关要塞。"),
    ]),
    event("evt_chest", "Chest", 26, 28, undefined, [
      {
        condition: { switchId: "sw_chest", value: false },
        commands: [
          { cmd: "sfx", args: ["coin"] },
          { cmd: "setVariable", args: ["gold", "add", 50] },
          { cmd: "setSwitch", args: ["sw_chest", true] },
          { cmd: "showText", args: ["你找到了 50 金币!"] },
        ],
      },
      textPage("宝箱已经空了。"),
    ]),
  ];
}

function wildsEvents() {
  return [
    event("evt_sign", "Signpost", 30, 26, undefined, [
      textPage("路标:荒野以北…不,荒野就是这里。小心那两只史莱姆!"),
    ]),
  ];
}

function fortressEvents() {
  return [
    event("evt_guard", "Gate Guard", 30, 40, undefined, [
      {
        condition: { switchId: "sw_wilds_cleared", value: true },
        commands: [textPage("「你竟穿过了荒野……哨兵就守在烽火台下,去点亮它吧。」").commands[0]],
      },
      textPage("「北关的门关着。等荒野安静下来,哨兵才愿见你。」"),
    ]),
    event("evt_beacon", "Beacon", 32, 24, undefined, [
      {
        condition: { switchId: "sw_boss_defeated", value: true },
        commands: [
          { cmd: "bgm", args: ["ending"] },
          { cmd: "fadeOut", args: ["#000000", 400] },
          { cmd: "showCg", args: ["img/cg/ending.svg"] },
          { cmd: "fadeIn", args: [900] },
          { cmd: "letterbox", args: [true] },
          { cmd: "showText", args: ["烽火重燃。"] },
          { cmd: "showText", args: ["北关得救了 —— THE END"] },
          { cmd: "letterbox", args: [false] },
          { cmd: "endCg", args: [] },
        ],
      },
      textPage("烽火台的铜盆是冷的,还差最后一把火。"),
    ]),
  ];
}

// ---------------------------------------------------------------------------
// Chunk assembly
// ---------------------------------------------------------------------------
function buildChunks() {
  const village = makeChunk("Village");
  crossRoads(village);
  // House blocks (rock) at the four corners of the crossing.
  paint(village, 4, 4, 10, 10, ROCK);
  paint(village, 50, 4, 10, 10, ROCK);
  paint(village, 4, 50, 10, 10, ROCK);
  paint(village, 50, 50, 10, 10, ROCK);
  scatter(village, mulberry32(7), 30, FLOWER);

  const wilds = makeChunk("Wildmoor");
  paint(wilds, 32, 0, 1, CHUNK, PATH);
  const rngW = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    const x = 8 + Math.floor(rngW() * 48);
    const y = 8 + Math.floor(rngW() * 48);
    paint(wilds, x, y, 2 + Math.floor(rngW() * 2), 2 + Math.floor(rngW() * 2), ROCK);
  }
  scatter(wilds, rngW, 40, FLOWER);

  const fortress = makeChunk("Northgate Fortress");
  paint(fortress, 0, 0, CHUNK, CHUNK, PATH); // stone floor (walkable path tile)
  // Corner bastions (decorative, off the main path).
  paint(fortress, 2, 2, 6, 6, ROCK);
  paint(fortress, 56, 2, 6, 6, ROCK);
  paint(fortress, 2, 56, 6, 6, ROCK);
  paint(fortress, 56, 56, 6, 6, ROCK);
  // Scattered rocks but never on the central path (x 28..36 / y 28..36),
  // the guard→beacon access column (x 26..34), or the arena row (y 36..46).
  const rngF = mulberry32(13);
  for (let i = 0; i < 18; i++) {
    const x = 2 + Math.floor(rngF() * 60);
    const y = 2 + Math.floor(rngF() * 60);
    const protectedZone =
      (x >= 28 && x <= 36 && y >= 28 && y <= 36) || (x >= 26 && x <= 34) || (y >= 36 && y <= 46);
    if (!protectedZone && fortress.ground[y]?.[x] === PATH) {
      paint(fortress, x, y, 2, 2, ROCK);
    }
  }

  // Connector chunks: travel routes between regions — keep them mostly open
  // (a few rocks, never on the cross-road bands so overland routes stay clear).
  const makeConnector = (seed) => {
    const chunk = makeChunk("Forest Road");
    crossRoads(chunk);
    const rng = mulberry32(seed);
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(rng() * CHUNK);
      const y = Math.floor(rng() * CHUNK);
      const onPath = x >= 31 && x <= 33 && y >= 31 && y <= 33;
      if (!onPath && chunk.ground[y]?.[x] === GRASS) {
        chunk.ground[y][x] = ROCK;
        chunk.colliders[y][x] = 1;
      }
    }
    return chunk;
  };
  const nw = makeConnector(1);
  const ne = makeConnector(2);
  const wch = makeConnector(3);
  const sch = makeConnector(4);
  const sw = makeConnector(5);
  const se = makeConnector(6);

  return [
    { id: "ch_village", col: 1, row: 1, chunk: village, events: villageEvents() },
    {
      id: "ch_wilds",
      col: 1,
      row: 0,
      chunk: wilds,
      events: wildsEvents(),
      combatants: [
        { id: "slime_a", type: "slime", x: 34, y: 20, onDefeatSwitch: "sw_wilds_cleared" },
        { id: "slime_b", type: "slime", x: 36, y: 24, onDefeatSwitch: "sw_wilds_cleared" },
      ],
    },
    {
      id: "ch_fortress",
      col: 2,
      row: 1,
      chunk: fortress,
      events: fortressEvents(),
      combatants: [
        { id: "sentinel", type: "turret", x: 40, y: 42, onDefeatSwitch: "sw_boss_defeated" },
      ],
    },
    { id: "ch_nw", col: 0, row: 0, chunk: nw, events: [] },
    { id: "ch_ne", col: 2, row: 0, chunk: ne, events: [] },
    { id: "ch_w", col: 0, row: 1, chunk: wch, events: [] },
    { id: "ch_s", col: 1, row: 2, chunk: sch, events: [] },
    { id: "ch_sw", col: 0, row: 2, chunk: sw, events: [] },
    { id: "ch_se", col: 2, row: 2, chunk: se, events: [] },
  ];
}

function toMapDocument(entry) {
  return {
    schemaVersion: 1,
    id: `map_${entry.id}`,
    name: entry.chunk.name,
    tileSize: 16,
    width: CHUNK,
    height: CHUNK,
    tileset: TILESET,
    layers: [
      {
        id: "ground",
        name: "Ground",
        type: "tile",
        opacity: 1,
        visible: true,
        data: entry.chunk.ground,
      },
      {
        id: "colliders",
        name: "Colliders",
        type: "tile",
        opacity: 1,
        visible: false,
        data: entry.chunk.colliders,
      },
    ],
    events: entry.events,
    variables: {},
    switches: {},
  };
}

// ---------------------------------------------------------------------------
// CG placeholder stills (deterministic SVGs — the registerTexture path loads
// them like any image; no binary assets needed).
// ---------------------------------------------------------------------------
function openingCg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1026"/>
      <stop offset="0.7" stop-color="#1c1e33"/>
      <stop offset="1" stop-color="#2b1e3a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#sky)"/>
  <circle cx="120" cy="120" r="60" fill="#1a1c2e"/>
  <circle cx="120" cy="120" r="44" fill="#2a2c44"/>
  <circle cx="320" cy="110" r="26" fill="#3a3a4a"/>
  <rect x="300" y="70" width="40" height="110" fill="#1c1c28"/>
  <rect x="288" y="170" width="64" height="10" fill="#1c1c28"/>
  <!-- The beacon brazier: cold and dark (this is the "beacon has gone out" shot). -->
  <ellipse cx="320" cy="188" rx="20" ry="8" fill="#11131c"/>
  <rect x="312" y="178" width="16" height="10" fill="#2a2a38"/>
  <!-- Village roofs along the bottom. -->
  <path d="M0 360 L80 300 L160 360 Z" fill="#262a3c"/>
  <path d="M90 366 L170 306 L250 366 Z" fill="#2e3348"/>
  <path d="M240 360 L320 302 L400 360 Z" fill="#262a3c"/>
  <path d="M460 366 L540 310 L620 366 Z" fill="#2e3348"/>
  <rect x="0" y="360" width="640" height="120" fill="#10121c"/>
  <text x="320" y="430" font-family="monospace" font-size="26" fill="#e8e6df" text-anchor="middle" letter-spacing="4">THE CROSSROADS</text>
  <text x="320" y="458" font-family="monospace" font-size="13" fill="#8d99ae" text-anchor="middle">the beacon has gone dark — light it in the north</text>
</svg>
`;
}

function endingCg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="dawn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9a3c"/>
      <stop offset="0.55" stop-color="#ffd54f"/>
      <stop offset="1" stop-color="#4a5a3a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#dawn)"/>
  <circle cx="320" cy="200" r="92" fill="#fff8dc" opacity="0.95"/>
  <path d="M0 320 L120 260 L240 320 L400 250 L520 320 L640 270 L640 480 L0 480 Z" fill="#3a4a2a"/>
  <!-- The beacon burns bright on its tower. -->
  <rect x="300" y="120" width="40" height="120" fill="#2c2c34"/>
  <rect x="288" y="232" width="64" height="10" fill="#2c2c34"/>
  <ellipse cx="320" cy="244" rx="20" ry="7" fill="#1c1c22"/>
  <path d="M308 130 Q300 104 320 96 Q340 104 332 130 Z" fill="#ffb300"/>
  <path d="M314 122 Q310 106 320 100 Q330 106 326 122 Z" fill="#ffd54f"/>
  <text x="320" y="440" font-family="monospace" font-size="30" fill="#2b1e0a" text-anchor="middle" letter-spacing="6">THE END</text>
  <text x="320" y="468" font-family="monospace" font-size="13" fill="#3a4a2a" text-anchor="middle">the beacon burns again</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// World manifest
// ---------------------------------------------------------------------------
function buildWorld(chunkEntries) {
  return {
    schemaVersion: 1,
    id: "world_crossroads",
    name: "The Crossroads",
    chunkSize: CHUNK,
    grid: { cols: GRID, rows: GRID },
    chunks: chunkEntries.map((e) => ({
      id: e.id,
      file: `chunks/${e.id}.json`,
      col: e.col,
      row: e.row,
      ...(e.combatants !== undefined && e.combatants.length > 0
        ? { combatants: e.combatants }
        : {}),
    })),
    combatTypes: {
      slime: { hp: 2, damage: 1, behavior: "chase", speed: 1.2, aggroRange: 6 },
      slime_fast: { hp: 2, damage: 1, behavior: "chase", speed: 1.6, aggroRange: 6 },
      turret: { hp: 6, damage: 1, behavior: "turret", speed: 0 },
    },
    spawn: { chunkId: "ch_village", x: 64 + 32, y: 64 + 32, direction: "down" },
    tilesets: [TILESET],
    global: { variables: { gold: 0 }, switches: {} },
    intro: [
      { cmd: "bgm", args: ["title"] },
      { cmd: "fadeOut", args: ["#000000", 300] },
      { cmd: "showCg", args: ["img/cg/opening.svg"] },
      { cmd: "fadeIn", args: [700] },
      { cmd: "letterbox", args: [true] },
      { cmd: "showText", args: ["边境的烽火……熄灭了。"] },
      { cmd: "showText", args: ["长老将剑交到你手中:「一路向北,穿过荒野,点亮北关的烽火。」"] },
      { cmd: "showText", args: ["方向键/WASD 移动 · Z/Enter 对话或挥剑 · F5 存档"] },
      { cmd: "letterbox", args: [false] },
      { cmd: "bgm", args: ["village"] },
      { cmd: "setSwitch", args: ["sw_intro_done", true] },
      { cmd: "endCg", args: [] },
    ],
  };
}

const TILESET_DOC = {
  schemaVersion: 1,
  id: TILESET,
  name: "Placeholder",
  image: "img/tilesets/placeholder.png",
  tileSize: 16,
  columns: 8,
  rows: 8,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  mkdirSync(CHUNKS, { recursive: true });
  mkdirSync(TILESETS, { recursive: true });
  mkdirSync(IMG, { recursive: true });
  mkdirSync(path.join(OUT, "img", "tilesets"), { recursive: true });

  const chunkEntries = buildChunks();
  const world = buildWorld(chunkEntries);

  // Validate every document against the core schemas BEFORE writing.
  parseWorldDocument(world);
  const maps = chunkEntries.map((e) => toMapDocument(e));
  for (const map of maps) {
    parseMapDocument(map);
  }
  parseTilesetDocument(TILESET_DOC);

  writeFileSync(path.join(DATA, "world.json"), `${JSON.stringify(world, null, 2)}\n`);
  for (const map of maps) {
    const chunkId = map.id.slice("map_".length);
    writeFileSync(path.join(CHUNKS, `${chunkId}.json`), `${JSON.stringify(map, null, 2)}\n`);
  }
  writeFileSync(
    path.join(TILESETS, "placeholder.tileset.json"),
    `${JSON.stringify(TILESET_DOC, null, 2)}\n`,
  );
  writeFileSync(path.join(OUT, "img", "tilesets", "placeholder.png"), buildGroundAtlas());
  writeFileSync(path.join(IMG, "opening.svg"), openingCg());
  writeFileSync(path.join(IMG, "ending.svg"), endingCg());

  console.log(
    `[gen-open-world] wrote world.json (${world.chunks.length} chunks) + ${maps.length} maps + tileset + atlas.png + 2 CGs → ${path.relative(REPO, DATA)}`,
  );
}

main();
