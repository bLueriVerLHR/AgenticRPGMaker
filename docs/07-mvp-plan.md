# AgenticRPGMaker — MVP Implementation Plan

> **status: DECIDED (plan for implementation); re-oriented (2026-08-31)**
> Written by design-a against the **settled decision set** (Q1–Q6, RQ1–RQ5 decided;
> D12–D16 treated as decided — see [02-open-questions.md](./02-open-questions.md)).
> The architecture this plan builds is [06-architecture.md](./06-architecture.md).
> Every phase below obeys the WAL/testing gate from
> [03-wal-process.md](./03-wal-process.md).
>
> **Re-orientation (2026-08-31, D20–D25):** the editor workstream (**WS2 / P2 /
> milestone M4**) is **archived** (editor removed from `main`, git tag
> `archive/editor-0.1.0`, D20). The MVP already shipped P0–P5; the forward plan
> re-prioritizes the **portable engine + data-first authoring** (D21/D24) with the
> editor as a **restorable later phase**. See
> [discussion/2026-08-31-reorg.md](./discussion/2026-08-31-reorg.md) and
> [ADR-008](./04-adr/ADR-008.md).

This plan is **dependency-ordered and phased**. Phases map to workstreams; a phase
may not start until its stated dependencies are done (Definition of Done of the
upstream phase). The **WAL/testing gate** is applied at every phase, not just at the
end.

---

## 0. Workstreams & phase map

| # | Workstream | Phase(s) | Owner-type |
|---|-----------|----------|------------|
| WS1 | **engine-core** — `packages/core` + `packages/renderer` + `packages/runtime` | P1 (P0 scaffold) | engine member(s) |
| WS2 | **editor** — ~~`packages/editor`~~ **ARCHIVED (D20)** — removed from `main` (tag `archive/editor-0.1.0`); restore when a real game justifies it | (was P2) | — |
| WS3 | **server** — C++ (CMake, Asio+websocketpp, HTTP static, relay) — **optional (D22)** | P3 | server member(s) |
| WS4 | **qa/tests** — Vitest, Catch2, Playwright, multiplayer smoke, **`pnpm validate` data gate (D24)** | P1–P4 (continuous) | qa member(s) |
| WS5 | **packaging/deploy** — `www` portable folder + single binary | P5 | packaging member(s) |
| WS6 | **owner merge** — the owner merges changes to `main` (no separate merge-manager; see 03-wal-process.md §4) | P1–P6 (continuous) | owner |

Dependency spine: `core → renderer → runtime → (server || packaging)`, with
`qa/tests` running alongside every phase and the owner continuously
absorbing completed work. *(The editor was on this spine pre-re-orientation; it is
archived per D20.)*

```
P0 scaffold ─► P1 engine-core ─► P5 packaging ─► MVP release
                │                │
                └─► P3 server ───┘  (may overlap P1 once protocol schema is frozen;
                                     server is optional per D22)
                │
                └─► P4 qa/tests  (continuous, gates every phase; includes the
                                  pnpm validate data gate, D24)
```

---

## 1. The WAL/testing gate (applies to EVERY phase)

Before any phase ships, all of these must be true. This is the same gate for each
phase below — repeated for emphasis, not per-phase ceremony:

1. **Docs before code (WAL).** A design doc (in `docs/`) **and** an ADR
   ([docs/04-adr/](./04-adr/README.md), template `ADR-000-template.md`) for the
   phase's significant decisions exist and are reviewed **before** the first line of
   implementation code. Per project rules, design-a does not author ADRs — they are
   owned by other design members — but each phase **names the ADRs it depends on**.
2. **Tests before merge.** Unit + integration + E2E pass **before any merge to
   `main`** ([03-wal-process.md](./03-wal-process.md) §3).
3. **Logs before merge.** The phase produces its mandatory log entries (spdlog on
   C++; structured JSON logging on web — [03-wal-process.md](./03-wal-process.md) §2)
   and nothing sensitive leaks.
4. **QA checklist.** The five-item checklist from [03-wal-process.md](./03-wal-process.md)
   §5 is checked off: build passes / unit green / E2E run / logs checked / docs
   updated in the same change.
5. **Definition of Done (DoD)** as stated per phase below.

---

## 2. P0 — Foundations (scaffold)

> **Workstream:** WS1 (engine-core), with WS4/WS6 setup. **Depends on:** nothing.

**Tasks**
- Create the monorepo skeleton per D15: `pnpm-workspace.yaml`, root `package.json`,
  shared TS/tsconfig base, workspace tooling (pnpm).
- Scaffold `packages/core`, `packages/renderer`, `packages/runtime`,
  `packages/editor`, `server/` (empty CMake skeleton), `samples/`.
  *(Historical: `packages/editor` was later archived — D20; it is no longer in
  `main`.)*
- Pin the **versioned JSON schema strategy** (D14): shared TS types in `core`,
  schema versioning convention, `protocol.v1` envelope shape.
- Set up CI-or-checks baseline: lint, format, and the two unit-test runners
  (Vitest for web, Catch2 for C++) so every later phase starts green.
- Set up logging plumbing: web structured logger + remote-sink seam; spdlog setup
  in the C++ skeleton.

**Dependencies**
- None (this is the root of the dependency graph). Assumes ADRs for repo structure
  (D15) and data formats (D14) exist (design-a does not author them).

**Definition of Done**
- `pnpm install` resolves; all packages build from a clean checkout.
- `core` builds with zero DOM deps; schema module loads in Node.
- Lint/format/unit-test commands run green on an empty baseline.
- Logging seams compile (web + C++).

**WAL/testing gate**
- ADR(s) for D14/D15 reviewed before scaffold. Unit-test runners green.
  No E2E required yet (nothing to end-to-end). QA checklist §5 ticked.

---

## 3. P1 — Engine-core (`core` → `renderer` → `runtime`)

> **Workstream:** WS1. **Depends on:** P0. **Order within phase is strict**:
> `core` first (everything else reads it), then `renderer`, then `runtime`.

### 3.1 P1a — `packages/core`

**Tasks**
- Data model: maps, tiles/layers, events, event pages, player, save (D14 schemas).
- **Event interpreter**: event pages → Command/Composite command list → effects
  (the [06-architecture.md](./06-architecture.md) §7 catalog).
- **Entity/Component** model + validation; **NPC `Behavior` (Strategy) interface**
  with rule-based implementation (LLM strategy deferred, Q4).
- `protocol.v1` message types (envelope, versioning) — **frozen here**; the C++
  server (P3) depends on this contract.

**Dependencies:** P0.

**Definition of Done**
- Schemas versioned and validated; interpreter executes a fixture event page
  (walk → dialogue → move-block) producing the expected effects.
- `core` unit tests green (Vitest, Node): model, validation, interpreter,
  protocol encoding/decoding.

### 3.2 P1b — `packages/renderer`

**Tasks**
- `Renderer` interface (Adapter/Strategy) + capability detection.
- `WebGLRenderer` (default) + `Canvas2DRenderer` (fallback) sharing upper layers
  (RQ2): tile rendering, camera, sprite batch, **object pooling** for sprites.
- Render a fixture scene from `core` (reads model only).

**Dependencies:** P1a.

**Definition of Done**
- Same scene renders identically through both backends (visual fixture).
- Capability detection picks WebGL when available, falls back to Canvas2D.
- Renderer unit tests green (fake/fixture scenes; Vitest).

### 3.3 P1c — `packages/runtime`

**Tasks**
- Boot sequence (see [06-architecture.md](./06-architecture.md) §3):
  `core.init → detect.renderer → runtime.boot → scene → game loop`.
- Scene/State management, **Event bus** wiring systems (input → movement →
  collision → dialogue → network).
- Player movement / collision / dialogue (Q6).
- **IndexedDB saves** (RQ1) behind the **Storage adapter** (IndexedDB now, C++
  local-file later).
- **Transport abstraction** (WebSocket relay client now) + versioned handshake +
  heartbeat (Q2, RQ4, protocol.v1).
- Multiplayer smoke-able seam: send/receive `player.state` (D16: players only).

**Dependencies:** P1a + P1b.

**Definition of Done**
- Single-player: walk / collide / dialogue playable from a fixture map; save to
  IndexedDB and reload restores state.
- Multiplayer client: connects to a stub/real WS endpoint, handshake + heartbeat +
  send/apply `player.state` for a remote player.

### 3.4 P1 — overall WAL/testing gate

- ADRs: renderer interface (RQ2), event interpreter (Q4), transport/protocol (Q2),
  storage (RQ1) reviewed before their code.
- Unit + integration green (core↔runtime boot with fixture map; runtime↔renderer
  loop). E2E: single-player walk/collide/dialogue booted in Playwright.
- Logs: boot, scene transitions, event errors, network events present (structured
  JSON on web).
- QA checklist §5 ticked; engine-core changes ready for the owner to merge.

---

## 4. P2 — Editor (`packages/editor`) — ARCHIVED (D20)

> **Archived (D20).** The editor phase (Workstream WS2) was **removed from the
> plan and from `main`** on 2026-08-31 (D20): `packages/editor` is archived via git
> tag `archive/editor-0.1.0`. The MVP editor (tile layers + events, IndexedDB
> project, import/export, runtime preview) was **implemented and shipped** in the
> original P2 (merged to main, branch `feat/p2-editor` @ `b4deb1f`); it is now
> archived because development is **data-first / auto-code** (D24) and a visual
> editor is not needed until a real game exists.
>
> **Restore path:** `git checkout archive/editor-0.1.0`, re-attach `packages/editor`
> onto the same `core` model (no parallel data format), and update
> `06-architecture.md` §2 / `03-wal-process.md` accordingly. Until then, authoring
> is JSON + `pnpm validate` (D24) — see [06-architecture.md](./06-architecture.md) §4.

---

## 5. P3 — Server (C++: CMake, Asio+websocketpp, HTTP static, relay)

> **Workstream:** WS3. **Depends on:** P1a (frozen `protocol.v1`) — may **overlap**
> P1b/P1c once the protocol schema is frozen.

**Tasks**
- CMake build with **FetchContent**: standalone Asio + websocketpp + spdlog +
  Catch2 (RQ3); C++20.
- **Custom HTTP static hosting**: serve `www/` (Q1/RQ1). *(The `editor/` static
  root is unused after the editor was archived — D20.)*
- **WebSocket relay / state-sync**: versioned handshake, message validation,
  last-known-state store, relay/broadcast to peers, **heartbeat/keepalive**
  (Q2, RQ4, D16 — players only).
- Session lifecycle + protocol-error logging (version mismatches, malformed
  envelopes) via spdlog ([03-wal-process.md](./03-wal-process.md) §2).
- Optional local-file save endpoint (RQ1) — **phase-2 flag**, stubbed/skippable.

**Dependencies:** P1a; P5 packaging for the `www` static root (or a stub
`www` for dev). Playwright multiplayer smoke (P4) needs this phase running.

**Definition of Done**
- Single binary serves static `www/` over HTTP and a `/ws` endpoint on
  the same port (configurable). *(The `--editor-root` mount is unused after the
  editor was archived — D20.)*
- Two WebSocket clients connect, handshake versioned, relay `player.state` to each
  other; heartbeat cleans up a dead session.
- Catch2 tests green: protocol parser, relay/state store, HTTP static handler.
- spdlog logs lifecycle, connections, protocol errors (no secrets).

**WAL/testing gate**
- ADR(s) for RQ3 (stack) / RQ4 (network model) reviewed before code.
- Catch2 unit + integration green. E2E: Playwright two-context **multiplayer smoke
  test** (two browser contexts connect to the local server, observe each other
  moving) — added here, maintained in P4.
- QA checklist §5 ticked.

---

## 6. P4 — QA / test hardening (continuous)

> **Workstream:** WS4. **Depends on:** P1–P3 artifacts (tests land with each phase);
> this phase consolidates and hardens.

**Tasks**
- Consolidate the three-layer suite: Vitest unit (core/renderer/runtime),
  Catch2 unit (server), integration harnesses, Playwright E2E.
- Maintain the **multiplayer smoke test** (two browser contexts ↔ local C++ server).
- Edge cases: renderer fallback (simulate no-WebGL), save/load round-trips,
  protocol version mismatch, heartbeat timeout, world-state **documented limitation**
  (players only — D16).
- **Data gate (D24):** `pnpm validate` on all game data — validate-first step of the
  dev workflow ([03-wal-process.md](./03-wal-process.md) §4).
- Test-gate wiring so only green changes merge to `main`.

**Dependencies:** P1, P3 (exercises their outputs; P2/editor is archived — D20).

**Definition of Done**
- Full suite green in CI-equivalent local run; QA checklist §5 passing across all
  phases; a single `test` command covers everything.

**WAL/testing gate**
- ADR for the testing strategy (per [03-wal-process.md](./03-wal-process.md) §3)
  reviewed. No code ships without its phase tests; the two-context smoke test is
  part of the gate from P3 onward.

---

## 7. P5 — Packaging / deploy (portable `www` + single binary)

> **Workstream:** WS5. **Depends on:** P1c (runtime), P3 (server).

**Tasks**
- Build the **portable `www` folder**: `index.html` + `data/` + `js/` + `img/` +
  `audio/` from runtime + a sample map (RQ1). Verify it runs on a static host and a
  JoiPlay-type runtime as far as locally verifiable (compatibility checklist —
  owned by another member — referenced here, not authored by design-a).
- Produce the **single C++ binary** + static files deployment layout
  ([06-architecture.md](./06-architecture.md) §6): `server/` (binary) + `www/`.
- Local launcher mode (localhost serving) and VPS mode (remote WebSocket host) both
  verified from the same artifact (RQ4).
- `samples/` populated with runnable example maps/projects demonstrating the
  pipeline.

**Dependencies:** P1c, P3.

**Definition of Done**
- One command produces `www/` + binary; the binary serves the portable game;
  a sample game runs end-to-end (walk/collide/dialogue + 2-player sync).

**WAL/testing gate**
- ADR/design doc for packaging (Q1/RQ1 deployment) reviewed before the packaging
  scripts ship. Full QA checklist §5 ticked. **Tests before any real-environment
  run** ([03-wal-process.md](./03-wal-process.md) §3).

---

## 8. P6 — Merge & release (owner)

> **Workstream:** WS6. **Depends on:** P1–P5 all green; continuous throughout.

**Tasks**
- Merge member branches to `main` **only** when the phase DoD + QA checklist §5 are
  green ([03-wal-process.md](./03-wal-process.md) §4 — nobody else merges).
- Maintain the branch strategy: feature branches (`design/a`, `feat/engine-core`,
  …) reviewed and merged by the owner (no separate merge-manager — see
  [03-wal-process.md](./03-wal-process.md) §4).
- Tag the MVP release once P5 ships and all suites are green.

**Dependencies:** every phase (absorbed incrementally, not batched at the end).

**Definition of Done**
- `main` contains the full MVP: engine-core + optional server + tests + packaging,
  docs corrected to match reality (WAL). *(The editor is archived — D20.)*

**WAL/testing gate**
- The owner enforces, for every merged change: docs/ADR finalized in the same change; unit +
  integration + E2E green; logs checked; QA checklist §5 ticked.

---

## 9. Milestones & non-goals

### 9.1 Milestones (ordered)

| Milestone | Contents | Exits phase |
|-----------|----------|-------------|
| **M0 — Foundations green** | Monorepo, schemas, test runners, logging seams | P0 |
| **M1 — Core complete** | Data model, event interpreter, entity/component, Behavior interface, `protocol.v1` | P1a |
| **M2 — Renderer complete** | WebGL + Canvas2D fallback behind `Renderer` interface | P1b |
| **M3 — Single-player runtime playable** | Walk / collide / dialogue, IndexedDB saves | P1c |
| **M4 — Editor MVP** | Tile layers + events, IndexedDB project, import/export, runtime preview — **ARCHIVED (D20)**; implemented + shipped in original P2, then removed from `main` (tag `archive/editor-0.1.0`) | ~~P2~~ (was) |
| **M5 — Server + 2-player sync** | HTTP static + WS relay, handshake/heartbeat, versioning | P3 |
| **M6 — QA hardened** | Full suite green incl. two-context multiplayer smoke | P4 |
| **M7 — Portable package + binary** | `www` + single binary, local & VPS modes, samples | P5 |
| **M8 — MVP release** | Everything merged to `main`, tagged | P6 |

### 9.2 Explicit MVP non-goals

These are **documented as out of scope** for the MVP (Q6 + D16 + this plan's scope
control) — deliberately excluded so the MVP stays shippable:

- **Matchmaking** — no lobbies/queues; players join by connecting to a server URL.
- **Animation editor** — sprite frames authored as assets, not edited in the tool.
- **Cloud saves** — saves are IndexedDB (portable) / optional C++ local files; no
  server-side save accounts.
- **LLM NPCs** — the `Behavior` interface exists (Q4), but only the rule-based
  strategy ships; LLM via C++ server proxy is a later phase.
- **Audio** — no audio engine/assets in the MVP (portable `audio/` folder exists in
  the `www` layout but is not populated by a tool).
- **Combat / inventory** — no battle system or item inventory in the MVP.
- **World-state sync** — doors/switches/NPCs are evaluated locally and can diverge;
  **documented limitation** (D16), not a bug. Future: host-authoritative world state
  or embedded-JS authoritative server.
- **NAT punch-through / P2P** — server-relayed only (RQ4).
- **Non-Linux server targets / native desktop apps** — C++ Linux only, no webview
  (Q5).

Anything not on a milestone above is treated as **not in the MVP** unless the leader
re-decides it in [02-open-questions.md](./02-open-questions.md).

---

## 10. Suggested branch / commit hygiene for this plan

> **Updated for D25 (2026-08-31):** the module-scoped short-lived branch workflow
> in [03-wal-process.md](./03-wal-process.md) §4 supersedes the phase-per-branch
> style below. Keep this historical note for context.

- One feature branch per phase/workstream (e.g. `feat/engine-core`,
  `feat/server-relay`), merged by the owner (no separate merge-manager — see
  [03-wal-process.md](./03-wal-process.md) §4).
- All subagent commits use the single repo-local bot identity (RQ5).
- Docs are **corrected in the same change as the code** (WAL) — a phase is not
  "done" until `docs/` matches what was built.