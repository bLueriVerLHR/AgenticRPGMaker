# Task 04 — Branch re-org + new dev workflow (docs)

| Field | Value |
|---|---|
| **Goal** | Development branches are re-organized locally (archive via tags; **no remote deletion** — C3) and the new dev workflow (module-scoped short-lived branches + validate-first) is documented (D25/C4). |
| **Why** | Q8: "merge what can be merged, delete the rest — a new development approach is needed." C3: do not push-delete remote branches. The workflow change belongs in `docs/03-wal-process.md` §4. |
| **Approach** | 1. Create local tags archiving the already-merged branch heads (`archive/design-a`, `archive/design-b`, `archive/design-c`, `archive/docs-wal-init`, and `archive/feat-p0…p6` as appropriate) pointing at the current merged commits. 2. Leave remote branches untouched (C3). 3. Rewrite `docs/03-wal-process.md` §4 (branch strategy): `main` long-lived; `feat/<module>/<change>` short-lived per module; merge-then-delete locally; validate-first gate before merge (`pnpm validate` + `pnpm -r test`). 4. Note the archived editor tag in AGENTS.md / docs so future agents know how to restore it. 5. Append a project-log entry in `docs/05-project-log.md`. |
| **Files touched** | git tags, `docs/03-wal-process.md`, `docs/05-project-log.md`, `AGENTS.md` (archive note) |
| **Acceptance criteria** | Local archive tags exist for the historical branches; remote branch list unchanged; `docs/03-wal-process.md` §4 documents the new workflow; `pnpm doc:lint` green. |
| **Status** | todo |
