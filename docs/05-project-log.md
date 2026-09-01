# AgenticRPGMaker — Project Log

Append-only running log of the project. Newest entry goes at the **top** of the list.
Date format: `YYYY-MM-DD`.

---

## 2026-09-01 — Task 20: quest chapter 2 "The Ferryman's Ledger" — the slice grows a fourth map

Owner-selected content extension (choice recorded in
[discussion/2026-09-01-quest-chapter-2.md](./discussion/2026-09-01-quest-chapter-2.md)),
shipped as pure data — no core/schema/engine changes
([task doc](./task/20-quest-chapter-2.md)):

- **Story:** after the chapter-1 reward, Elder Rowan sends the courier to
  collect Old Pol's 30-coin ferry debt at the new **Riverbank Landing**
  (`map_quest_river`); Pol offers a demand/work-it-off choice
  (`showChoices` → `ferry_choice`), Herbalist Mira sells a 10-coin remedy,
  and the elder's closing thanks branches on how the debt was settled —
  the worked branch plants a Millbrook chapter-3 hook.
- **Capabilities exercised for the first time by content:** comparison page
  conditions beyond `eq` (`gte` on gold for Mira's offer, `lt 0` for choice
  re-offer), negative `setVariable` (spending), a gated transfer (east road
  sealed until `sw_ch2_started`), a multi-page purchase loop
  (offer → buy → owned, one-shot-guarded), and a second patrol NPC whose
  talk follows the task-19 live-body rule.
- **First-match page ladders** are the load-bearing design (single-clause
  conditions only): the elder now carries a 6-page ladder (settled-by-choice
  thanks ×2 → in-progress → ch-2 hook → ch-1 reward → intro), Pol a 4-page
  ladder with the `sw_debt_settled` guard page first so a re-talk can never
  re-run a payment. The extended `quest-slice.test.ts` asserts the ladders,
  the closed transfer graph, and the one-shot guards (core 121 green).
- **Quest E2E: 39 → 75 steps, all green** against the rebuilt `www/`: gated
  sealed-wall text before the hook, the full Pol/Mira/elder loops, and a
  bounded patrol talk with the new Dock Worker. Baseline E2E 21/21,
  multiplayer smoke 13/13, unit 301 ×2, ctest 41/41.

## 2026-09-01 — Task 21: title screen — New Game / Continue, cross-map restore, autosave

Owner addition to the chapter-2 effort ("开始屏幕可以开始新的游戏或者继续已有的
游戏"), landed first so the quest E2E boots through it once
([task doc](./task/21-title-screen-continue.md), discussion in
[2026-09-01-quest-chapter-2.md](./discussion/2026-09-01-quest-chapter-2.md)):

- **Title screen** (`title-screen.ts`, new; `BootOptions.titleScreen`, default
  false): DOM New Game / Continue overlay attached as `Game.title`; Continue
  stays disabled until a storage read finds a save. The handle is drivable
  headlessly (`choose()`), so the flow is unit-tested without a browser; the
  www entry enables it for single-player sessions only (no `?server=`), so
  the multiplayer smoke boots straight into the game.
- **Cross-map continue** (`game.continue()`): a save made on another map now
  swaps the playable scene through the task-17 loader seam (the transfer path's
  scene construction extracted into a shared `buildNextScene`), then applies
  the save there — previously same-map saves only.
- **Autosave on transfer:** every successful map transfer saves automatically,
  giving Continue real progress to restore (manual S/L keys unchanged).
- **Quest E2E** grew the title prologue (fresh profile → Continue disabled →
  New Game) and a mid-quest reload → Continue round-trip that restores the cave
  session across maps (save on the cave, boot map the village) — **42/42**.
  Baseline E2E hardened against the pre-existing reload race (auto-load
  applies after the HUD mounts): still **21/21**. Multiplayer smoke **13/13**
  (unaffected by design); unit 300 green ×2; ctest 41/41.

## 2026-08-31 — Task 19: interaction follows the body — patrol + talk is deterministic

Owner-selected next phase after the vertical slice (the task-18 finding became a
task). One engine-semantic fix, QA gate green:

- **The rule** (`packages/runtime/src/map-scene.ts`): the faced tile now hits
  the event whose 1×1 body AABB at its **live transform position** strictly
  overlaps it — the same strict-overlap rule `checkStep()` already applies to
  solid bodies. Before, interaction matched the event's **authored**
  `event.x/y` while a patrolling entity carried its solid collider away, so
  talk and collision used different frames of reference (the home tile stayed
  "talkable" while the body blocked two other tiles mid-move).
- **Consequences:** at rest, an NPC is interactable from exactly its tile —
  static events (triggers, doors, crates) behave byte-for-byte as before; a
  mid-move NPC is interactable from **both** tiles its body spans, which are
  precisely the tiles it currently blocks ("can talk to" ≡ "am blocked by").
  The authored tile is now only the spawn/home position. No core/schema change.
- **Sample:** the quest slime regains its patrol (`evt_slime` waypoints
  (5,5)↔(4,5)) — the task-18 workaround is reverted; the slime now actually
  guards the forest-road corridor its text describes. The quest E2E talks to it
  from (6,5) with a bounded face/interact retry (the body rests exactly on
  (4,5) for ≤1 tick per cycle; otherwise (5,5) is always spanned), and the
  stale "patrolling slime" comments are now true. Still **39/39 steps**.
- **Tests:** runtime unit suite +3 (mid-move talkable from both spanned tiles
  and not a third; vacated home tile inert while the collider moved with the
  body — the player can stand there and talk; stacked events resolve in map
  authoring order). 105 runtime tests green; baseline E2E 21/21 (its demo
  fixture NPC is static — unaffected).

## 2026-08-31 — Next phase per owner decision: task 16 shipped, loader seam fixed, vertical slice playable

Owner decision (`discussion/2026-08-31-next-phase-vertical-slice.md`): finish
task 16, then make the next phase a **playable vertical slice**. Three changes
landed (each QA-gated):

- **Task 16 — `showChoices` (commit `6fa2832`, tag `engine-0.2.0`):** the
  question → answer → branch loop closed; details in the task-16 entry below.
- **Task 17 — boot map-loader seam (commit `dce7b1c`):** WAL correction — the
  batch-2 note claiming "boot injects the real loader" was wrong:
  `CreateGameOptions.loadMap` existed but only tests injected it, so transfers
  were inert in the deployed www build. `BootOptions.loadMap` now forwards to
  `createGame`, and `scripts/www-entry.ts` injects a bundle-backed loader
  (manifest maps are preloaded, so transfers resolve in-memory).
- **Task 18 — vertical slice "The Lost Shipment":** three new data-first maps
  (`quest-village` / `quest-forest` / `quest-cave`) + `lost-shipment.project`
  (sorts first, so `build:www` ships the QUEST as the default www experience;
  town-square stays bundled behind the `map` URL override). One quest exercises
  every current capability: dialogue → switch-gated quest → choice-variable
  branching (slime fight/flee) → 4 map transfers with state carried across →
  crate discovery switch → reward (+25 gold, once) → done page. Content found
  and fixed a real engine-semantic issue: interaction resolves at the event's
  registered tile while a patrolling entity carries the solid collider with it,
  so patrol + talk on one NPC is nondeterministic — the slime is a static
  blocker and the cave bat carries the behavior demo (future engine task may
  decouple interaction tile from body position; see the task-18 doc).

Acceptance: core quest-data test (transfer graph closed, state references
declared, win chain) green; new `pnpm --filter @agenticrpg/runtime test:quest`
plays the whole quest in a real browser against the shipped `www/` build —
**39/39 steps pass** (also added to the AGENTS.md QA gate list).

## 2026-08-31 — Task 16: dialogue choices (`showChoices`) close the question → answer → branch loop

The interaction loop is no longer one-way (task 16, status `done`, QA gate green):

- **Core** — `ShowChoicesCommand` (cmd `"showChoices"`, args `[variable, ...options]`,
  fail-fast below two options) records a `choice` effect and publishes a
  `ChoiceEvent` (`{ variable, options }`) on the bus; the core declares the
  question only, it never renders UI.
- **Runtime** — `MapScene` subscribes to `choice`: a DOM option list
  (`data-testid="choice-box"`, dialogue-box styling) opens with the selection at
  index 0; while open, up/down wrap the selection, confirm writes the selected
  index into the variable, cancel writes `-1`, and movement/dialogue input is
  frozen. Headless tests observe `isChoiceOpen` / `currentChoice`.
- **Sample** — a `Riddle Keeper` NPC in town-square demonstrates the full loop
  (ask → answer → branch): correct answer +5 gold, wrong answer rebuffs,
  cancel leaves the riddle standing. Implementation note now recorded in the
  task doc: `selectPage` is first-match and `null` always matches, so branch
  pages must precede the ask page.
- **Page model** — `showChoices` is an async UI: put it last in a page; the
  question text stays visible while choosing and is dismissed with one confirm;
  the answer is read on the next interaction via variable conditions (task 15).
  A suspend/resume interpreter remains future work.

Test counts: **284 web** (core 116 + renderer 68 + runtime 100) + C++ ctest (41)
green; `pnpm validate` green on 4 sample documents.

## 2026-08-31 — Engine optimization batch 2 (tasks 14–15): map transfer + variable conditions

Continuing the goal-driven optimization session (`goal-116db185`), WAL-following
tasks, QA gate green, committed and pushed to `main`:

- **Task 14** (`df30d36`) — **map transfer** (the engine left single-map
  territory): an event-page `transfer` command (`{ cmd: "transfer", args:
  [mapId, x?, y?, direction?] }`) publishes a typed `transfer` gameplay event;
  `createGame` listens, async-loads the target map (new `CreateGameOptions.
  loadMap` callback — boot injects the real loader, tests inject stubs),
  rebuilds SceneGraph/interpreter/MapScene, and `SceneManager.change`s — with a
  `transferInFlight` guard and `autoLoad:false` so the transfer position wins.
  `game.scene` + `save`/`load` now follow the live scene after a swap. Sample:
  `house.map.json` (interior with exit door) + a House Door event in
  town-square; `build:www` ships both maps.
- **Task 15** (`1d5736c`) — **variable-based page conditions**: `eventPageCondition
  Schema` widened to a structural union `{switchId, value}` | `{variableId, op,
  value}` (op ∈ eq/ne/gt/gte/lt/lte), `evaluateCondition` compares `getVariable`;
  switch-only data is untouched (backward compatible). Enables data-first
  branching on progress numbers (the merchant now greets wealthy customers when
  `gold ≥ 20`, demonstrating first-match page selection on a variable).

Test counts at this batch's end: **277 web** (core 114 + renderer 68 + runtime
95) + C++ ctest (41) green; `pnpm validate` green on 4 sample documents;
doc-lint green (37 docs).

## 2026-08-31 — Engine optimization batch 1 (tasks 06–13): defects, seams, customizability, perf

Goal-driven optimization session (goal `goal-116db185`, "优化 AgenticRPGMaker 引擎
core/renderer/runtime") delivered eight WAL-following tasks, each with docs-first task
docs, QA gate green (build/typecheck/lint/format/doc:lint/test/validate), committed
and pushed to `main`:

- **Task 06** (`69f466f`) — fix multiplayer pageerror "reading 'x'": server's
  `welcome` now always carries a `state` per member (no state-less members;
  protocol-consistent); client `handleWelcome`/`handleRemoteState` defensively
  tolerate missing state. Regression tests on both sides.
- **Task 07** (`6c6ef41`) — `PlatformCapabilities` probe (`probePlatformCapabilities`):
  the runtime-level portable-first seam docs/06-architecture.md §7 promised but code
  lacked (WAL gap). Reports renderer backend / input / storage / audio, never throws,
  probes injectable; logged at boot.
- **Task 08** (`6241f59`) — open event command system: `CommandRegistry` +
  `CommandFactory` (register/has/build, fail-fast on unknown), built-ins seeded in
  `defaultCommandRegistry`, `EventInterpreter` accepts an injected registry. RPG-Maker
  plugin-command model for AI-authored data (D24).
- **Task 09** (`7d8605e`) — wire the Behavior system into the runtime end to end:
  `eventBehaviorSchema` (rule-based patrol) on map events → `buildBehaviorFromConfig`
  → `SceneGraph.buildEventEntity` attaches the strategy → `MapScene.updateBehaviors`
  drives it each tick (move/face/say). Sample merchant NPC now patrols (D24 data-first).
- **Task 10** (`808f737`) — interpreter command cache: `WeakMap<EventPage, Command[]>`
  so repeated event executions (dialogue/NPC triggers) don't re-run the schema→Command
  factory; `clearCommandCache()` invalidation.
- **Task 11** (`ca8a4a8`) — boot no longer probes the renderer twice: the platform
  probe accepts the already-known backend (`rendererBackend`), skipping a duplicate
  WebGL/2D context creation on weak JoiPlay runtimes.
- **Task 12** (`df356d3`) — runtime caches sprite/behavior entity lists at scene enter:
  `drawNpcs`/`updateBehaviors` no longer re-walk the scene tree per frame
  (`findEntitiesByComponent` only at `enter()`, not in the per-frame path).
- **Task 13** (`199f38c`) — Canvas2D backend (JoiPlay fallback) caches static tile
  layers offscreen: build once, blit the visible region per frame in ONE `drawImage`
  (was one per visible tile, ~300/frame at 320×240/16px); pixel-budget cap falls back
  to the per-tile path for huge maps; rebuilt on atlas revision change.

Test counts at this batch's end: **268 web** (core 107 + renderer 68 + runtime 93) +
C++ ctest (41) green; `pnpm validate` green on samples (incl. the merchant behavior);
doc-lint green (34 docs).

## 2026-08-31 — Repository re-orientation: editor-less portable-first engine (D20–D25, ADR-008)

The user asked to survey open-source projects (Tyrano, open-source RPG
engines/games), then re-organize the docs and development branches, and
re-examine the repository design. Because development is primarily auto-generated
code, the editor is removed until a real game exists; the engine is portable-first
(browser + JoiPlay today) with reserved WebGPU/WASM seams.

**Decisions (Round 4, D20–D25 — all user-confirmed; full verbatim record in
[docs/discussion/2026-08-31-reorg.md](./discussion/2026-08-31-reorg.md))**

- **D20 — editor disposition:** removed `packages/editor` from `main`; archived
  via git tag `archive/editor-0.1.0`; restore when a real game justifies it.
- **D21 — multi-backend scope:** portable-first engine on every target (browser +
  JoiPlay today); performance (vgpu/wasm) researched after.
- **D22 — C++ server:** kept but demoted to an optional component.
- **D23 — performance route:** portable first; reserve WebGPU renderer backend +
  WASM core as seams, no investment now.
- **D24 — authoring mainline:** AI/agent-authored versioned JSON → `core`
  validates → runtime runs; `pnpm validate` is the agent-facing gate.
- **D25 — dev workflow & branches:** module-scoped short-lived branches +
  validate-first; historical branches archived via local tags; **no remote branch
  deletion** (C3).

**What changed (this pass)**

- **Code/tooling:** `packages/editor` deleted (tag `archive/editor-0.1.0`);
  `scripts/build-deploy.mjs` and `scripts/verify-deploy.mjs` no longer build/mount
  the editor; new `scripts/validate.mjs` + `pnpm validate` (agent data gate, D24);
  root `package.json` description updated; `AGENTS.md` layout/scripts/QA updated.
- **Docs:** `02-open-questions.md` gains Round 4 (D20–D25); new `ADR-008`
  (portable-first, editor-less, multi-backend); `ADR-006` marked superseded;
  `03-wal-process.md` §4 rewritten to the new workflow (§3 stack confirmed, §8
  seams updated); `docs/discussion/2026-08-31-reorg.md`, `docs/principle/*`,
  `docs/task/*` added (discussion/principle/task records per D18/D19 form).
- **Branches:** local archive tags for all historical remote branches
  (`archive/design-a` … `archive/feat-p6-playtest-fixes`); remote branches left
  untouched (C3).
- **Survey takeaways** recorded in the discussion doc (TyranoScript = VN engine
  with tag+plugin model; RPG Paper Maker = separate editor/runtime over JSON;
  JoiPlay runs MV/MZ from their `www` HTML5 folder; `rpg-maker-agent` /
  `Shinsekai` show AI-authored games need only schema + interpreter).

**Gate:** `pnpm doc:lint` green; full QA gate re-run (build/typecheck/lint/
format/test/validate/deploy) — see the re-org task docs in `docs/task/`.

## 2026-08-25 — MVP implementation complete (P0–P5 merged to main @ 94da8da); P6 release: docs aligned to implementation

MVP implementation phases **P0–P5 are all merged to main** (`origin/main` @
`94da8da`). **P6 = WAL doc-correction pass**: per the WAL rule (docs corrected /
finalized in the same change as the code), the docs were aligned to what was
actually built.

**Details**

- **Phases merged to main:**
  - **P0** — scaffold: monorepo, `packages/core` zod v1 schemas, skeleton packages,
    C++ CMake server skeleton, `AGENTS.md`, doc-lint script.
  - **P1** — engine-core: core data model + event interpreter + protocol v1 (P1a),
    renderer WebGL/Canvas2D behind the interface (P1b), runtime boot/scenes/
    movement/collision/dialogue/saves/multiplayer client (P1c).
  - **P2** — editor: React + TS + Vite map/event editor, IndexedDB project storage,
    import/export, runtime preview.
  - **P3** — server: C++20 relay/state-sync, custom HTTP static hosting,
    WebSocket `/ws`, rate limiting, heartbeats, spdlog, Catch2.
  - **P4** — QA hardening: three-layer suite consolidated; two-context multiplayer
    smoke test.
  - **P5** — packaging/deploy: portable `www/` + single binary (`build:www` /
    `build:deploy` / `verify:deploy`), local + VPS modes, samples.
- **Test counts at the P5 gate:** **306 web** (Vitest, all packages) + **41 C++**
  (Catch2 via ctest) + **verify:deploy 23** (checks in `scripts/verify-deploy.mjs`).
- **P6 doc-correction entry (this one):** docs aligned to implementation —
  collision strict-overlap convention + input/movement semantics + boot API
  (`boot({ canvas, root, mapUrl|mapData, ... })`, no `dataUrl`) +
  server-bind (0.0.0.0) notes in `06-architecture.md`; ADR-006 global-data
  correction (per-map variables/switches, no common-events schema, export =
  `data/` + README); ADR-005 implementation notes (`defer_http_response()`,
  `asio_no_tls` configs, room auto-create via `getOrCreateRoom`); docs/08
  `Buffer(` false-positive note. Each change is marked "verified against
  implementation (P6)". `pnpm doc:lint` green.

## 2026-08-25 — P0 scaffold complete; P1 started

P0 scaffold complete (`feat/p0-scaffold` @ `50dd218`): monorepo skeleton,
`packages/core` zod v1 schemas (43 Vitest tests green), renderer/runtime/editor
skeletons, C++ CMake server skeleton (asio/websocketpp/spdlog/catch2 pinned,
ctest 2/2), `AGENTS.md`, doc-lint script; P0 under merge-manager gate check; P1
dispatched in parallel (core engine P1a + renderer P1b).

**Details**

- P0 (`feat/p0-scaffold`) produced: monorepo layout, `packages/core` v1 JSON
  schemas validated by zod (43 Vitest tests passing), skeleton packages
  (renderer / runtime / editor), C++ CMake server skeleton with pinned deps
  (asio, websocketpp, spdlog, catch2) and ctest 2/2 green, `AGENTS.md` onboarding
  doc, and the doc-lint script (per D19 / ADR-007).
- P0 is at the merge-manager's gate check (see `work/merge-main`); merge to `main`
  handled by the merge-manager, not here.
- P1 dispatched in parallel: **P1a** (core engine) and **P1b** (renderer).

## 2026-08-25 — Phase A approved; agentic-operability decisions (D17–D19); ADR-007 accepted

The user approved **Phase A** (design docs) and confirmed **zod**. New Round 3
decisions recorded: **D17–D19** (all-English, agent-operable scope, docs form);
**ADR-007** (agentic operability & agent-readable docs) accepted. Design branches
**design/a** (`634f6f7`), **design/b** (`dfb937a`), **design/c** (`e6c83b0`) are
complete; the **merge-manager is merging Phase A to main**.

**Details**

- `docs/04-adr/ADR-007.md` created (status: accepted) — all-English engineering
  rule; `AGENTS.md` onboarding doc + doc structure conventions + link/status lint
  in CI (baseline tier, IN MVP); editor headless CLI / runtime headless test mode /
  server control API (upper tiers, designed-now / implemented-later via reserved
  seams, NOT in MVP).
- [02-open-questions.md](./02-open-questions.md): new "Round 3 — decided" section
  with D17/D18/D19 (status=decided, "user decided"); D14 gains a zod confirmation
  note (validation library = zod, user-confirmed, resolves ADR-003's
  "choice to be confirmed" flag); history table extended with D17–D19 and the
  Phase A approval note.
- [03-wal-process.md](./03-wal-process.md): new sections 7 (ALL-ENGLISH) and 8
  (AGENT-READABLE DOCS & agent operability) added to the playbook.
- [01-vision.md](./01-vision.md): engineering rules 5 (all-English) and 6
  (agent-readable docs + agent-operable baseline) added; header + §6 + footer
  updated with Phase A approval and D17–D19.
- zod is the single documented runtime dependency of `packages/core` (or a thin
  adapter — decide at implementation; ADR-003 flags this).

## 2026-08-25 — Phase A reorganized: design member stalled, split into 3 parallel members

The original architecture design member (branch `design/architecture`) ran ~2 goal
rounds with zero files on disk; after a queued status probe it could not be reached
mid-turn, so it was interrupted (per leader stall protocol) and **Phase A was
re-delegated to three parallel design members with ISOLATED git worktrees** (no
file collisions) and disjoint file ownership:

- **Design-A** (`work/design-a`, branch `design/a`): `docs/06-architecture.md` +
  `docs/07-mvp-plan.md`
- **Design-B** (`work/design-b`, branch `design/b`): `docs/04-adr/ADR-001.md`,
  `ADR-002.md`, `ADR-003.md`
- **Design-C** (`work/design-c`, branch `design/c`): `docs/04-adr/ADR-004.md`,
  `ADR-005.md`, `ADR-006.md` + `docs/08-compatibility-checklist.md` +
  `docs/README.md` index

All decisions **D1–D16** remain in force (see [02-open-questions.md](./02-open-questions.md)).
Merge to main deferred to the merge-manager. The interrupted member's branch
`design/architecture` is unpushed, clean, at an old commit — **candidate for
deletion at merge time**.

**Details**

- Supersedes the single-architecture-member kickoff entry below (same date).
- `work/` added to `.gitignore` so the three design members' worktrees do not
  pollute `git status`.
- Disjoint file ownership prevents write collisions across the three members.

## 2026-08-25 — Consensus confirmed (D1–D16); Phase A kicked off

> ⚠️ *Superseded by the entry above — Phase A was reorganized into 3 parallel design
> members.* Kept for history.

Consensus confirmed: the user approved all **D1–D16** at the consensus gate
("确认共识，先进 Phase A 设计文档") and chose **Phase A** (detailed design docs
before code). **Architecture design member assigned** (branch `design/architecture`):
deliverables `docs/06-architecture.md`, `ADR-001..006`,
`docs/07-mvp-plan.md`, `docs/08-compatibility-checklist.md`, `docs/README.md`
index update. Awaiting design completion for user review.

**Details**

- D12–D16 flipped from `pending sign-off` to `decided` in
  [02-open-questions.md](./02-open-questions.md), each marked "user confirmed at
  consensus gate": D12 IndexedDB project storage (import/export to folder; C++ file
  persistence phase 2); D13 React + TS + Vite editor (runtime stays vanilla TS);
  D14 versioned JSON schema (shared TS types) for maps/events/saves/protocol;
  D15 monorepo packages/core, renderer, runtime, editor + server (C++) + samples,
  pnpm, Vitest + Playwright + Catch2; D16 MVP sync = player-state only, world-state
  sync a documented MVP limitation.
- All 16 decisions (Q1–Q6, RQ1–RQ5, D12–D16) are now `decided`.
- Phase A kicked off: architecture design member produces the design docs
  (06-architecture.md, ADR-001..006, 07-mvp-plan.md, 08-compatibility-checklist.md,
  README index update) on branch `design/architecture`, for user review.
- [01-vision.md](./01-vision.md) updated: D12–D16 signed-off references refreshed.

## 2026-08-25 — Round 2 resolved

Round 2 answered (RQ1–RQ5, all decided). Decision summary D1–D16 presented to user;
D12–D16 proposed defaults pending sign-off. Blind-spot closure done: world-state
desync documented as MVP limitation; JoiPlay untestable from dev side →
compatibility checklist needed.

**Details**

- RQ1–RQ5 flipped from `pending` to `decided` in
  [02-open-questions.md](./02-open-questions.md), each with a resolution note
  (all leader-recommended options accepted; RQ1 = user confirmed the portable-`www`
  reinterpretation).
- Decision summary renumbered **D1–D16**: D1–D11 = Q1–Q6 + RQ1–RQ5 (decided);
  **D12–D16** = new proposed defaults, **pending sign-off**: D12 editor project
  storage (IndexedDB), D13 editor UI (React + TS + Vite), D14 data formats (versioned
  JSON schema), D15 repo structure (monorepo, pnpm, Vitest/Playwright/Catch2),
  D16 MVP sync scope (player-state only; world-state sync a documented MVP
  limitation).
- Blind-spot closure:
  - **World-state desync** (doors/switches/NPCs diverging per client) documented as
    an MVP limitation — future path: host-authoritative world state or embedded-JS
    authoritative server.
  - **JoiPlay** is not testable from the dev side → a **compatibility checklist** is
    needed for the JoiPlay/WebView target.
- [01-vision.md](./01-vision.md) updated: MVP sync-scope limitation noted (players
  only).

## 2026-08-25 — Round 1 resolved, Round 2 opened

Round 1 answered (Q1–Q6): Q1 reinterpreted as portable HTML package + Linux C++
runtime; Q2 relay server; Q3 WebGL interface + design patterns; Q4 TypeScript +
events/API, LLM-NPCs future (interface first, proxy via C++ server); Q5 editor+game
web-operable, C++ Linux only; Q6 MVP scope confirmed. Round 2 opened (RQ1–RQ5).

**Details**

- All of Q1–Q6 flipped from `pending` to `decided` in
  [02-open-questions.md](./02-open-questions.md), each with a resolution note.
- Q1 carries a `decided (reinterpreted)` status: the "only HTML" premise now means a
  portable RPG-Maker-style HTML package (`index.html` + `data/` + `js/` + `img/` +
  `audio/`), with the Linux C++ runtime retained for local serving, local file
  access, and multiplayer. **User confirmation still pending (RQ1).**
- New Round 2 questions opened: RQ1 portable target & saves, RQ2 renderer fallback,
  RQ3 C++ server stack, RQ4 MVP multiplayer model, RQ5 commit attribution.
- [01-vision.md](./01-vision.md) updated: single-player section now RESOLVED (with
  background on browser local-resource limits) + "Round 1 resolutions" summary table.

## 2026-08-25 — Kickoff

Kickoff: WAL docs scaffolded; discussion round 1 opened (Q1–Q6, see
[02-open-questions.md](./02-open-questions.md)); leader challenged the "C++ required
for single player" premise and the authoritative-server question.

**Details**

- Initialized the documentation tree: docs index, draft vision, open-questions log,
  WAL process playbook, ADR directory + template, and this project log.
- All six kickoff questions (Q1–Q6) are `pending`; the leader is driving round 1.
- Two premises explicitly under discussion and **not** treated as settled:
  1. "C++ runtime is required for single-player" (browser local-resource access —
     File System Access API is Chromium-only; OPFS is universal but origin-sandboxed).
  2. The multiplayer server role (relay vs. authoritative) — Q2.
- Branch: `docs/wal-init` (docs scaffold only; merge to `main` deferred to the
  merge-manager).
