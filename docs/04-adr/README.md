# AgenticRPGMaker — Architecture Decision Records (ADR)

An **Architecture Decision Record** captures a single significant decision: what was
decided, why, and what it costs us. Per the WAL process
([docs/03-wal-process.md](../03-wal-process.md)), a feature does **not** start before
its ADR exists; and when the work completes, the ADR is corrected/finalized in the
same change.

## Rules

1. **One decision per ADR.** If a record covers two decisions, split it.
2. **Use the template** — [`ADR-000-template.md`](./ADR-000-template.md) — for every new ADR.
3. **Numbering:** real ADRs start at `ADR-001` and increment (`ADR-002`, `ADR-003`, …).
   `ADR-000` is reserved for the template itself.
4. **Status lifecycle:** `proposed` → `accepted` → (later) `superseded`. A superseded
   ADR is kept for history and points at what replaced it.
5. ADRs are reviewed like code and merged through the same branch strategy
   (feature branch → merge-manager → `main`).

## ADR index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-000](./ADR-000-template.md) | Template (this file is the template, not a real decision) | — | kickoff |
| ADR-001 | *first real decision — e.g. the answer to Q1* | proposed | — |

> As decisions land from the kickoff discussion (see
> [docs/02-open-questions.md](../02-open-questions.md)), each becomes an ADR in this
> directory and the Q status flips from `pending` to `decided`.
