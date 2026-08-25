# AgenticRPGMaker — Documentation

This is the single source of truth for the AgenticRPGMaker project.
Docs come **before** code (WAL — Write-Ahead-Log / Write-Ahead-of-Log style): every feature
must be designed and agreed here before implementation starts, and the docs are corrected
again after the work actually completes.

## How to use this tree

| Path | Purpose | When to touch it |
|------|---------|------------------|
| [`01-vision.md`](./01-vision.md) | The product vision as stated at kickoff (DRAFT — pending consensus). | Read before any design work; update only after the leader reaches consensus. |
| [`02-open-questions.md`](./02-open-questions.md) | Numbered decision log (Q1–Q6) with status, options, and the leader's recommendation. | Update status from `pending` → `decided` / `superseded` as the leader decides. |
| [`03-wal-process.md`](./03-wal-process.md) | Engineering playbook: WAL, logging, testing, branch strategy, QA checklist. | Follow it on every change; extend it when a new rule is agreed. |
| [`04-adr/`](./04-adr/) | Architecture Decision Records — one file per significant decision. | Create a new ADR for each decision; use `ADR-000-template.md`. |
| [`05-project-log.md`](./05-project-log.md) | Append-only running log of meetings, kickoffs, and key milestones. | Append an entry whenever something notable happens. |
| [`06-architecture.md`](./06-architecture.md) | System architecture: components, boundaries, and data flow. | Read before starting any component work; update as the architecture evolves. |
| [`07-mvp-plan.md`](./07-mvp-plan.md) | MVP implementation plan: phases, milestones, task breakdown. | Consult when planning/scheduling implementation work; update as the plan changes. |
| [`08-compatibility-checklist.md`](./08-compatibility-checklist.md) | Portable/runtime compatibility: banned APIs, weak-device/JoiPlay constraints, user verification checklist. | Run before every release; update as the target matrix changes. |

### ADR index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](./04-adr/ADR-001.md) | Shared Engine Core: Component-Based Entities, Scene Graph, Event Bus (packages/core) | proposed | 2026-08-25 |
| [ADR-002](./04-adr/ADR-002.md) | Renderer Interface: WebGL Default with Automatic Canvas2D Fallback | proposed | 2026-08-25 |
| [ADR-003](./04-adr/ADR-003.md) | Versioned JSON Data Formats (Shared TS Types + Validation in packages/core) | proposed | 2026-08-25 |
| [ADR-004](./04-adr/ADR-004.md) | Multiplayer protocol v1 (WebSocket + JSON) | proposed | 2026-08-25 |
| [ADR-005](./04-adr/ADR-005.md) | C++ relay / state-sync server (C++20 + Asio + websocketpp) | proposed | 2026-08-25 |
| [ADR-006](./04-adr/ADR-006.md) | Web editor (React + TypeScript + Vite) | proposed | 2026-08-25 |

## The WAL process in this project

WAL (Write-Ahead-Log) means documentation is treated as a first-class artifact
that is written *ahead* of the code, and then corrected *after* the code lands:

1. **Docs first, code second.** No feature starts before its design doc + ADR
   (Architecture Decision Record) exists in this tree and has been reviewed.
2. **Write the doc now.** Capture the intent, the constraints, the open questions,
   and the chosen approach *before* touching any game or engine code.
3. **Code against the doc.** Implementation should be traceable back to a doc.
4. **Fix the doc after.** When the task completes, the docs are corrected and
   finalized *in the same change* as the code — the docs must never drift from reality.

Consequences of this rule:

- A "done" task is not done until its documentation matches what was actually built.
- Nobody should be able to claim "I didn't know that was the plan" — it is written down.
- Docs are living artifacts, not one-time output; they are reviewed like code.

## Status legend

- **DRAFT** — written down, not yet agreed; treat as proposal.
- **PENDING** — open question, awaiting a decision.
- **DECIDED / ACCEPTED** — agreed by the leader; implementable.
- **SUPERSEDED** — replaced by a later decision; keep for history, mark clearly.
