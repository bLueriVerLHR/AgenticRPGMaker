# AGENTS.md — Agent Onboarding

This file is the entry point for any agent (or human) starting work in this
repository. It follows ADR-007 (agentic operability): agents must be able to
onboard, read the docs, and run the toolchain without asking a human. Read
`docs/README.md` and `docs/03-wal-process.md` before writing any code.

## Repository layout

| Path                | Purpose                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`     | Shared engine core: data model, event interpreter (later), versioned JSON schemas (ADR-001 / ADR-003). Vanilla TypeScript, **zero DOM/browser dependencies**, runs in Node. |
| `packages/renderer` | Renderer interface + (P1b) WebGL / Canvas2D backends (ADR-002). Vanilla TypeScript.                                                                                         |
| `packages/runtime`  | Playable game: boot sequence, game loop, scenes, saves, multiplayer client (ADR-001 / ADR-004). Vanilla TypeScript.                                                         |
| `packages/editor`   | Web editor (Game Maker): React + TypeScript + Vite (ADR-006).                                                                                                               |
| `server/`           | C++20 relay/state-sync server: CMake, standalone Asio, websocketpp, spdlog, Catch2 (ADR-005 / RQ3).                                                                         |
| `samples/`          | Sample maps / projects exercising the editor → core → runtime → server pipeline.                                                                                            |
| `docs/`             | Single source of truth: vision, decision log, WAL process, architecture, MVP plan, compatibility checklist, ADRs.                                                           |
| `scripts/`          | Repo tooling (e.g. `doc-lint.mjs`).                                                                                                                                         |

## How to read the docs

- `docs/README.md` — index of the whole docs tree; start here.
- `docs/02-open-questions.md` — the decision log (status legend: `pending`,
  `pending sign-off`, `decided`, `superseded`; entries are D/Q/RQ-numbered).
- `docs/04-adr/` — Architecture Decision Records; template:
  `docs/04-adr/ADR-000-template.md`. Statuses: `proposed` → `accepted` →
  `superseded`.
- `docs/06-architecture.md` — what we build (monorepo layout §2, patterns §7,
  logging §8, testing §9).
- `docs/07-mvp-plan.md` — in what order we build it (P0 → P6; the WAL/testing
  gate in §1 applies to every phase).
- `docs/03-wal-process.md` — the WAL / logging / testing / branch / QA
  playbook. Mandatory reading.

## The WAL rule (docs before code)

1. **No feature starts before its design doc + ADR exist and are reviewed**
   (`docs/03-wal-process.md` §1).
2. **The docs are corrected/finalized in the same change as the code** — a task
   is not done until `docs/` matches what was actually built.
3. Docs are reviewed like code and follow the same branch/merge rules.
4. Never modify `docs/` outside your own change's scope (docs are owned by the
   docs/design workstream; a member that builds code does not silently rewrite
   docs that other members own — coordinate through the leader).

## One-command scripts

Prerequisite: Node.js ≥ 20 and pnpm. If `pnpm` is missing, enable it with
`corepack enable` (comes with Node).

| Command          | What it does                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm install`   | Install all workspace dependencies (pnpm workspaces).                              |
| `pnpm build`     | Build all TypeScript packages (`core`, `renderer`, `runtime`, `editor`).           |
| `pnpm test`      | Run the Vitest unit suites across the web packages.                                |
| `pnpm lint`      | ESLint over the repo (packages + scripts + configs).                               |
| `pnpm format`    | Prettier over the repo (`docs/` excluded — docs are owned by the docs workstream). |
| `pnpm doc:lint`  | Check every doc for broken internal links and invalid status fields (ADR-007).     |
| `pnpm typecheck` | Type-check every package without emitting.                                         |

C++ server (run from `server/`):

```sh
cmake -B build          # configure (fetches pinned deps: asio, websocketpp, spdlog, Catch2)
cmake --build build     # build agenticrpg-server + agenticrpg-server-tests
ctest --test-dir build --output-on-failure   # run the Catch2 unit tests
./build/agenticrpg-server --help
```

## Where decisions live

- Product/engineering decisions with status + context + resolution:
  `docs/02-open-questions.md` (Q/RQ/D-numbered).
- Architecture decisions: one file per decision in `docs/04-adr/ADR-00X.md`,
  written from the template.
- Doc/ADR status values are machine-checkable and must be one of:
  `proposed`, `accepted`, `superseded`, `decided`, `pending`, `DRAFT`,
  `DECIDED` (case-insensitive) — enforced by `pnpm doc:lint`.

## Engineering rules (all mandatory)

- **All-English engineering** (ADR-007): docs, code, comments, commit messages,
  and UI strings are English. Game **content** text (dialogue, item names) is
  player data and is not language-restricted.
- **Logging** (`docs/03-wal-process.md` §2): spdlog on the C++ side, structured
  JSON logging on the web side. Levels `trace`/`debug`/`info`/`warn`/`error`;
  level is runtime-configurable, never hard-coded. **Never log secrets.**
- **Tests are mandatory** before any merge to `main` or any real-environment
  run (§3).
- **QA checklist** (§5) must pass before handing a branch to the merge-manager:
  build passes / unit green / E2E run / logs checked / docs updated in the same
  change.

## Commit identity

Subagent commits use the repo-local bot identity (RQ5). In this checkout it is
`AgenticRPGMaker Docs Scribe <docs@agenticrpgmaker.local>` (or
`AgenticRPGMaker Bot <bot@agenticrpgmaker.local>` on fresh clones where the
identity is set by tooling). Do not commit as a personal identity.

## Branch / merge rules

- Members work on **feature branches** (`feat/...`, `docs/...`) pushed to the
  shared remote (`origin` = `https://github.com/bLueriVerLHR/AgenticRPGMaker`).
- **Only the merge-manager merges to `main`** (`docs/03-wal-process.md` §4).
  Never commit directly to `main`.
- Work in git **worktrees** (`work/<member>/`) so members do not collide.
- A task is complete when its DoD is met, the QA checklist is ticked, and the
  branch is pushed for the merge-manager.
