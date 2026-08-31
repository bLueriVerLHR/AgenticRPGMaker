# Task 01 — Record the re-org decisions (open-questions + ADR-008)

| Field | Value |
|---|---|
| **Goal** | The re-orientation decisions D20–D25 are recorded in `docs/02-open-questions.md` and the architecture-significant multi-backend/editor-less direction is captured in a new ADR-008. |
| **Why** | WAL + decision-log rules: no change ships without its decision recorded (`docs/03-wal-process.md` §1); `docs/discussion/2026-08-31-reorg.md` is the source. |
| **Approach** | 1. Append a "Round 4 — D20–D25" section to `docs/02-open-questions.md` (status `decided`, verbatim from the discussion). 2. Update the decision-log history table. 3. Create `docs/04-adr/ADR-008.md` (portable-first multi-backend + editor-less authoring + reserved WebGPU/WASM seams) from the template, status `proposed`. 4. Mark ADR-006 as `superseded` (superseded by D20 — editor removed/archived). 5. Update `docs/04-adr/README.md` index and `docs/README.md` ADR index. |
| **Files touched** | `docs/02-open-questions.md`, `docs/04-adr/ADR-008.md` (new), `docs/04-adr/ADR-006.md`, `docs/04-adr/README.md`, `docs/README.md` |
| **Acceptance criteria** | New D20–D25 entries with `decided` status; ADR-008 exists and lints; ADR-006 status `superseded` pointing at D20/ADR-008; `pnpm doc:lint` green. |
| **Status** | todo |
