# AgenticRPGMaker — Architecture & Design Overview

> **status: DECIDED (design reference for implementation)**
> Written by design-a against the **settled decision set**: Q1–Q6 and RQ1–RQ5 are
> `decided`, and D12–D16 are treated as decided for this document (see
> [02-open-questions.md](./02-open-questions.md)). This document describes **what we
> build**; [07-mvp-plan.md](./07-mvp-plan.md) describes **in what order**. Per the WAL
> process it is corrected/finalized in the same change as the code it describes.

This is the single architecture reference for AgenticRPGMaker: the monorepo layout,
the runtime and editor boot flows, the multiplayer data flow, the deployment model,
the design-pattern catalog, logging/observability, and the testing strategy. All
product decisions live in [01-vision.md](./01-vision.md) and
[02-open-questions.md](./02-open-questions.md) — this file does not re-decide them,
it makes them concrete.

---

## 1. Overview: three cooperating pieces

AgenticRPGMaker is **not one program** — it is a small set of loosely coupled pieces
that share one data model:

| Piece | What it is | Where it runs |
|-------|-----------|---------------|
| **The game (runtime)** | The playable RPG — a **portable HTML package** (`index.html` + `data/` + `js/` + `img/` + `audio/`, Q1/RQ1) | Any modern browser, any static host, JoiPlay-type mobile runtimes |
| **The editor (Game Maker)** | A **web app** for building maps/events (Q5, D13) | Browser; React + TypeScript + Vite |
| **The server** | **C++ Linux** binary: HTTP static host + WebSocket **relay / state-sync** (Q2, RQ3, RQ4) | Linux box, VPS, or localhost |

All three speak the **same versioned JSON data formats** (D14) and share the
**data model + event interpreter** that live in `packages/core`.

---

## 2. Monorepo layout (D15)

pnpm workspaces monorepo: four TypeScript packages, one C++ server, one samples
folder:

```
AgenticRPGMaker/
├── packages/
│   ├── core/       # data model, event interpreter, shared types/schemas  (vanilla TS)
│   ├── renderer/   # Renderer interface + WebGL & Canvas2D backends        (vanilla TS)
│   ├── runtime/    # game loop, scenes, save/load, multiplayer client      (vanilla TS)
│   └── editor/     # React map/event editor + runtime preview              (React + TS + Vite)
├── server/         # C++20: Asio + websocketpp, HTTP static, relay, spdlog, Catch2, CMake
├── samples/        # sample maps/projects/www bundles exercising the pipeline
└── docs/           # this tree
```

### 2.1 Package responsibilities & dependencies

| Package | Responsibility | Depends on | Never depends on |
|---------|----------------|------------|------------------|
| **`packages/core`** | Ground truth: map/tile/event/save/player **data model**; the **event interpreter** (event pages → commands → effects); shared **JSON schemas** and types (D14); validation; protocol message schema `protocol.v1`. | nothing (zero browser/DOM deps; runs in Node for tests too) | — |
| **`packages/renderer`** | Draws a scene to a canvas behind the **Renderer interface**: `WebGLRenderer` (default) + `Canvas2DRenderer` (fallback), chosen by capability detection (RQ2); sprite/tile batching, camera, object pooling. | `core` (reads the model; knows nothing about game systems) | `runtime`, DOM beyond the canvas element |
| **`packages/runtime`** | The playable game: boot sequence, **game loop** (update → render), scene/state management, player movement / collision / dialogue, **IndexedDB saves**, **multiplayer client** (transport abstraction → WebSocket). Framework-free vanilla TS for portability (D13). | `core` (model + event interpreter) and `renderer` (paint the scene) | `editor`, React, any browser-chrome-specific API outside the boot seam |
| **`packages/editor`** | The Game Maker: tile layers + event placement (Q6), project stored in **IndexedDB** with **import/export to folder** (D12); **embedded runtime preview**; writes only through `core` APIs. | `core` (single source of truth) + the runtime bundle (preview) / `core`'s own scene runner | — |
| **`server/`** | C++ Linux binary: **custom HTTP static hosting** of `www/` and the editor build; **WebSocket relay/state-sync** endpoint; optional local-file save endpoint (RQ1, phase 2); spdlog logging; Catch2 tests; CMake (RQ3). | nothing from the TS workspace at build time — only the **protocol schema** (frozen `protocol.v1`, defined in `core`) | the TS packages (it is a network peer, not a library) |
| **`samples/`** | Runnable example maps/events and generated `www` bundles proving the editor → core → runtime → server pipeline end to end. | the packages | — |

### 2.2 Dependency graph (text diagram)

```
        ┌────────────────────────────────────────────┐
        │                 packages/core              │
        │   data model · event interpreter · schemas │
        │        (single source of truth)            │
        └───────┬──────────────────┬─────────────────┘
                │                  │
        ┌───────▼───────┐   ┌──────▼────────┐
        │ packages/     │   │ packages/     │
        │ renderer      │   │ editor        │
        │ WebGL+Canvas2D│   │ React app     │
        └───────────────┘   └──────┬────────┘
                                   │ (embeds runtime for preview)
        ┌──────────────────────────▼──────────┐
        │            packages/runtime          │◄────┐
        │ game loop · scenes · saves · net     │     │
        └───────────────┬──────────────────────┘     │
                        │ WebSocket (versioned JSON, │
                        │ protocol.v1)               │
          ┌─────────────▼──────────────┐              │
          │       server/ (C++)        │              │
          │ HTTP static + WS relay     │              │
          └────────────────────────────┘              │
                                                      │
   editor→core, runtime→core+renderer, renderer→core, │
   server↔runtime via WS protocol (bidirectional) ────┘
```

Edge list (the same graph in text):

- `editor → core` — the editor mutates only core-owned model objects.
- `runtime → core + renderer` — the runtime drives the model and asks the renderer
  to paint it.
- `renderer → core` — the renderer reads the model to know what to draw.
- `server ↔ runtime` — **WebSocket**, versioned JSON messages (`protocol.v1`). Not a
  package dependency: an agreed wire contract.
- `editor → runtime (preview)` — the editor embeds the runtime bundle to preview the
  current map inside the same core model; no format conversion.
- `samples → packages` — build-time only.

Rule: **arrows point downward only** — nothing in `core` knows about renderer,
runtime, editor, or server. This keeps the single source of truth clean and testable.

---

## 3. Runtime boot flow (the playable game)

The game is the portable `www` package. Boot sequence, in order:

1. **Browser loads `index.html`** from whatever serves it — static host, JoiPlay
   runtime, or the C++ server (localhost or VPS). The page is unremarkable HTML;
   no native app required (Q1/RQ1).
2. **`core` init** — the first loaded module initializes the shared data model:
   registers JSON schemas (`map`, `tile`, `event`, `save`, `player`, `protocol.v1`),
   validates the bundled `data/` assets, and exposes the event interpreter. No DOM
   access, so this step is identical in Node (tests) and the browser.
3. **Renderer capability detection** — probe for a WebGL context (WebGL1/2). If
   available, construct the `WebGLRenderer` (**default**); otherwise fall back to the
   `Canvas2DRenderer` (RQ2). Everything above the interface is backend-agnostic.
4. **`runtime` boot** — build the first `Scene` from core's model (map + tiles +
   events), wire systems (input, movement, collision, dialogue, network) via the
   **event bus**, and enter the scene (**State pattern**).
5. **Game loop** — per-frame `update(dt)` → `render()`, until the player quits.
6. **Saves** — **IndexedDB**: on save, serialize the `save` schema from core and
   store it under the project/origin (portable, RQ1). On load, read IndexedDB and
   feed the model back through core. The C++ server can offer **local-file saves as
   an option** (RQ1) — phase 2, behind the storage abstraction.
7. **Multiplayer connect** — the runtime's transport client opens a WebSocket to the
   configured server URL, performs a versioned handshake, then heartbeats and
   exchanges state (see §5).

```
index.html → core.init → detect.renderer (WebGL? → WebGLRenderer
                         else Canvas2DRenderer)
         → runtime.boot → scene.enter → game loop (update/render)
         → saves: IndexedDB (load/save)        → network: WS → C++ server
```

---

## 4. Editor boot flow (the Game Maker)

1. Browser loads the **editor build** (React + TS + Vite, D13) — served by the C++
   server in production, by Vite dev server in development. The editor is
   editor-only: it never runs the full game's boot sequence.
2. **Project storage** — the editor keeps the project (maps, tilesets, events,
   settings) in **IndexedDB** (D12): portable, offline-capable. **Import/export to
   folder** turns the project into/from the standard portable formats (a folder
   bundle or a directory of `data/` JSON, matching the `www` layout), so a project
   can move between machines and into the C++ server's file persistence later.
3. **Editing through core** — every editor operation (place tile, place event, edit
   event page) calls `core`'s model APIs and validator. The editor holds no
   second copy of the world; **core is the single source of truth** — data model and
   event interpreter both live in `packages/core`.
4. **Runtime preview** — the editor embeds the runtime (same bundle a player would
   run) over the current map. Because both sides share the core model, the preview
   is WYSIWYG: no export/import round trip, no drift between "what I edited" and
   "what plays".
5. **Map data flow editor ↔ runtime** — all through shared core. The editor mutates
   the model in place; the preview (and, at deploy time, the exported `www/data/`)
   consume exactly that model.

---

## 5. Multiplayer data flow (MVP: relay, players only)

### 5.1 Message path

```
 client A ──WS──► server/ (C++) ──relay/broadcast──► client B, client C …
   ▲                                                    │
   └─────────────────── echo / ack ◄────────────────────┘
```

1. **Client A** mutates its local player state (position / direction / animation).
2. The runtime's transport serializes a **versioned envelope** and sends it over
   WebSocket, e.g.
   `{"v":1,"type":"player.state","id":"<session>","pos":{"x":..,"y":..},"dir":"down","anim":"walk"}`.
3. **The C++ server** validates the envelope (version, schema, size), updates its
   last-known-state store for that client, and **relays/broadcasts** the state to the
   other connected clients (and echoes an ack to the sender). Game logic is **not**
   evaluated server-side — the server is a thin pipe + state store (Q2).
4. **Other clients** apply the remote state to their local scenes (with small
   interpolation for smoothness). MVP sync scope = **players only** (D16):
   position/direction/animation, join/leave, chat.

### 5.2 Protocol versioning

- Every message carries a **protocol version** (`protocol.v1` envelope defined in
  `core`).
- On connect, client and server exchange a versioned handshake; a mismatch is
  rejected with a clear error on both sides and logged as a protocol error
  (per [03-wal-process.md](./03-wal-process.md) logging rules).
- The versioned envelope is the seam that allows the server to become **authoritative
  later** without breaking clients (Q2 option a → future options b/d).

### 5.3 Heartbeat

- Client and server exchange periodic heartbeat/keepalive messages (ping/pong).
- A missing heartbeat → the server marks the session stale, broadcasts
  `player.leave`, and reclaims the connection. Clients likewise drop a silent server.

### 5.4 Documented MVP limitation: sync scope = players only

- **World-state sync (doors/switches/NPCs) is OUT of the MVP** (D16). If two players
  trigger the same switch, each client evaluates it locally; they can diverge. This
  is a **documented limitation** — not a silent bug — and the future paths are
  host-authoritative world state or an embedded-JS authoritative server.

---

## 6. Deployment model

**One C++ Linux binary + static files.** There is no app-server, no database, no
reverse-proxy requirement in the MVP (RQ3/RQ4).

```
server/   (the binary, e.g. agenticrpgmaker-server)
www/      ← portable game package (freshly built: index.html + data/ + js/ + img/ + audio/)
editor/   ← editor build (static assets from packages/editor)
assets/   ← shared static assets served to both (optional)
```

- The binary serves **HTTP static content** (`www/` and `editor/`) and a
  **WebSocket endpoint** (`/ws`) — same process, same port (configurable).
- A player opens `http://host/` → the game. An editor user opens
  `http://host/editor` → the Game Maker.
- The same binary works:
  - **locally** — the launcher/single-player use case: `localhost`, serve the www
    package, optional local-file saves (Q1, RQ1);
  - **as a cloud VPS multiplayer host** — players connect from anywhere over
    WebSocket (RQ4); no NAT punch-through / P2P in the MVP.
- TLS is out of scope for the MVP deployment (documented); a reverse proxy can be
  added later without code changes (HTTP + WS both speak standard ports).

---

## 7. Design patterns catalog

The user explicitly asked for **heavy use of design patterns** (Q3) to isolate risk:
each risky seam (renderer, networking, NPC intelligence, storage, scenes, draw/busy
objects) is hidden behind a small interface. This table is the catalog — every
pattern below is a **planned, named** element of the implementation, not an accident.

| Pattern | Where it is used | Why (risk it isolates) |
|---------|------------------|------------------------|
| **Renderer interface** (Adapter / Strategy) | `packages/renderer`: `Renderer` interface with `WebGLRenderer` (default) and `Canvas2DRenderer` (fallback), selected by capability detection (RQ2) | WebGL availability varies wildly (JoiPlay WebViews, weak devices); upper layers and the game loop stay identical across backends; a fake renderer makes tests fast |
| **Event bus** (Observer / Pub-Sub) | `packages/runtime`: systems (input → movement → animation → dialogue → network) publish/subscribe through a central bus | Decouples systems so one subsystem (e.g. networking) can be added/removed without touching gameplay code; natural fit for log/telemetry hooks |
| **Event command system** (Command + Composite) | `packages/core`: each event-page line is a **Command** object; a page is a **Composite** (an ordered command list) interpreted by the event interpreter | Event pages are pure data (JSON — D14) yet behave like code: commands are scriptable, serializable, replayable, and could be redone/undone by the editor; the interpreter is the only executor |
| **Entity / Component model** (Component pattern) | `packages/core` + `packages/runtime`: entities (player, NPC, trigger) composed of components (position, sprite, collider, behavior) | Data-driven and flexible: the same entity shape serves editor, runtime, and (future) authoritative server; avoids deep inheritance trees |
| **NPC behavior** (Strategy) | `packages/core`: `Behavior` interface with a rule-based strategy now; **LLM strategy later via C++ server proxy** (Q4) | The Q4 decision: design the pluggable intelligence interface NOW so LLM-NPCs (out of MVP) slot in by adding a strategy, not by rewriting NPCs |
| **Scene management** (State) | `packages/runtime`: `Scene` states (map, dialogue, menu; title/future battle) with a state manager; `update/render` delegated to the active scene | Predictable lifecycle (enter/update/exit), clean transitions, no god-object game class |
| **Storage abstraction** (Adapter) | `packages/runtime` + `packages/editor`: `Storage` interface with an **IndexedDB adapter** (web/portable, RQ1) and a **file adapter via the C++ server** (Linux, optional, phase 2) | Saves must stay portable (IndexedDB) while the C++ path is an option later; swap adapters without touching game logic |
| **Object pooling** | `packages/renderer` + `packages/runtime`: pooled sprites/entities (projectiles, effects, respawning entities) | Avoids GC hitches and allocation churn inside the hot game loop on weak mobile runtimes |
| **Transport / protocol abstraction** (Adapter / Strategy) | `packages/runtime`: `Transport` interface with a **WebSocket relay client now**; authoritative/proxy transports later | Q2's "versioned protocol so an authoritative server can be added later" — the client code talks to the interface, not to sockets; protocol versioning (v1) rides on top |

Cross-cutting rule: **every pattern hides a "will change later" axis** — renderer
backend, server role, NPC intelligence, storage medium, scene set. If an axis never
changes, it doesn't need a pattern.

---

## 8. Logging & observability

Mandatory per the user's engineering rules and
[03-wal-process.md](./03-wal-process.md) §2. We do not debug from zero.

### C++ side — spdlog (RQ3)

- Levels: `trace`, `debug`, `info`, `warn`, `error`, `critical` (spdlog convention).
- **What to log (minimum):**
  - server lifecycle: startup, config, listen address/port, shutdown, fatal errors;
  - connections: connect/disconnect, client id, session begin/end, handshake result;
  - protocol errors: malformed messages, unknown opcodes, **version mismatches**,
    schema violations — with enough context to reproduce;
  - per-message timing / processing latency at `debug` at least.

### Web side — structured logging

- Structured (JSON) log entries via `console` + a **remote log sink** that forwards
  client logs to the server/launcher so a debugging session is inspectable centrally
  (per [03-wal-process.md](./03-wal-process.md)).
- Levels mirror C++: `trace`, `debug`, `info`, `warn`, `error`.
- **What to log:** game lifecycle, scene transitions, event/script execution errors,
  network events (connect/disconnect/send-recv at debug), editor operations.

### Level policy

- `info` = default operational level; `debug` = on when investigating;
  `trace` = off by default; `warn`/`error` = always on, never suppressed.
- Level is **runtime-configurable** (env var / config file), not hard-coded.

### Never log

- **Secrets** (passwords, tokens, API keys, session secrets, auth material) —
  redact or omit everywhere, including remote sinks.
- Personal data beyond what the session strictly needs.

---

## 9. Testing strategy

Tests are mandatory (user rule; [03-wal-process.md](./03-wal-process.md) §3). Three
layers, plus the QA gate:

| Layer | Tool | What is covered |
|-------|------|-----------------|
| **Unit** | **Vitest** (web packages) / **Catch2** (C++) | core model + validation + **event interpreter** (pages → commands → effects); renderer logic against a fake/fixture scene; C++ protocol parser, relay state store, HTTP static handler |
| **Integration** | Vitest + Catch2 (+ small harness) | core ↔ runtime boot with a fixture map; runtime ↔ renderer draw loop; **server handshake/versioning**; editor writes core model → runtime preview reads same model |
| **E2E** | **Playwright** | Boot the game: walk / collide / dialogue; editor: build a map with events → play it; **multiplayer smoke test: two browser contexts** connect to a local C++ server and observe each other moving |

### QA gate (per [03-wal-process.md](./03-wal-process.md) §5)

Every change, before merge to `main` via the merge-manager:

- [ ] Build passes (clean build, warnings-as-errors per config).
- [ ] Unit tests green (affected modules; full suite if cheap).
- [ ] E2E script run (including the two-context multiplayer smoke test where relevant).
- [ ] Logs checked (mandatory entries present; nothing sensitive leaked).
- [ ] Docs updated (design doc + ADR finalized in the same change).

---

## 10. Key seams summary (map to 07-mvp-plan.md)

| Seam | Interface | MVP implementation | Future option |
|------|-----------|--------------------|---------------|
| Renderer | `Renderer` | WebGL default + Canvas2D fallback | more backends |
| Transport | `Transport` | WebSocket relay client | authoritative/proxy transports |
| NPC intelligence | `Behavior` | rule-based | LLM via C++ server proxy |
| Storage | `Storage` | IndexedDB | C++ local-file adapter |
| Save sync scope | (protocol) | players only (D16) | world-state sync |

*Follow-on: each significant decision above becomes an ADR in
[04-adr/](./04-adr/README.md) (other design members own those files).*