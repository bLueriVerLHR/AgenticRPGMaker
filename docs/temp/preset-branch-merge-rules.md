# Preset branch/merge rules — recorded, not adopted by this project

- **Date:** 2026-08-31
- **Provenance:** The rules below did **not** come from a decision by this
  project. They are **preset-specific conventions** that arrived in the
  repository scaffold (`AGENTS.md` / `docs/03-wal-process.md` as originally
  created) from the agentic-team preset used to initialise the repo (a model
  where parallel AI "members" work in git worktrees and a designated
  "merge-manager" merges to `main`).

## The preset rules (kept here for provenance, NOT project rules)

- Members work on feature branches pushed to the shared remote.
- **Only the merge-manager merges to `main`; nobody else merges; never commit
  directly to `main`.**
- Work in git worktrees (`work/<member>/`) so members do not collide.
- A task is complete only when its branch is pushed for the merge-manager.

## Why this project does NOT adopt them

- This project is **owner-driven**: one owner works with agents on this
  repository; there is no multi-member AI team and no separate merge-manager
  role.
- The owner (or an agent the owner directs) **commits and merges directly to
  `main`**. There is no merge-manager gate.
- The real workflow is the **module-scoped short-lived branch + validate-first**
  loop (D24/D25), which stays — but branches are optional, not a merge-gate.

## Effective rules (what the docs now say)

See `AGENTS.md` → "Branch / merge rules" and `docs/03-wal-process.md` §4:

- `main` is the long-lived stable branch; keep it green.
- Work in short-lived branches (`feat/...`, `docs/...`) **or directly on `main`**;
  run `pnpm validate` + `pnpm -r test` + `pnpm lint` before landing.
- The owner merges; agents do not block on a merge-manager.
- Remote branches are never deleted without explicit user authorization (C3).
