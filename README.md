# AgenticRPGMaker

An agentic HTML5 RPG engine: a portable HTML5 game runtime, a Web-based editor ("Game Maker"), and a Linux C++ relay/hosting server.

AgenticRPGMaker is designed to be built *by agents, for agents*: the project follows a Write-Ahead-Log (WAL) workflow in which every feature is designed, documented, and agreed in the docs tree **before** any implementation begins, then the docs are corrected again after the work lands. The runtime targets portable HTML5 (including weak-device and JoiPlay constraints), with a Web editor for content authoring and a C++ relay/state-sync server for multiplayer and hosting.

## Documentation

See [docs/README.md](docs/README.md) — the single source of truth for the project: vision, open questions, WAL process, architecture, MVP plan, compatibility checklist, and Architecture Decision Records (ADRs).

## Status

**Phase A (design) complete & approved.** MVP implementation is next.

## Build & run

Prerequisites: Node.js ≥ 20 and pnpm (if `pnpm` is missing, run `corepack enable`); for the C++ server, CMake ≥ 3.20 and a C++20 compiler.

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies (pnpm workspaces). |
| `pnpm build` | Build all TypeScript packages (`core`, `renderer`, `runtime`, `editor`). |
| `pnpm test` | Run the Vitest unit suites (web packages). |
| `pnpm lint` | ESLint over the repo. |
| `pnpm format` | Prettier over the repo (`docs/` excluded). |
| `pnpm doc:lint` | Docs link/status lint (ADR-007). |

C++ server (`server/`): `cmake -B build && cmake --build build && ctest --test-dir build --output-on-failure`, then `./build/agenticrpg-server --help`.

See [AGENTS.md](AGENTS.md) for the full agent-onboarding guide.

---

*Docs come before code. No feature starts before its design doc and ADR exist.*
