# AgenticRPGMaker — Open Questions (Decision Log)

Numbered decision log. Each entry has a **status**, the **question**, the **options**,
and the **leader's recommendation**. Resolved items keep their original options for
history and add a **resolution** note recording what was actually decided.

## Status legend

- `pending` — open, awaiting a decision (the leader drives it).
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
  - ⏳ **PENDING:** user confirmation of this restated understanding — see **RQ1**.

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
  - ⏳ **PENDING sub-decision:** fallback strategy on weak/mobile runtimes — see **RQ2**.

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

# Round 2 — pending (RQ1–RQ5)

## RQ1 — portable target & saves

- **status:** pending
- **question:** Confirm the reinterpretation: portable deploy = RPG-Maker-style
  `www` folder (`index.html` + `data/` + `js/` + `img/` + `audio/`) runnable on
  JoiPlay/any static host; saves use IndexedDB/localStorage (portable).
- **options:**
  - **(a)** confirmation of this design — *[leader's recommendation]*
  - **(b)** true single-file HTML with all assets inlined
  - **(c)** other

## RQ2 — renderer fallback

- **status:** pending
- **question:** Weak devices / JoiPlay WebViews may have poor or no WebGL.
- **options:**
  - **(a)** Renderer interface with WebGL default + capability detection + automatic Canvas2D fallback renderer, sharing the same upper layers — *[leader's recommendation]*
  - **(b)** WebGL only
  - **(c)** WebGL on desktop browsers, Canvas2D backend for mobile runtimes

## RQ3 — C++ server stack

- **status:** pending
- **question:** Which C++ server/library stack?
- **options:**
  - **(a)** C++20 + standalone Asio + websocketpp (header-only via FetchContent), custom HTTP static hosting, spdlog logging, Catch2 tests, CMake build — *[leader's recommendation]*
  - **(b)** Drogon (modern C++20 framework, HTTP+WS+ORM, heavier)
  - **(c)** Crow (lightweight, weaker WS)
  - **(d)** uWebSockets (fastest, higher API risk for the agent team)

## RQ4 — MVP multiplayer model

- **status:** pending
- **question:** How do players connect in the MVP?
- **options:**
  - **(a)** 2+ clients connect over WebSocket to ONE C++ server (on some Linux box or cloud VPS) that relays and broadcasts player position/state; no NAT punch-through / P2P in MVP — *[leader's recommendation]*
  - **(b)** LAN-only (server must run on a local Linux box)
  - **(c)** cloud-first deployment (VPS), local launcher only for dev

## RQ5 — commit attribution

- **status:** pending
- **question:** What git identity do subagent commits use?
- **options:**
  - **(a)** all subagent commits use a single repo-local bot identity (e.g. "AgenticRPGMaker Bot") to avoid fabricating the user's name — *[leader's recommendation]*
  - **(b)** use the user's GitHub identity
  - **(c)** per-member identities

---

## Decision log history

| # | Question | Status | Resolution / decided option | Date |
|---|----------|--------|-----------------------------|------|
| Q1 | single-player distribution | decided (reinterpreted) | portable HTML package (`index.html` + `data/` + `js/` + `img/` + `audio/`) + Linux C++ runtime; pending user confirmation (RQ1) | round 1 |
| Q2 | multiplayer server role | decided | relay / state-sync server, versioned protocol (opt a) | round 1 |
| Q3 | rendering | decided | WebGL renderer interface + design patterns; fallback pending (RQ2) | round 1 |
| Q4 | scripting | decided | TypeScript + events/API; LLM-NPC interface first, proxy via C++ server, out of MVP | round 1 |
| Q5 | target platforms | decided | editor + game = browser web apps; C++ Linux only; no native path | round 1 |
| Q6 | MVP scope | decided | map editor + SP runtime + 2-player relay + C++ Linux launcher/server | round 1 |
| RQ1 | portable target & saves | pending | — | round 2 |
| RQ2 | renderer fallback | pending | — | round 2 |
| RQ3 | C++ server stack | pending | — | round 2 |
| RQ4 | MVP multiplayer model | pending | — | round 2 |
| RQ5 | commit attribution | pending | — | round 2 |
