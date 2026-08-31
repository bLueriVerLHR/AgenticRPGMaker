# AgenticRPGMaker

An agentic HTML5 RPG engine: a portable-first HTML5 game runtime (browser +
JoiPlay), with an optional Linux C++ relay/hosting server. Content is authored
**as data** (versioned JSON written by AI/agents or humans) — the visual editor
is archived until a real game justifies it (D20).

AgenticRPGMaker is designed to be built _by agents, for agents_: the project follows a Write-Ahead-Log (WAL) workflow in which every feature is designed, documented, and agreed in the docs tree **before** any implementation begins, then the docs are corrected again after the work lands. The runtime targets portable HTML5 (including weak-device and JoiPlay constraints), with a C++ relay/state-sync server for multiplayer and hosting (optional, D22).

## Documentation

See [docs/README.md](docs/README.md) — the single source of truth for the project: vision, open questions, WAL process, architecture, MVP plan, compatibility checklist, and Architecture Decision Records (ADRs). Discussion records, principles, and task docs live under `docs/discussion/`, `docs/principle/`, `docs/task/`.

## Status

**MVP implemented (P0–P5) and re-oriented 2026-08-31:** the editor was removed
from `main` and archived via git tag `archive/editor-0.1.0` (D20); the engine is
**portable-first** (browser + JoiPlay today) with **data-first authoring**
(AI/agent-written JSON → `pnpm validate` → runtime, D24) and reserved
WebGPU/WASM seams (D23).

## Build & run

Prerequisites: Node.js ≥ 20 and pnpm (if `pnpm` is missing, run `corepack enable`); for the C++ server, CMake ≥ 3.20 and a C++20 compiler.

| Command         | What it does                                                               |
| --------------- | -------------------------------------------------------------------------- |
| `pnpm install`  | Install workspace dependencies (pnpm workspaces).                          |
| `pnpm build`    | Build all TypeScript packages (`core`, `renderer`, `runtime`).             |
| `pnpm test`     | Run the Vitest unit suites (web packages).                                 |
| `pnpm validate` | Validate game-data JSON against the `core` schemas (D24, agent data gate). |
| `pnpm lint`     | ESLint over the repo.                                                      |
| `pnpm format`   | Prettier over the repo (`docs/` excluded).                                 |
| `pnpm doc:lint` | Docs link/status lint (ADR-007).                                           |

C++ server (`server/`, optional): `cmake -B build && cmake --build build && ctest --test-dir build --output-on-failure`, then `./build/agenticrpg-server --help`.

See [AGENTS.md](AGENTS.md) for the full agent-onboarding guide.

---

_Docs come before code. No feature starts before its design doc and ADR exist._
