# AgenticRPGMaker — Vision

> **status: consensus confirmed (2026-08-25); re-oriented (2026-08-31)**
> This document records the user's stated vision as of kickoff and its evolution
> through the discussion rounds. **The user signed off on all decisions D1–D16 at
> the consensus gate**, chose **Phase A — detailed design docs before code**, and
> **approved the Phase A design docs** (2026-08-25) plus new Round 3 decisions
> **D17–D19** (agentic operability & all-English — see
> [02-open-questions.md](./02-open-questions.md)). On **2026-08-31 the vision was
> re-oriented** (Round 4, **D20–D25**): the editor is removed/archived, authoring is
> **data-first (AI/agent-authored JSON)**, and the engine is **portable-first**
> (browser + JoiPlay today) with reserved WebGPU/WASM seams — see
> [02-open-questions.md](./02-open-questions.md) Round 4,
> [discussion/2026-08-31-reorg.md](./discussion/2026-08-31-reorg.md) and
> [ADR-008](./04-adr/ADR-008.md).

## 1. What it is

An **HTML5 RPG game engine** called **AgenticRPGMaker**, built with **AI-agentic
development support**. The tooling and the development workflow are themselves
agent-assisted: the engine is authored by an AI team following the WAL process,
and the product is meant to make building RPGs agent-friendly.

## 2. The game is HTML

The game itself is **HTML, playable in a browser** (no native app required to
play a finished game).

### 2.1 Single-player simplicity

Single-player should be **as simple as RPG Maker MZ/MV**: "you can just run the
HTML game" — double-click and play, no server install, no console, no deployment.

### 2.2 Multiplayer

For **multiplayer**, a **C++ server** is launched to **exchange data between
players** (position/state sync). **Decided (Round 1, Q2):** the server is a
**relay / state-sync server** — thin pipe + state storage; game logic runs
client-side; versioned protocol (see [02-open-questions.md](./02-open-questions.md)).
**MVP sync scope (Decided, D16): sync players only** — position / direction /
animation, join/leave, chat; world-state sync (doors/switches/NPCs) is a documented
MVP limitation.

## 3. Single-player distribution — RESOLVED (Round 1)

> ✅ **Resolved in Round 1 (Q1), confirmed by the user in Round 2 (RQ1).** The
> "only HTML" premise was **reinterpreted** — see below and
> [02-open-questions.md](./02-open-questions.md).

"Only HTML" does **not** mean a bare `.html` file opened via `file://`. It means the
game is a **PORTABLE HTML package** — an RPG-Maker-style deployable folder:

```
index.html
data/
js/
img/
audio/
```

This package runs on **any static host**, **any modern browser**, and
**JoiPlay-type mobile HTML runtimes** — "double-click and play" in the sense that a
finished game is just a folder you serve or open anywhere.

The **C++ runtime remains necessary** (Linux target per Q5) for:

1. **Local serving** — serving the HTML package from a local process;
2. **Local file access** — the browser cannot freely read/write the user's local
   files (see background below);
3. **Multiplayer** — hosting the relay / state-sync server (Q2).

### 3.1 Background: why the premise was challenged

The user originally asserted a C++ runtime is a **must** for single-player because
browsers restrict local-resource access. The discussion reviewed what browsers
actually can and cannot do:

| Capability | What it is | Availability |
|------------|-----------|--------------|
| **File System Access API** (`showOpenFilePicker`, `showSaveFilePicker`, `FileSystemFileHandle`) | Real read/write of local files with user consent. | **Chromium-only** for real local files (Chrome/Edge/Opera). Not in Firefox or Safari. |
| **OPFS — Origin Private File System** (`navigator.storage.getDirectory()`) | Sandboxed file-like storage. | **Universal** (all modern browsers), but **sandboxed to the origin** — data is invisible to the user's normal file system and tied to the site's origin. |
| `file://` protocol | Opening an HTML file directly. | Works, but many APIs (fetch of local files, storage, workers) are restricted or inconsistent. |
| Local web server (`localhost`) | Serves the game from a real server on the loopback interface. | Universal; this is what RPG Maker MZ/MV-style tools effectively rely on. |

Net: a pure-HTML no-C++ single-player is *partly* plausible via
File System Access API / OPFS, but those are limited (Chromium-only for real local
files; OPFS is origin-sandboxed) — so the C++ runtime stays for local serving,
local file access, and multiplayer, while the game itself remains a portable,
browser-runnable HTML package.

### 3.2 Round 1 resolutions (Q1–Q6)

Short reference — full detail in
[02-open-questions.md](./02-open-questions.md#round-1--decided-q1q6):

| # | Question | Resolution |
|---|----------|------------|
| Q1 | single-player distribution | portable HTML package + Linux C++ runtime *(user-confirmed, RQ1)* |
| Q2 | multiplayer server role | relay / state-sync server, versioned protocol |
| Q3 | rendering | WebGL renderer interface + design patterns *(Canvas2D fallback decided, RQ2)* |
| Q4 | scripting | TypeScript + events/API; LLM-NPC interface first, proxy via C++ server, out of MVP |
| Q5 | target platforms | editor + game = browser web apps; C++ Linux only; no native path |
| Q6 | MVP scope | map editor + SP runtime + 2-player relay + C++ Linux launcher/server |

## 4. Game Maker (level / scene editor)

The **Game Maker** (level/scene editor) is a **web application launched by C++**,
which **serves the HTML pages** for the editor. So the C++ component doubles as
both a launcher/server and (potentially) the multiplayer host.

## 5. Engineering rules (hard requirements from the user)

These are non-negotiable process requirements, regardless of the open questions:

1. **Keep documentation continuously.** Docs are a first-class artifact, maintained
   alongside the work — never written once and abandoned.
2. **WAL-style.** Docs are written **before** true code writing begins, and the docs
   are **fixed after the real task finishes** (see [03-wal-process.md](./03-wal-process.md)).
3. **Logs are mandatory for debugging.** Every component logs sufficiently well that
   a debugging session does not start from zero.
4. **Tests are mandatory** — before any release, and before any **real-environment
   run**.
5. **All-English engineering.** All engineering artifacts (docs, code, comments,
   commit messages, UI strings) are in English; **game content text** (dialogue,
   item names) is player data and not language-restricted. (Decided: D17.)
6. **Agent-readable docs + agent-operable system.** `AGENTS.md` at repo root as the
   agent onboarding doc; doc link/status lint in CI; agent-operable baseline
   (one-command build/test/lint, doc conventions) **in MVP**; upper-tier seams
   (editor headless CLI, runtime headless mode, server control API) designed now,
   implemented later. (Decided: D18/D19.)

## 6. Out of scope for now

**Confirmed MVP non-goals (Round 1, Q6 + Round 2, D16):** matchmaking, animation
editor, cloud saves, **LLM NPCs**, and **world-state sync** (doors/switches/NPCs) —
multiplayer sync covers **players only** in the MVP (see
[02-open-questions.md](./02-open-questions.md#q6--mvp-scope)). All proposed defaults
**D12–D16** were **signed off by the user at the consensus gate** (editor storage,
editor UI, data formats, repo structure, MVP sync scope). Round 3 decisions
**D17–D19** (all-English, agent-operable scope, docs form) are **in force** and their
upper-tier seams are explicitly **NOT in MVP** (see
[ADR-007](./04-adr/ADR-007.md)).

---

*Status history: created as DRAFT at kickoff (2026-08-25); updated after Round 1 —
Q1–Q6 resolved (Q1 reinterpreted); updated after Round 2 — RQ1–RQ5 resolved
(portable target user-confirmed), D12–D16 proposed; **consensus confirmed
2026-08-25** — user signed off on D1–D16; **Phase A design docs approved
2026-08-25** — D17–D19 decided (all-English, agent-operable scope, docs form),
ADR-007 accepted, zod confirmed for D14.*
