# AgenticRPGMaker — Open Questions (Decision Log)

Numbered decision log. Each entry has a **status**, the **question**, the **options**,
and the **leader's recommendation**. Resolved items keep their original options for
history and add a **resolution** note recording what was actually decided.

## Status legend

- `pending` — open, awaiting a decision (the leader drives it).
- `pending sign-off` — leader-approved default, awaiting the user's sign-off.
- `decided` — closed; the resolution is recorded.
- `superseded` — a later decision replaced this one (keep the history).

---

# Round 1 — decided (Q1–Q6)

## Q1 — single-player distribution

- **status:** decided (reinterpreted)
- **question:** How does a single player launch the game?
- **options:**
  - **(a)** C++ launcher starts a tiny local HTTP/WS server and opens the system browser — *[leader's recommendation]*
  - **(b)** embedded webview (WebView2/CEF) window — more native feel, but heavy platform-specific deps
  - **(c)** both modes behind a flag
  - **(d)** pure-HTML single-player with no C++ (only viable if browser File System Access API / OPFS suffice) — *contradicts the user's stated premise and is being challenged*
- **resolution:** "only HTML" was **reinterpreted**: the game is a **PORTABLE HTML
  package** (RPG-Maker-style deployable folder: `index.html` + `data/` + `js/` +
  `img/` + `audio/`) that runs on **any static host**, **any modern browser**, and
  **JoiPlay-type mobile HTML runtimes**. The **C++ runtime remains necessary**
  (Linux target per Q5) for **local serving, local file access, and multiplayer**.
  - ✅ **Confirmed by the user in Round 2 — see RQ1.**

## Q2 — multiplayer server role

- **status:** decided
- **question:** What role does the multiplayer server play?
- **options:**
  - **(a)** relay / state-sync server — server is a thin pipe that also stores state; game logic runs client-side; versioned protocol so an authoritative server can be added later — *[leader's recommendation for MVP]*
  - **(b)** authoritative server — C++ embeds a JS engine (QuickJS/V8) and runs the SAME game logic server-side (anti-cheat, consistent simulation; more work upfront)
  - **(c)** re-implement game logic natively in C++ — *[leader rejects: doubles the codebase]*
  - **(d)** hybrid — host-authoritative for small groups, relay for larger sessions
- **dependency note:** option **(b)** requires the scripting question (**Q4**) to be answered with *JS in-engine*.
- **resolution:** **relay / state-sync server** — thin pipe + state storage; game
  logic runs client-side; **versioned protocol** so an authoritative server can be
  added later. (Chosen: option **a**.)

## Q3 — rendering

- **status:** decided
- **question:** How do we render the game?
- **options:**
  - **(a)** thin renderer interface with a Canvas2D implementation for MVP, WebGL-ready abstraction later — *[leader's recommendation]*
  - **(b)** PixiJS (battle-tested WebGL/Canvas; what RPG Maker MZ uses) — faster to build, less from-scratch
  - **(c)** raw WebGL from day one
- **resolution:** **WebGL-based renderer interface**, with **upper layers built on
  the interface**; **heavy use of design patterns** to isolate risk.
  - ✅ **Fallback strategy decided in Round 2 — see RQ2.**

## Q4 — scripting

- **status:** decided
- **question:** How do game authors express game logic?
- **options:**
  - **(a)** visual event pages + JS script API (like RPG Maker MV/MZ: event commands callable from scripts) — *[leader's recommendation]*
  - **(b)** pure visual events, no scripting
  - **(c)** game code authored in TypeScript, compiled to JS bundles
- **resolution:** **game code in TypeScript** (compiled to JS) + **event system** +
  **script/API now**. FUTURE: **NPC behavior driven by LLMs** — design a **pluggable
  behavior/intelligence interface (Strategy pattern) NOW**, LLM backend later via
  **C++ server proxy** (key concerns: **security, CORS**). **LLM-NPC is explicitly
  OUT of MVP scope.**

## Q5 — target platforms

- **status:** decided
- **question:** Which platforms do we target?
- **options:**
  - **(a)** desktop Windows + macOS for editor and client; server builds for Linux + Windows — *[leader's recommendation]*
  - **(b)** Windows only for MVP
  - **(c)** Windows + macOS + Linux all three from the start
  - **(d)** server-first (Linux), client = any modern browser
- **resolution:** **editor AND game are both browser-operable web apps**; the **C++
  runtime targets Linux only** (the cross-platform core problem is deferred;
  currently Linux). **No native desktop/webview app path.**

## Q6 — MVP scope

- **status:** decided
- **question:** What exactly is in the MVP?
- **options:**
  - **(a)** map editor (tile layers + event placement) + runtime (walk / collide / dialogue) + 2-player LAN sync (players see each other move) + C++ launcher serving content; explicit non-goals: matchmaking, animation editor, cloud saves — *[leader's recommendation]*
  - **(b)** smaller: editor + single-player runtime only, multiplayer in phase 2
  - **(c)** bigger: also save/load, inventory, basic combat
- **resolution:** **map editor (tile layers + events)** + **single-player runtime
  (walk / collide / dialogue)** + **2-player relay sync** + **C++ Linux
  launcher/server serving content**. **Non-goals:** matchmaking, animation editor,
  cloud saves, **LLM NPCs**.

---

# Round 2 — decided (RQ1–RQ5)

## RQ1 — portable target & saves

- **status:** decided
- **question:** Confirm the reinterpretation: portable deploy = RPG-Maker-style
  `www` folder (`index.html` + `data/` + `js/` + `img/` + `audio/`) runnable on
  JoiPlay/any static host; saves use IndexedDB/localStorage (portable).
- **options:**
  - **(a)** confirmation of this design — *[leader's recommendation]*
  - **(b)** true single-file HTML with all assets inlined
  - **(c)** other
- **resolution:** **portable deploy = RPG-Maker-style `www` folder** (`index.html`
  + `data/` + `js/` + `img/` + `audio/`) runnable on **JoiPlay / any static host /
  any browser**; **saves use IndexedDB** (portable); **C++ (Linux) provides optional
  local-file saves**. (Chosen: option **a**; reinterpretation confirmed by the user.)

## RQ2 — renderer fallback

- **status:** decided
- **question:** Weak devices / JoiPlay WebViews may have poor or no WebGL.
- **options:**
  - **(a)** Renderer interface with WebGL default + capability detection + automatic Canvas2D fallback renderer, sharing the same upper layers — *[leader's recommendation]*
  - **(b)** WebGL only
  - **(c)** WebGL on desktop browsers, Canvas2D backend for mobile runtimes
- **resolution:** **Renderer interface** with **WebGL default + capability detection +
  automatic Canvas2D fallback renderer**; **same upper layers for both backends**.
  (Chosen: option **a**.)

## RQ3 — C++ server stack

- **status:** decided
- **question:** Which C++ server/library stack?
- **options:**
  - **(a)** C++20 + standalone Asio + websocketpp (header-only via FetchContent), custom HTTP static hosting, spdlog logging, Catch2 tests, CMake build — *[leader's recommendation]*
  - **(b)** Drogon (modern C++20 framework, HTTP+WS+ORM, heavier)
  - **(c)** Crow (lightweight, weaker WS)
  - **(d)** uWebSockets (fastest, higher API risk for the agent team)
- **resolution:** **C++20 + standalone Asio + websocketpp** (header-only via
  FetchContent) + **custom HTTP static hosting** + **spdlog** + **Catch2** +
  **CMake**. (Chosen: option **a**.)

## RQ4 — MVP multiplayer model

- **status:** decided
- **question:** How do players connect in the MVP?
- **options:**
  - **(a)** 2+ clients connect over WebSocket to ONE C++ server (on some Linux box or cloud VPS) that relays and broadcasts player position/state; no NAT punch-through / P2P in MVP — *[leader's recommendation]*
  - **(b)** LAN-only (server must run on a local Linux box)
  - **(c)** cloud-first deployment (VPS), local launcher only for dev
- **resolution:** **2+ clients connect over WebSocket to ONE C++ server** (on some
  Linux box or cloud VPS) that **relays and broadcasts** player position/state;
  **no NAT punch-through / P2P in MVP**. (Chosen: option **a**.)

## RQ5 — commit attribution

- **status:** decided
- **question:** What git identity do subagent commits use?
- **options:**
  - **(a)** all subagent commits use a single repo-local bot identity (e.g. "AgenticRPGMaker Bot") to avoid fabricating the user's name — *[leader's recommendation]*
  - **(b)** use the user's GitHub identity
  - **(c)** per-member identities
- **resolution:** **single unified repo-local bot identity for all subagent commits**
  (e.g. "AgenticRPGMaker Bot"), to avoid fabricating the user's name. (Chosen:
  option **a**.)

---

# D12–D16 — decided (user sign-off at consensus gate)

> New numbering introduced in the Round 2 summary: **D1–D11** correspond to the
> already-decided items **Q1–Q6 + RQ1–RQ5** above. **D12–D16** were proposed
> defaults; the **user signed off on all of them at the consensus gate**
> ("确认共识，先进 Phase A 设计文档").

## D12 — editor project storage

- **status:** decided
- **default:** browser **IndexedDB** for MVP (portable/offline), with **import/export
  to folder**; **C++ server file persistence deferred to phase 2**.
- **resolution:** **user confirmed at consensus gate** — IndexedDB project storage
  (import/export to folder); C++ server file persistence in phase 2.

## D13 — editor UI

- **status:** decided
- **default:** **React + TypeScript + Vite** (editor only); the **game runtime stays
  framework-free vanilla TS** for portability.
- **resolution:** **user confirmed at consensus gate** — React + TS + Vite editor;
  game runtime stays framework-free vanilla TS.

## D14 — data formats

- **status:** decided
- **default:** **JSON schema** (shared TS types) for **maps / events / saves /
  protocol**, **versioned**.
- **resolution:** **user confirmed at consensus gate** — versioned JSON schema with
  shared TS types for maps / events / saves / protocol.
- **validation library — zod CONFIRMED (user, Round 3):** the validation library is
  **zod** — a single documented runtime dependency of `packages/core` (or a thin
  adapter around it; final call at implementation). See
  [ADR-003](./04-adr/ADR-003.md), which flags this choice; the user's confirmation
  resolves the "choice to be confirmed by the leader at review" note in ADR-003.

## D15 — repo structure

- **status:** decided
- **default:** **monorepo**: `packages/core`, `packages/renderer`, `packages/runtime`,
  `packages/editor` + `server` (C++) + `samples`; **pnpm workspaces**; **Vitest +
  Playwright + Catch2**.
- **resolution:** **user confirmed at consensus gate** — monorepo
  `packages/core`, `packages/renderer`, `packages/runtime`, `packages/editor` +
  `server` (C++) + `samples`; pnpm workspaces; Vitest + Playwright + Catch2.

## D16 — MVP sync scope

- **status:** decided
- **default:** sync **ONLY player state** (position / direction / animation,
  join/leave, chat); **world-state sync (doors/switches/NPCs) is a documented MVP
  limitation** (future: host-authoritative world state or embedded-JS authoritative
  server).
- **resolution:** **user confirmed at consensus gate** — MVP sync = player-state
  only; world-state sync is a documented MVP limitation.

---

# Round 3 — decided (agentic operability & all-English)

> **Phase A design docs approved by the user** (2026-08-25); zod confirmed for D14
> (see note above and ADR-003). The following three decisions were made by the user
> in Round 3 (recorded in [ADR-007](./04-adr/ADR-007.md)).

## D17 — all-English

- **status:** decided
- **default:** all **engineering** artifacts (docs, code, comments, commit messages,
  UI strings) are in **English**; **game content text** (dialogue, item names) is
  player data and **not** language-restricted.
- **resolution:** **user decided** — all-English engineering rule for all repo
  artifacts; game content text unrestricted (player data).

## D18 — agent-operable scope

- **status:** decided
- **default:** **baseline tier in MVP** (`AGENTS.md` + doc conventions +
  one-command build/test/lint + doc lint in CI); **upper tiers** (editor headless
  CLI, runtime headless mode, server control API) **designed now, implemented
  later**, NOT in MVP — via reserved interfaces.
- **resolution:** **user decided** — baseline tier in MVP; upper tiers designed-now /
  implemented-later via reserved seams (see ADR-007 and the seams summary in
  06-architecture.md).

## D19 — docs form

- **status:** decided
- **default:** `AGENTS.md` + doc structure conventions + link/status lint in CI.
- **resolution:** **user decided** — `AGENTS.md` at repo root, doc structure
  conventions (stable headings, machine-checkable status fields), link/status lint
  enforced in CI.

---

# Round 4 — decided (D20–D25, repository re-orientation 2026-08-31)

> **Repository re-orientation.** The user asked to survey open-source projects
> (Tyrano, open-source RPG engines/games), re-organize the docs and development
> branches, and re-examine the repository design. Because development is
> primarily auto-generated code, the editor is removed until a real game exists.
> The engine should be RPG-Maker-like but more customizable, and abstracted to
> run on more backends (browser + JoiPlay today). The full verbatim discussion is
> in [docs/discussion/2026-08-31-reorg.md](./discussion/2026-08-31-reorg.md);
> reusable rules in [docs/principle/](./principle/). All entries below are
> `decided` (user answered directly).

## D20 — editor disposition

- **status:** decided
- **question:** How is the editor (packages/editor, ADR-006) handled?
- **options:**
  - **(a)** remove from `main`, archive via git tag, add back when a real game takes shape — *[user's choice]*
  - **(b)** keep an `archive/` copy in the tree
  - **(c)** keep in place, mark deprecated
- **resolution:** **remove `packages/editor` from `main`**; history archived via a
  git tag (`archive/editor-0.1.0`); restore = `git checkout <tag>` + move the
  package back onto the same `core` model. **No file copy kept in the tree.**

## D21 — multi-backend scope

- **status:** decided
- **question:** What does "support more backends" mean (Q4 clarification)?
- **options:**
  - **(a)** portable-first: one engine that runs on every target component/environment (browser + JoiPlay today, more later); performance (vgpu, wasm) researched after — *[user's choice]*
  - **(b)** model each runtime (JoiPlay etc.) as a separate backend
  - **(c)** no explicit backend modeling yet
- **resolution:** **portable-first engine** that runs, unmodified, on every
  target environment in scope (browser + JoiPlay today). JoiPlay runs our
  portable `www` package directly (it runs MV/MZ from their `www` HTML5 folder —
  verified from JoiPlay's own FAQ). Backends are **configurations of the same
  runtime**, selected by a thin platform-capability layer.

## D22 — C++ server

- **status:** decided
- **question:** How is the C++ relay/hosting server (ADR-005) positioned after the re-orientation?
- **options:**
  - **(a)** keep but demote to an optional component — single-player portable engine is the core — *[user's choice]*
  - **(b)** archive/remove alongside the editor
  - **(c)** keep as a first-class MVP target
- **resolution:** **keep but demote to an optional component.** The portable
  single-player engine is the core; the C++ relay server is a later/optional
  piece, never required by the portable engine.

## D23 — performance route

- **status:** decided
- **question:** When do we invest in higher-performance rendering/core (vgpu/WebGPU, wasm)?
- **options:**
  - **(a)** portable first (Canvas2D + WebGL running today); reserve WebGPU renderer backend + WASM core as future switching points (seams now, no investment now) — *[user's choice]*
  - **(b)** implement WebGPU/WASM now, performance first
  - **(c)** no reservation at all
- **resolution:** **portable first**, with **reserved seams**: the Renderer
  interface (ADR-002) admits a future WebGPU backend; the core interpreter is
  kept separable for a future WASM build. Design the seams now, do not invest now.

## D24 — authoring mainline (auto-code)

- **status:** decided
- **question:** With the editor removed and development auto-generated, what is the game-authoring path?
- **options:**
  - **(a)** AI/agent-authored versioned JSON (maps/events/dialogue) → `core` validates → runtime runs; data format AI/hand-write friendly + strictly validated; a CLI validation entry point is the agent gate — *[user's choice]*
  - **(b)** JSON only, no CLI
  - **(c)** JSON + a scripting DSL
- **resolution:** **AI/agent-authored JSON is the primary creation path**, with a
  **CLI validation entry point** (`pnpm validate`, Task 03) as the agent-facing
  gate. Data format is designed to be AI/hand-write friendly + strictly validated
  by `core` (see [docs/principle/editor-less-authoring.md](./principle/editor-less-authoring.md)).

## D25 — development workflow & branches

- **status:** decided
- **question:** How should branches and the dev loop be re-organized (Q8)?
- **options:**
  - **(a)** module-scoped short-lived branches + validate-first workflow: `main` long-lived stable; `feat/<module>/<change>` merged-then-deleted; flow = AI generates JSON → `pnpm validate` → tests → merge; archive history via local tags, no remote branch deletion — *[user's choice]*
  - **(b)** keep the existing branch style, only clean up history
- **resolution:** **module-scoped short-lived branches + validate-first**
  workflow (documented in [docs/03-wal-process.md](./03-wal-process.md) §4).
  Historical branches are **archived via local tags**; **no remote branches are
  deleted** (C3).

---

## Decision log history

| # | Question | Status | Resolution / decided option | Date |
|---|----------|--------|-----------------------------|------|
| Q1 | single-player distribution | decided (reinterpreted) | portable HTML package (`index.html` + `data/` + `js/` + `img/` + `audio/`) + Linux C++ runtime; user-confirmed (RQ1) | round 1 |
| Q2 | multiplayer server role | decided | relay / state-sync server, versioned protocol (opt a) | round 1 |
| Q3 | rendering | decided | WebGL renderer interface + design patterns; Canvas2D fallback decided (RQ2) | round 1 |
| Q4 | scripting | decided | TypeScript + events/API; LLM-NPC interface first, proxy via C++ server, out of MVP | round 1 |
| Q5 | target platforms | decided | editor + game = browser web apps; C++ Linux only; no native path | round 1 |
| Q6 | MVP scope | decided | map editor + SP runtime + 2-player relay + C++ Linux launcher/server | round 1 |
| RQ1 | portable target & saves | decided | portable `www` folder; saves = IndexedDB; C++ (Linux) optional local-file saves (opt a, user-confirmed) | round 2 |
| RQ2 | renderer fallback | decided | Renderer interface, WebGL default + capability detection + Canvas2D fallback, same upper layers (opt a) | round 2 |
| RQ3 | C++ server stack | decided | C++20 + Asio + websocketpp (FetchContent) + custom HTTP static hosting + spdlog + Catch2 + CMake (opt a) | round 2 |
| RQ4 | MVP multiplayer model | decided | 2+ clients → WS → one C++ server (Linux/VPS) relays + broadcasts; no P2P/NAT in MVP (opt a) | round 2 |
| RQ5 | commit attribution | decided | single unified repo-local bot identity for all subagent commits (opt a) | round 2 |
| D12 | editor project storage | decided | user confirmed at consensus gate: IndexedDB (portable/offline) + import/export to folder; C++ file persistence phase 2 | round 2 |
| D13 | editor UI | decided | user confirmed at consensus gate: React + TypeScript + Vite (editor only); runtime stays vanilla TS | round 2 |
| D14 | data formats | decided | user confirmed at consensus gate: versioned JSON schema (shared TS types) for maps/events/saves/protocol; **validation lib = zod (user, round 3)** | round 2/3 |
| D15 | repo structure | decided | user confirmed at consensus gate: monorepo packages/* + server (C++) + samples; pnpm; Vitest + Playwright + Catch2 | round 2 |
| D16 | MVP sync scope | decided | user confirmed at consensus gate: player-state sync only; world-state sync documented MVP limitation | round 2 |
| D17 | all-English | decided | engineering fully English (docs/code/comments/commits/UI strings); game content text unrestricted (player data) | round 3 |
| D18 | agent-operable scope | decided | baseline tier in MVP (AGENTS.md + doc conventions + one-command build/test/lint + doc lint CI); upper tiers designed-now/implemented-later via reserved interfaces | round 3 |
| D19 | docs form | decided | AGENTS.md + doc structure conventions + link/status lint in CI | round 3 |
| D20 | editor disposition | decided | remove packages/editor from main; archive via git tag; add back when a real game takes shape (opt a) | round 4 |
| D21 | multi-backend scope | decided | portable-first engine on every target (browser + JoiPlay today); performance (vgpu/wasm) researched after (opt a) | round 4 |
| D22 | C++ server | decided | keep but demote to optional component; portable single-player engine is core (opt a) | round 4 |
| D23 | performance route | decided | portable first (Canvas2D/WebGL); reserve WebGPU renderer + WASM core as seams, no investment now (opt a) | round 4 |
| D24 | authoring mainline | decided | AI/agent-authored versioned JSON → core validates → runtime runs; CLI validation entry point (opt a) | round 4 |
| D25 | dev workflow & branches | decided | module-scoped short-lived branches + validate-first; archive history via local tags; no remote branch deletion (opt a) | round 4 |
