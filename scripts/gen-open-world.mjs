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
    event("evt_guard", "Gate Guard", 30, 42, "characters/guard", [
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
  paint(fortress, 32, 0, 1, CHUNK, ROCK); // central spine wall
  paint(fortress, 0, 32, 64, 1, ROCK); // moat wall
  paint(fortress, 60, 24, 4, 8, ROCK); // gatehouse block
  paint(fortress, 0, 24, 4, 8, ROCK); // gatehouse block (west)
  scatter(fortress, mulberry32(13), 20, ROCK);

  // Connector chunks: simple paths linking the grid.
  const makeConnector = (seed) => {
    const chunk = makeChunk("Forest Road");
    crossRoads(chunk);
    scatter(chunk, mulberry32(seed), 45, ROCK);
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
        { id: "sentinel", type: "turret", x: 32, y: 28, onDefeatSwitch: "sw_boss_defeated" },
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
      <stop offset="1" stop-color="#2b1e3a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#sky)"/>
  <circle cx="540" cy="120" r="42" fill="#3a3a4a"/>
  <rect x="516" y="90" width="48" height="120" fill="#1c1c28"/>
  <rect x="502" y="200" width="76" height="10" fill="#1c1c28"/>
  <rect x="520" y="206" width="40" height="120" fill="#2a2a38"/>
  <rect x="522" y="212" width="12" height="120" fill="#ffd54f"/>
  <rect x="546" y="212" width="12" height="120" fill="#ffb300"/>
  <text x="320" y="430" font-family="monospace" font-size="26" fill="#e8e6df" text-anchor="middle" letter-spacing="4">THE CROSSROADS</text>
  <text x="320" y="458" font-family="monospace" font-size="13" fill="#8d99ae" text-anchor="middle">the beacon has gone dark</text>
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
  <circle cx="320" cy="240" r="90" fill="#fff8dc" opacity="0.9"/>
  <path d="M0 320 L120 260 L240 320 L400 250 L520 320 L640 270 L640 480 L0 480 Z" fill="#3a4a2a"/>
  <rect x="150" y="180" width="26" height="90" fill="#333"/>
  <rect x="470" y="170" width="26" height="100" fill="#333"/>
  <rect x="156" y="184" width="14" height="90" fill="#ffd54f"/>
  <rect x="476" y="174" width="14" height="100" fill="#ffb300"/>
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
      slime: { hp: 2, damage: 1, behavior: "chase", speed: 1.2 },
      slime_fast: { hp: 2, damage: 1, behavior: "chase", speed: 1.6 },
      turret: { hp: 6, damage: 1, behavior: "turret", speed: 0 },
    },
    spawn: { chunkId: "ch_village", x: 32, y: 32, direction: "down" },
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
  writeFileSync(path.join(IMG, "opening.svg"), openingCg());
  writeFileSync(path.join(IMG, "ending.svg"), endingCg());

  console.log(
    `[gen-open-world] wrote world.json (${world.chunks.length} chunks) + ${maps.length} maps + tileset + 2 CGs → ${path.relative(REPO, DATA)}`,
  );
}

main();
