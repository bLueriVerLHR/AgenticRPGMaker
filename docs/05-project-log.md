# AgenticRPGMaker — Project Log

Append-only running log of the project. Newest entry goes at the **top** of the list.
Date format: `YYYY-MM-DD`.

---

## 2026-08-25 — Consensus confirmed (D1–D16); Phase A kicked off

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
