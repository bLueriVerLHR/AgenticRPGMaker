# AgenticRPGMaker — Project Log

Append-only running log of the project. Newest entry goes at the **top** of the list.
Date format: `YYYY-MM-DD`.

---

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
