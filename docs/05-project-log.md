# AgenticRPGMaker — Project Log

Append-only running log of the project. Newest entry goes at the **top** of the list.
Date format: `YYYY-MM-DD`.

---

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
