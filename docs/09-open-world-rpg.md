# Open-World RPG — Seamless Streaming & Action Demo

> **status: proposed (pending leader review)**
> Design proposal for the seamless open-world RPG demo. Written after the leader's
> three discussion rounds (2026-08-26). Each significant decision made during those
> rounds becomes an ADR: [ADR-008](./04-adr/ADR-008.md),
> [ADR-009](./04-adr/ADR-009.md), [ADR-010](./04-adr/ADR-010.md).
> Follow-up for the docs workstream: log these decisions in
> [02-open-questions.md](./02-open-questions.md) once the leader ratifies this doc.

This document describes **what we build** for the open-world demo; the existing
[06-architecture.md](./06-architecture.md) (§2–§4) and
[07-mvp-plan.md](./07-mvp-plan.md) describe the architecture and process this work
extends. The WAL/testing gate from [03-wal-process.md](./03-wal-process.md) applies
to every stage below.

---

## 1. Objective & acceptance

**Objective.** Extend the engine to support a seamless (no screen transitions, no
loading screens) multi-chunk world, and ship a playable 15-minute vertical-slice
demo that exercises: **full-screen CG playback, dialogue, scripted events,
exploration, interaction, and real-time action combat**.

**Acceptance (the golden path, E2E-asserted).**

1. Boot → title screen (press any key; unlocks audio).
2. Opening CG (skippable) → spawn in the central village chunk.
3. Walk **across at least two chunk boundaries** with no loading screen and no
   visible seam; collision and NPCs behave continuously across boundaries.
4. Three dialogue interactions and two object interactions (signpost, chest with
   gold counter in HUD).
5. Two real-time battles (2× chasing slimes; 1× ranged turret boss at the fortress
   gate); victory persists globally (enemies do not respawn).
6. Death at any point → fade back to spawn; HP restored; story progress kept.
7. Ending CG after the boss; THE END.
8. Chapter autosaves (after opening CG, after each battle, and F5/F9 manual
   save/load) survive a full page reload.

**Performance acceptance (measured, not felt).**

- First paint (title) ≤ 300 ms on desktop Chrome; spawn chunk + neighbors ready
  before the player can move.
- Chunk crossing introduces **no >33 ms frame** on desktop Chrome; runtime logs
  frame stats (structured) so E2E can capture them.
- Chunk parse executes off the main thread (Web Worker) with a correctness-equal
  main-thread fallback for runtimes without workers (compat checklist §3).

## 2. Decision ledger (rounds 1–3, leader-confirmed 2026-08-26)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Process | Follow the repo WAL: design doc + ADRs first, feature branch, QA gate, docs corrected in the same change |
| 2 | Combat model | **On-map real-time action combat** (not turn-based, not scripted) |
| 3 | CG form | **Full-screen static CG** + fade/letterbox/cue presentation (no video codecs) |
| 4 | Movement | **Keep grid-step** movement (tile steps, 0.15 s per step) — seamless ≠ smooth |
| 5 | World size | **3×3 chunks × 64×64 tiles** (≈37 k walkable tiles) |
| 6 | Content authoring | **Agent-authored JSON**; editor extensions are a non-goal |
| 7 | Demo shape | **One 15-minute vertical-slice golden path** chaining all six features |
| 8 | Combat verbs | Melee attack (facing tile) + contact damage + 3 HP + 0.5 s i-frames (Zelda-minimal) |
| 9 | Enemies | 2 types (chasing slime, stationary turret), one-shot kills, no respawn |
| 10 | Death flow | Respawn at spawn point, HP restored, story progress kept |
| 11 | World storage | `world.json` manifest + **one map-v1 document per chunk** (editor can still open each chunk) |
| 12 | State semantics | Global variables/switches (world layer) + per-chunk runtime deltas (defeated enemies) → save v2 |
| 13 | Boot compatibility | Keep `mapData` single-map path untouched; add `worldUrl` path |
| 14 | CG command set | `showCg` / `fadeOut` / `fadeIn` / `letterbox` / `bgm` / `sfx` / `endCg`, skippable |
| 15 | Audio | Reopen minimal audio (was MVP non-goal): WebAudio BGM loop + SFX one-shots, procedural placeholder assets |
| 16 | Opening UX | Title screen ("press any key", unlocks `AudioContext`) + control hints in HUD/opening CG |
| 17 | Save points | Chapter autosaves (after CG, after each battle) + manual F5/F9 |
| 18 | Story | Agent-authored story, leader reviews (this doc §8); dialogue may be Chinese (player data, ADR-007) |

Fallback rights kept on the table: cut to **one battle** if the combat stage blows
its budget; enemy AI degrades to chase-only before the demo shrinks elsewhere.

## 3. Architecture changes by package

### 3.1 `packages/core` — new schemas and commands, zero DOM

- **`world` schema v1** (`packages/core/src/schema/world.ts`). Manifest only:

  ```jsonc
  {
    "schemaVersion": 1,
    "id": "world_crossroads",
    "name": "The Crossroads",
    "chunkSize": 64,
    "grid": { "cols": 3, "rows": 3 },
    "chunks": [
      { "id": "ch_village", "file": "data/chunks/ch_village.json", "col": 1, "row": 1,
        "combatants": [ /* { id, type, x, y } — world layer, map v1 untouched */ ] }
    ],
    "combatTypes": {
      "slime":  { "hp": 2, "damage": 1, "behavior": "chase",  "speed": 0.6  },
      "turret": { "hp": 5, "damage": 1, "behavior": "turret", "speed": 0    }
    },
    "spawn": { "chunkId": "ch_village", "x": 32, "y": 40, "direction": "down" },
    "tilesets": ["tilesets/placeholder"],
    "global": { "variables": { "gold": 0 }, "switches": {} }
  }
  ```

  Chunk payload is a **legal map-v1 document** (ADR-003): the existing editor opens
  any chunk unchanged. Chunk-local `variables`/`switches` fields remain (schema
  requires them) but are **not evaluated in world mode** — the manifest's `global`
  store is the single truth (decision 12). Chunk coordinates: `col = floor(x /
  chunkSize)`; no per-chunk `variables`/`switches` semantics.

- **`save` schema v2** (new file, v1 kept untouched):

  ```jsonc
  {
    "schemaVersion": 2,
    "worldId": "world_crossroads",
    "player": { "chunkId": "ch_village", "x": 32, "y": 40, "direction": "down", "hp": 3 },
    "variables": { "gold": 50 },
    "switches": { "sw_wilds_cleared": true },
    "chunkState": { "ch_wilds": { "defeatedIds": ["en_slime_1"] } }
  }
  ```

  The runtime `Storage` adapter detects the version by `schemaVersion`; v1 saves are
  only meaningful for the legacy `mapData` path and remain loadable there.

- **New interpreter commands** (same pattern as `showText`, core never renders or
  plays): `showCg <imageRef> [mode=cover]`, `fadeOut <color> <ms>`, `fadeIn <ms>`,
  `letterbox <on|off>`, `bgm <ref>`, `sfx <ref>`, `endCg`. They publish typed bus
  events consumed by the runtime presentation layer / audio manager.

- **Coordinate helpers** (`packages/core/src/world/coords.ts`): `chunkOf`,
  `localOf`, `globalOf`, `chunkIdAt` — pure, unit-tested; the single place where
  global↔chunk math lives.

### 3.2 `packages/renderer` — screen-space image draw

- Add `registerTexture(id, url)` + `drawTexture(id, x, y, w, h, screenSpace)`
  behind the `Renderer` interface (WebGL + Canvas2D). Used by the CG presentation
  layer for full-screen images.
- Tile quad culling already exists (`renderer/src/tiles.ts`); the world scene draws
  **one `drawTileLayer` call per resident chunk layer** with the same world camera —
  no renderer algorithm changes. World-space offsets are integer pixel values
  (floating-point seam guard, §4).

### 3.3 `packages/runtime` — WorldScene, streaming, combat, audio

- **`BootOptions.worldUrl`** added next to `mapUrl`/`mapData` (decision 13);
  `boot()` branches: world manifest → `WorldScene` (new) instead of `MapScene`.
  `network` with `worldUrl` logs a warning and stays unused (multiplayer in the
  world is out of demo scope; the `mapData` path keeps its existing network).
- **`WorldScene implements Scene`** replaces `MapScene` for world mode:
  chunk store (resident maps + collision grids + entities), prefetch queue, LRU
  eviction, cross-boundary step continuity, combat systems, freeze gate, HUD
  (hearts, gold, world position, key hints), chapter autosaves.
- **Chunk pipeline**: manifest `fetch` → chunk JSON `fetch` (each its own file) →
  **Web Worker parse + zod validation** (main-thread fallback) → entity
  instantiation → collision grid → resident set. Prefetch radius 1, evict radius 2,
  LRU. Crossing into a not-yet-resident target chunk blocks the step (log `warn` —
  must be unreachable in practice thanks to prefetch).
- **Freeze gate**: title / CG / dialogue-open states freeze enemy AI, projectiles,
  and contact damage (player input already gated the same way). This is the
  combat-vs-dialogue interleave rule (§5.4).
- **Scene set**: `TitleScene` (title + audio unlock) → `WorldScene` (explore /
  dialogue / combat interleaved) ↔ `CgScene` (full-screen image + fades,
  skippable) → the end. `SceneManager` (existing State pattern) hosts them; the
  interpreter runs CGs as commands so event pages can script whole cutscenes.
- **Audio manager** (`packages/runtime/src/audio.ts`): one `AudioContext`;
  procedural placeholder BGM (tiny note-sequencer loop on `OscillatorNode`) and
  SFX one-shots (coin ping, sword swish, hit thud, defeated, door, save).
  Unlocked by the title screen's first gesture. Null-safe in headless/jsdom (tests
  inject a fake). Logs `info` lifecycle / `warn` on blocked autoplay.

### 3.4 `packages/editor` — no code changes

Chunks are map v1; the editor opens/edits each chunk as today. World-level data
(manifest, combatants, global store) is agent-authored. Editor support for
world/CG/battle authoring is an **explicit non-goal** (§9).

### 3.5 `samples/` — demo world content

`data/world.json`, `data/chunks/*.json` (nine map-v1 chunk documents), generated
placeholder CG images (`img/cg/opening.png`, `img/cg/ending.png`) and the shared
placeholder tileset atlas — all produced by a checked-in generator script
(`scripts/gen-open-world.mjs`, reproducible, not hand-typed) and validated against
core schemas at generation time. Story per §8.

## 4. World streaming & seam design

- **Load order**: title boots from `www/index.html` (`world` manifest is the single
  entry fetch); spawn chunk + 4 orthogonals + diagonals prefetch (radius 1) start
  immediately after the title screen's first key; the player is released when the
  spawn chunk is resident (first paint budget, §1).
- **Eviction**: chunks beyond radius 2 leave memory (LRU); eviction is **deferred
  while the interpreter holds references** (an event page executing against that
  chunk blocks eviction until it finishes — events are synchronous within a frame,
  so this is a simple counter, not a GC).
- **Seam correctness**: all offsets integer pixel math; adjacent chunks share the
  one tileset; per-chunk `drawTileLayer` calls get the same camera; the boundary
  tile row is owned by exactly one chunk (col/row of `chunkSize` division) so there
  is never double-draw overlap.
- **Determinism**: chunk JSON size for 64×64×2 layers ≈ 80–150 KB → 9 chunks well
  under 2 MB total; worker parse budget < 50 ms per chunk asserted in unit tests.

## 5. Combat design (grid-step Zelda-minimal)

1. **Attack**: confirm key while exploring = sword swing toward facing tile;
   0.35 s cooldown. Any combatant occupying the facing tile takes 1 damage; swing
   plays SFX + short visual flash (draw rect blink), no animation sheets.
2. **Contact**: when a chasing enemy's next step target is the player's tile it
   deals contact damage instead of entering (strict-overlap semantics from
   `movement.ts` are preserved); hitting the player triggers 0.5 s i-frames
   (blinking) and a knock-step back on a free tile.
3. **Enemies** (world layer only, decision 9): `slime` chases along grid with
   `speed` steps/s + dumb steering (dx first, no pathfinding); `turret` stationary,
   fires a projectile every 2.4 s along the row/column toward the player
   (8-tile range, dies on solid tiles). HP/damage from `combatTypes`.
4. **Death flow**: HP → 0 ⇒ fade out → respawn at `spawn` (HP full) ⇒ fade in.
   Globals and chunk deltas stay (§6): no progress loss, no Game Over screen
   (decision 10 — the golden path is 15 minutes; punishing replays is out).
5. **Persistence**: every defeated combatant id lands in `save.chunkState[chunkId]
   .defeatedIds`; on chunk load those combatants are not spawned. Rest spoils-free:
   the demo has no items/countables beyond `variables.gold` (+ HUD).
6. **Freeze gate** (§3.3): dialogue-open or CG ⇒ AI/projectiles/contact checks
   suspended; player input already suspended — the world is globally at rest
   during narrative moments (pre-mortem finding B1).

## 6. CG presentation & audio

- CGs are full-screen stills (`img/cg/*.png`, placeholder-generated per §3.5)
  drawn via `drawTexture` in screen space; `fadeOut`/`fadeIn` are renderer-level
  full-screen rects (both backends), `letterbox` = top/bottom bars; any confirm
  advances/skips, `endCg` restores the world camera.
- Event pages script the full opening/closing via the new commands (decision 14):
  e.g. opening CG page = `bgm "title"` → `fadeOut black 400` → `showCg
  "img/cg/opening.png"` → `fadeIn 600` → `letterbox on` → `showText …` ×n →
  `letterbox off` → `endCg` → `bgm "village"`.
- Audio: single-loop BGM tracks produced by the procedural sequencer
  ("title" / "village" / "wilds" / "fortress" / "ending"); SFX table above.
  Assets are code, not files — nothing to ship in `audio/`, worst case replaced by
  real files later through the same `bgm`/`sfx` refs.

## 7. Save v2

Single save slot (current Storage adapter contract); autosave checkpoints written
at: opening CG end, battle-1 victory, boss victory (decision 17); F5 manual / F9
load; HUD toast + structured log on each write. Reload restores world position,
HP, globals, and `chunkState`; a save whose `worldId` differs from the booted
world is rejected with a `warn` (same contract as v1's mapId check).

## 8. Demo content — "The Crossroads" (story outline)

World = 3×3 chunks, one shared placeholder tileset. Center = **Sunfall Village**
(spawn); north = **Wildmoor** (battle 1: two slimes); east = **Northgate
Fortress** (turret boss before the gate); the remaining chunks are forest road
connectors with signposts and one chest.

1. **Opening CG** — the beacon over the village gutters out; a courier collapses at
   the elder's feet: *"The northroad guards have gone silent. Take this sword."*
   Control hints shown as subtitle lines.
2. **Village (exploration + interaction)** — three talks (elder: task; blacksmith:
   sword lore; child: shortcut hint), one signpost, one chest (+gold, HUD
   counter), gate switch tutorial via a village door.
3. **Wildmoor (battle 1)** — two slimes; victory ⇒ `sw_wilds_cleared` + autosave.
4. **Northgate (climax)** — guard dialogue checks `sw_wilds_cleared` (otherwise
   turned away — the demo's one scripted branch), turret boss; victory ⇒ autosave.
5. **Ending CG** — beacon relit, village cheers, THE END.

Dialogue text is player data and may be Chinese (ADR-007); UI/HUD/strings stay
English. CG images are generated placeholders; real art drops into `img/cg/`
without code changes.

## 9. Non-goals (explicit, to stop scope creep)

- Editor authoring for worlds/CGs/battles (editor receives **zero** changes).
- Video CG playback; voice; sprite-sheet animation for combat.
- Inventory/items/equipment (chests give variables only).
- Multiplayer in world mode (existing map path unaffected).
- Procedural generation; persistence of player-chosen branches beyond switches.
- Performance work beyond §1 budgets (no texture atlas LRU beyond placeholder).

## 10. Testing & QA plan (per 03-wal-process.md §3–§5)

| Layer | Coverage |
|-------|----------|
| Unit (Vitest) | world/save-v2 schema validation & round-trips; coordinate math; new commands; chunk-store policy (prefetch/evict/LRU/evict-blocked-while-running); combat verbs (attack/contact/i-frames/knockback/death); enemy AI steppers; turret projectile lifetime; freeze gate; audio manager with fake `AudioContext`; worker-parse budget + fallback parity |
| Integration | `boot({ worldUrl })` over a fixture 3×3 mini-world (8×8 chunks) — headless run: walk across borders, talk, autosave → reload restores; renderer smoke over both backends |
| E2E (Playwright) | Golden path of §1 incl. ≥2 boundary crossings, both battles, CG skip, autosave + reload, death respawn; frame-stat capture for the crossing budget |
| QA gate | Full order from `AGENTS.md`; run twice for stability; docs corrected in the same change |

Operational note: the container's Playwright browsers need their missing system
libs; plan is extracting the required Debian packages to a user dir +
`LD_LIBRARY_PATH` (no sudo available) — E2E must not silently skip.

## 11. Build order (each stage = its own DoD + tests + doc sync)

- **S0 — Docs** (this proposal + ADRs 008–010): leader review gates everything.
- **S1 — core**: world + save-v2 schemas, coords, new commands. DoD: unit green.
- **S2 — renderer**: `registerTexture`/`drawTexture` both backends. DoD: fixture
  renders identically WebGL/Canvas2D.
- **S3 — runtime**: `WorldScene` streaming + title/CG/audio/save-v2 (no combat).
  DoD: walk a 3×3 fixture crossing every seam, CG plays, audio beeps, save/load
  survives reload — headless integration green.
- **S4 — combat**: §5 systems + death flow. DoD: unit + integration green incl.
  freeze gate.
- **S5 — content + E2E**: generator script, demo world, E2E golden path + frame
  stats. DoD: §1 acceptance verified by an automated runner.
- **S6 — QA gate + serve**: full gate twice; serve the demo to the leader at
  `localhost`; fold leader's play-feedback (combat feel, CG pacing — the
  must-feel-to-judge items) into fixes; docs finalized in the same change.

## 12. Risks & fallbacks (pre-mortem)

| Failure mode | Defense |
|--------------|---------|
| Six features × WAL spread too thin, every feature 80% done | Slice ordering (§11) + per-stage DoD; hard fallbacks: one battle, chase-only AI, static-only CG |
| Crossing hitch destroys the "seamless" promise | E2E frame budgets, worker parse, integer offsets, prefetch radius 1; worst case: raise prefetch to radius 2 |
| Docs/ADR review loop stalls | Single-leader review (the leader + this agent), precise scoped ADRs |
| Audio autoplay surprises | Title screen gesture unlock (decision 16), `warn` log fallback |
| Interpreter references vs chunk eviction | Evict-blocked counter while a page executes (§4) |
| Editor preview feels "left behind" by world mode | Zero editor changes but zero regressions by construction (map v1 pay-load); existing editor E2E must stay green |
## 13. Implementation notes (S1–S5 verified against the branch, 2026-08-26)

The proposal above was implemented on `feat/open-world-demo` (worktree
`work/archie`). The following deltas reconcile the doc with what was actually
built; ADRs 008–010 carry their own notes.

**Core / schemas (S1)**

- `world` v1 gained `intro: EventCommand[]` (opening narrative; gated at runtime
  by `sw_intro_done`) and `worldCombatant.onDefeatSwitch?: string` (story
  switches fired on a combatant's death — used to gate the guard dialogue and
  the ending CG).
- `world.spawn.x/y` are **global** tile coordinates (the village is at grid
  (1,1) → spawn is (96,96), not (32,32)). Confirmed by E2E.
- `save` v2, coordinates, and the CG command set shipped as designed.

**Renderer (S2)** — `registerTexture`/`drawTexture`/`textureReady` shipped on
both backends; cover/fit math shared (`fit.ts`).

**Runtime (S3)**

- `ChunkStore.onLoaded`/`onEvicted` are **writable fields** (not constructor
  options) so the game assembly can late-bind the scene wiring.
- `WorldScene.exit()` is a **backgrounding pause** (input/HUD/subs persist —
  re-enter is a no-op); full teardown moved to `dispose()`, called by
  `world-game.dispose()`. This was the fix for input dying after a CG handoff.
- The intro CG is deferred to the **first world update** (post-title) so a title
  screen precedes it; its dialogue lines are suppressed from the world queue
  (they replay inside the CgScene).

**Combat (S4)**

- The confirm key is **one button for talk + sword**: `attack()` returns true
  only when a combatant is actually on the facing tile, so facing an NPC opens
  dialogue on the same press (Zelda split-key was tried first; it made town
  talk need two presses).
- Chasers gained a **Chebyshev aggro leash** (`aggroRange` on the combat type,
  default 8) — without it a long overland walk got worn down by a cross-chunk
  chase. This is the encounter-design rule: enemies idle until approached.
- Death → black fade → respawn at `world.spawn`, full HP, progress kept.

**Content + E2E (S5)**

- The demo world is generated by `scripts/gen-open-world.mjs` (deterministic,
  self-validating) into `packages/runtime/world-demo/public/` and served by the
  `world-demo` harness (vite). Fortress layout was iterated against the E2E so
  the approach lanes are clear: the sentinel guards an arena east of a
  passable (sprite-less) guard.
- `packages/runtime/e2e/run-world-e2e.mjs` (`pnpm --filter @agenticrpg/runtime
  test:world`) automates the full §1 acceptance path — **14/14 steps green**:
  title → opening CG → village chest/elder → seamless village→wilds crossing →
  two slimes → guard branch → turret sentinel → ending CG → F5/reload restore.

**Playtest feedback pass (2026-08-26, verified against the branch)**

The leader's first playtest produced eight feedback items; all are addressed in
the S6 feedback pass on this branch:

1. **Walls invisible** — the demo previously referenced an atlas PNG that was
   never emitted (404), so tiles rendered as a flat background and solids were
   unreadable. The generator now paints and writes a real 128×128 atlas
   (`img/tilesets/placeholder.png`, pure-Node PNG encoder + deterministic pixel
   painters: grass / path / water / masonry rock / flowers). Wall faces keep a
   bright crest (top edge of a solid run); open water needs no overlay.
2. **Movement too slow** — step duration 0.15 s → 0.09 s, repeat delay
   0.25 s → 0.20 s.
3. **Opening CG unclear** — the stills were redesigned in the generator: the
   opening now shows the cold beacon over village roofs ("the beacon has gone
   dark — light it in the north"), the ending a burning beacon on its tower.
4. **Player facing unclear** — a white chevron on the hero sprite always points
   where the player looks.
5. **Swing invisible** — a sword slash mark flashes on the facing tile while a
   swing is live (`world-combat.attack()` reporting + `SWING_FLASH_SECONDS`).
6. **Enemy attacks unclear** — turret shots are telegraphed by a growing charge
   core (yellow → red at release), hits flash white on enemies / red on the
   player, projectiles render as bright bolts with white cores.
7. **No guidance** — an objective line (`hud-objective`, `objectiveHint`)
   driven by the story switches states the current goal at all times.
8. **Everything is abstract squares** — composed rect mini-sprites
   (`world-sprites.ts`, unit-tested): hero (tunic/sword hilt/facing chevron),
   villagers tinted per role, slimes with eyes and hit-flash, turret sentries,
   plus props drawn for chest/signpost/beacon (the beacon flames once
   `sw_boss_defeated` is set).

The world golden-path E2E stays 14/14 after the pass.

**Playtest feedback pass 2 (2026-08-26, verified against the branch)**

The leader's second playtest round produced three more items; all fixed here:

1. **Camera too far out / character too small** — the world now renders through
   a zoomed follow camera (`CAMERA_ZOOM = 3`, ~13×10 visible tiles on the
   640×480 canvas): `setCamera(viewport, zoom)` drives the renderer projection
   (ADR-002), the view eases toward the player (`CAMERA_LERP_RATE`), and is
   clamped to world bounds. Zoom stays integer so rounded world-pixel camera
   coordinates keep every rect on integer screen pixels (no shimmer/seams).
   Small view volume = fewer resident chunks to draw per frame.
2. **Movement stuttered (stop-start)** — the old model stepped only on press
   edges plus a 0.2 s repeat delay; held directions paused between steps.
   Walking is now continuous: while a direction stays held each completed glide
   flows into the next attempt (blocked tiles retry on a 0.12 s cadence so
   collision/log are not hammered per frame). A tap shorter than one simulation
   frame still steps — direction edges survive release, fixing E2E-style
   instant key presses that previously ate inputs.
3. **"Two white bars" at boot** — not CG art at all: the world HUD hint +
   objective strips stayed on screen above title/CG because the scene was
   already mounted before the title. The UI layer (`uiRoot`) is now hidden
   until the title hands off (`WorldGame.setHudVisible`, wired in boot +
   CgScene handoff) — title/CG render alone.

Tests: three new WorldScene unit regressions (continuous walk coverage,
one-tile-per-tap, sub-frame tap) plus the zoomed-camera assertions; the world
golden-path E2E stays 14/14 with the approach helper updated for solid chest/
NPC tiles (sprites now block, so approach coordinates changed).
