# AgenticRPGMaker — Project Log

Append-only running log of the project. Newest entry goes at the **top** of the list.
Date format: `YYYY-MM-DD`.

---

## 2026-08-26 — Open-world demo S6 playtest feedback pass (feat/open-world-demo)

The leader playtested the served demo and filed eight issues; all eight were
fixed on the branch and the docs synced in the same change
([09-open-world-rpg.md](./09-open-world-rpg.md) §13, playtest pass).

**Details**

- Fixes: visible walls + real ground-atlas art (the demo atlas PNG was 404 —
  the generator now paints and emits it via a pure-Node PNG encoder), faster
  movement (0.15 s → 0.09 s steps), redesigned opening/ending CG stills, hero
  facing chevron, sword-slash flash, turret charge telegraph + hit flashes,
  story-switch-driven objective line, and composed rect mini-sprites for the
  hero/villagers/slimes/turret/chest/signpost/beacon (`world-sprites.ts`,
  unit-tested — no more abstract squares).
- World golden-path E2E stays **14/14** after the pass; runtime unit suite
  green (147 tests incl. the new sprite suite).
- In parallel, map-mode playtest fixes landed on `feat/p6-playtest-fixes`:
  renderer tile indices are 1-based (tiles sampled one atlas cell off), F5/F9
  save keys replace S/L, boot tears down a failed network client, tilesets
  register once per scene, and editor imports accept folder picks wrapped in a
  root directory.

## 2026-08-26 — Open-world demo implemented: S1–S5 shipped, golden-path E2E green

The seamless open-world RPG demo is built and verified on
`feat/open-world-demo` (worktree `work/archie`): engine (core/renderer/runtime),
content, and automated golden-path E2E all land together per the WAL rule.

**Details**

- **S1 core** — world/save-v2 schemas, global↔chunk coordinate math, 7 CG
  presentation commands. **S2 renderer** — registered textures (cover/fit)
  both backends. **S3** — WebAudio manager, title + CgScene, chunk streaming
  (worker parse, prefetch/evict), WorldScene with seamless cross-boundary
  movement, save-v2, `boot({ worldUrl })`.
- **S4 combat** — Zelda-minimal: Z = talk-or-sword, contact damage, i-frames,
  chase slimes + turret sentinel, aggro leash, death → respawn at spawn,
  defeated ids persist in save chunkState.
- **S5 content** — `scripts/gen-open-world.mjs` generates "The Crossroads"
  (3×3×64 world, 9 map-v1 chunks, CG SVGs, story events); `world-demo` harness
  serves it. Golden-path E2E (`test:world`) runs 14/14 steps: title → opening
  CG → chest/elder → seamless village→wilds crossing → two slimes → guard
  branch → sentinel → ending CG → F5/reload persistence.
- Workspace unit suite 416/416 green; E2E suites (editor, runtime, world) run;
  QA gate pass 1 green (pass 2 + stability re-runs in S6).
- Docs corrected in the same change: design doc §13 implementation notes, ADR
  notes, this entry.

## 2026-08-26 — Open-world demo kickoff: design proposal + ADRs 008–010 (docs before code)

Leader opened a new feature: research what a **seamless open-world RPG** needs and
ship a demo (CG playback, dialogue, events, real-time combat, exploration,
interaction). Three discussion rounds reached consensus on 18 decisions; the
proposal and ADRs are written first per the WAL rule (no code yet).

**Details**

- New design doc [09-open-world-rpg.md](./09-open-world-rpg.md) (proposed):
  3×3 × 64×64 chunked world, streaming chunk pool, grid-step Zelda-minimal action
  combat, static-CG presentation + minimal WebAudio, save v2, 15-minute vertical
  slice "The Crossroads".
- New ADRs (proposed): [ADR-008](./04-adr/ADR-008.md) world streaming + save v2,
  [ADR-009](./04-adr/ADR-009.md) on-map combat, [ADR-010](./04-adr/ADR-010.md) CG
  + audio.
- Key leader decisions: on-map real-time action combat (not turn-based); keep
  grid-step movement; world manifest + map-v1 chunks (editor untouched); content
  agent-authored; follow the full WAL/QA gate on a feature branch.
- Follow-up for the docs workstream: log the decisions in
  [02-open-questions.md](./02-open-questions.md) once the leader ratifies the
  proposal.
- Work happens in the worktree `work/archie` on branch `feat/open-world-demo`
  (tracking `origin/main`); leader review gates implementation.

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
