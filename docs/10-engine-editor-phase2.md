# Engine/Editor Phase 2 — On-Demand Map Loading & Interiors (Doors → Indoor Maps)

> Design proposal for discussion. **Status: DRAFT — leader to review.** Every
> "recommended" option below is the engine member's proposal from the 2026-08-26
> round-1 discussion and is subject to leader confirmation. Nothing here is
> implemented yet; per the WAL rule this document precedes any code.

## Metadata

- **Status:** DRAFT (discussion round 2 open)
- **Date:** 2026-08-27
- **Author:** AgenticRPGMaker Bot (engine member proposal; leader to review)
- **Related:** [ADR-011](./04-adr/ADR-011.md) (multi-area worlds + transfer
  command, drafted alongside), ADR-008 (world streaming), ADR-003 (map v1)

## 1. What the leader asked for

Two items, quoted from the playtest discussion:

1. **按需加载地图,减少负载** — load maps on demand, reduce the load.
2. **支持房子和房间** — support houses/rooms: opening a door enters the house,
   whose interior is a new map.

## 2. Ground truth first (what the codebase already does)

Facts verified against `feat/open-world-demo` before designing anything — they
reshape both features:

- **World chunks are already on-demand.** `ChunkStore` (ADR-008 §4) streams
  resident chunks with prefetch radius 1, evicts beyond radius 2 (LRU), parses
  payloads off-thread in a worker, and only fetches a chunk when the player
  approaches it. Item 1 is therefore *already shipped* for the world pipeline.
- **The current payload is small.** The whole demo chunk set is ~970 KB raw /
  ~150 KB gzipped; the atlas PNG is 645 B. There is no *felt* load problem at
  MVP scale — pressure appears when worlds grow (more/larger chunks, bigger
  atlases, audio).
- **There is no transfer command.** The interpreter command set ends at
  showText / setVariable / setSwitch / playSound / walk / move / CG + audio
  steps. "Enter a door" has nowhere to live until one exists.
- **The world manifest is a single flat grid**, and the editor's project v1 is
  a flat `maps[]` list whose preview runs the single-map `MapScene`. Neither
  data model knows what an "indoor map" is.

Consequence: items 1 and 2 are likely **one feature seen from two sides** —
doors that lead to separate maps immediately imply those interiors load on
transfer. That collapse is proposed below as Recommendation R1-A/R2-A; if the
leader means something else by "reduce load", Q-b below re-opens it.

## 3. Feature 1 — On-demand loading (scope decision)

### R1-A (recommended): payload size reduction + keep world streaming as-is

Keep the streaming architecture (it works) and attack the actual weight — tile
data encoded as JSON integer arrays:

| Change | Where | Effect |
| --- | --- | --- |
| **RLE-encode ground/collider layers** (`data: [[value, run], …]`) | core schema v2 of map OR sidecar encoding at fetch layer | ~10–20× smaller JSON for run-heavy terrain |
| Or: binary `Uint16Array` payload (+ tiny JSON header), still fetched via worker | chunk-fetch/parser | smallest wire size; needs content-type discipline |
| Asset lazy-loading | runtime texture manager | atlases/audio load when their chunk resolves |

- Acceptance target (proposed): ≤ 200 KB transfer for first-playable state;
  ≥ 70 % size reduction vs. current JSON baseline.
- Encoding choice (RLE vs binary) is an implementation detail decided by a
  spike measuring both against real generator output; schema stays map-v1
  compatible by bumping a **layer codec field** with graceful fallback so the
  editor keeps reading/writing plain arrays.

**R1-B (kept in reserve):** if the leader meant editor/www single-map games
(`MapScene` loads the whole map eagerly), that is a real but separate change;
with current sample sizes it shows no felt pain, so we propose deferring it
(YAGNI) and revisiting when real maps exceed ~128×128.

## 4. Feature 2 — Houses & rooms

### R2-A (recommended): multi-area worlds

Extend the world manifest with named **areas**: the main overworld grid plus
one small grid per interior. Interiors reuse everything the overworld already
has — ChunkStore residency, collision, save-v2 deltas, combat spawn tables —
just scoped to their own area id. No second map-runtime is created. Full design
in [ADR-011](./04-adr/ADR-011.md):

```
areas: [
  { id: "overworld", grid {cols, rows}, chunks[…] },   // existing grid lifted in
  { id: "house_smith", grid {cols:1, rows:1}, chunks[…] }
]
spawn: { areaId: "overworld", … }                        // optional, defaults to first area
saveV2: + areaId (optional, default = first area)        // old saves keep working
combatants / combatTypes stay per-chunk/per-world — interiors simply have none
```

**R2-B (rejected by proposal):** a second lightweight SingleMapScene for
interiors — creates two map runtimes to maintain, splits save semantics, and
re-solves problems ChunkStore already solved.
**R2-C (explicitly not chosen):** draw interiors in far corners of the
overworld grid under fake roofs — zero schema work but scales badly and leaks
through every minimap/save/E2E assumption forever.

### Door = transfer event

New interpreter command (see ADR-011 for exact shape):

```
{ cmd: "transfer", args: ["house_smith", 8, 6] }                 // areaId, x, y
→ optional flags: direction, transition ("fade" | "none"), bgm ref
```

- Doors become ordinary events — no new entity type, no editor entity class.
  Round-trip fade (black → swap area+position → fade in) composes from the new
  command plus the existing fadeOut/fadeIn CG steps, or `transition: "fade"`
  performs the standard sequence itself.
- The target area's chunks begin fetching during the fade-out — the player
  never stares at a loading screen for a 1×1 interior.
- Authors fill coordinates by hand for now (**R2 doors: manual parameters**);
  a two-ended door-linking tool is a future editor enhancement, deliberately
  out of scope here.

### Save compatibility

`areaId` joins save-v2 as an **optional** field defaulting to the first area:
old saves load unchanged (no version bump). Per-chunk defeated ids and opened
switches already key off chunk ids which become area-scoped through naming
(`"<area>:<chunk>"` or unique chunk ids across areas — final call in review).

## 5. Editor impact (this phase, minimal by design)

The editor gets exactly two touches; visual door-wiring tools stay out:

1. Event panel: expose `transfer` with plain fields (target area dropdown fed
   by project maps/areas, x/y number inputs).
2. The chunk documents authored for areas remain ordinary map-v1 files, so no
   editor schema change is required to author them.

Multi-map editor projects (room list, thumbnail navigation, project-level area
modeling) move to a later phase after the runtime proves the design.

## 6. Explicit non-goals (scope fence)

- No procedural/dynamically generated interiors.
- No multi-storey buildings beyond what transfer naturally solves (stairs are
  just another door); no indoor NPCs-follow-between-maps logic.
- No multiplayer changes this round.
- No editor door-link graph UI this round.
- No rewrite of MapScene for the www/editor preview path (R1-B stands deferred).

## 7. Risks & pre-mortem

| Risk | Mitigation |
| --- | --- |
| Area-scoped combat table half-migrates, enemies leak indoors | Combatants live on chunk entries inside each area; interiors declare zero combatants. Golden-path E2E asserts indoor tile has no combatants. |
| Save restores into an evicted interior chunk | Existing boot flow already rebuilds residency around spawn; extend spawn resolution to `{areaId, x, y}`. E2E: save inside house → reload → restore inside house. |
| Codec switch breaks old editor exports | Layer codec is opt-in with fallback decode path; all existing fixtures keep passing unchanged. |
| Two encodings drift apart | One canonical encoder lives next to the schema; generator and tests share it. |
| Transfer during combat / mid-dialogue edge cases | Interpreter gate: `transfer` disabled while dialogue open or player dead (same freeze-gate family as combat, ADR-009 §5.5); E2E covers door-spam. |

## 8. Open questions carried into round 2 (leader to answer)

- **Q-a:** Wire format — RLE-in-JSON (simpler, debuggable) vs binary Uint16
  payload (smaller, opaque)? Proposal: spike both, pick by measured bytes on
  the demo world. Default if forced today: RLE-in-JSON.
- **Q-b:** Confirm R1 scope — accept "payload reduction + keep streaming"
  instead of reading item 1 as anything else?
- **Q-c:** Save/schema detail — encode area scoping in chunk ids vs add explicit
  `areaId` column on chunks. Proposal: explicit field; ids stay strings.
- **Q-d:** Does the smith-house interior ship as demo content this round, or is
  a test fixture enough? Proposal: one small demo interior ("smithy") as the
  showcase, since the feature exists precisely for this.
