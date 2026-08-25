# AgenticRPGMaker — Open Questions (Decision Log)

Numbered decision log for the kickoff discussion round. Each entry has a **status**,
the **question**, the **options**, and the **leader's recommendation**.

## Status legend

- `pending` — open, awaiting a decision (the leader drives it).
- `decided` — closed; the chosen option is recorded.
- `superseded` — a later decision replaced this one (keep the history).

> Current state (kickoff): **all six questions are `pending`**. When the leader
> decides one, update its status and record the outcome + date.

---

## Q1 — single-player distribution

- **status:** pending
- **question:** How does a single player launch the game?
- **options:**
  - **(a)** C++ launcher starts a tiny local HTTP/WS server and opens the system browser — *[leader's recommendation]*
  - **(b)** embedded webview (WebView2/CEF) window — more native feel, but heavy platform-specific deps
  - **(c)** both modes behind a flag
  - **(d)** pure-HTML single-player with no C++ (only viable if browser File System Access API / OPFS suffice) — *contradicts the user's stated premise and is being challenged*

## Q2 — multiplayer server role

- **status:** pending
- **question:** What role does the multiplayer server play?
- **options:**
  - **(a)** relay / state-sync server — server is a thin pipe that also stores state; game logic runs client-side; versioned protocol so an authoritative server can be added later — *[leader's recommendation for MVP]*
  - **(b)** authoritative server — C++ embeds a JS engine (QuickJS/V8) and runs the SAME game logic server-side (anti-cheat, consistent simulation; more work upfront)
  - **(c)** re-implement game logic natively in C++ — *[leader rejects: doubles the codebase]*
  - **(d)** hybrid — host-authoritative for small groups, relay for larger sessions
- **dependency note:** option **(b)** requires the scripting question (**Q4**) to be answered with *JS in-engine*.

## Q3 — rendering

- **status:** pending
- **question:** How do we render the game?
- **options:**
  - **(a)** thin renderer interface with a Canvas2D implementation for MVP, WebGL-ready abstraction later — *[leader's recommendation]*
  - **(b)** PixiJS (battle-tested WebGL/Canvas; what RPG Maker MZ uses) — faster to build, less from-scratch
  - **(c)** raw WebGL from day one

## Q4 — scripting

- **status:** pending
- **question:** How do game authors express game logic?
- **options:**
  - **(a)** visual event pages + JS script API (like RPG Maker MV/MZ: event commands callable from scripts) — *[leader's recommendation]*
  - **(b)** pure visual events, no scripting
  - **(c)** game code authored in TypeScript, compiled to JS bundles

## Q5 — target platforms

- **status:** pending
- **question:** Which platforms do we target?
- **options:**
  - **(a)** desktop Windows + macOS for editor and client; server builds for Linux + Windows — *[leader's recommendation]*
  - **(b)** Windows only for MVP
  - **(c)** Windows + macOS + Linux all three from the start
  - **(d)** server-first (Linux), client = any modern browser

## Q6 — MVP scope

- **status:** pending
- **question:** What exactly is in the MVP?
- **options:**
  - **(a)** map editor (tile layers + event placement) + runtime (walk / collide / dialogue) + 2-player LAN sync (players see each other move) + C++ launcher serving content; explicit non-goals: matchmaking, animation editor, cloud saves — *[leader's recommendation]*
  - **(b)** smaller: editor + single-player runtime only, multiplayer in phase 2
  - **(c)** bigger: also save/load, inventory, basic combat

---

## Decision log history

| # | Question | Status | Decided option | Date |
|---|----------|--------|----------------|------|
| Q1 | single-player distribution | pending | — | kickoff |
| Q2 | multiplayer server role | pending | — | kickoff |
| Q3 | rendering | pending | — | kickoff |
| Q4 | scripting | pending | — | kickoff |
| Q5 | target platforms | pending | — | kickoff |
| Q6 | MVP scope | pending | — | kickoff |
