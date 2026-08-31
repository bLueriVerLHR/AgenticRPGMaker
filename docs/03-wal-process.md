# AgenticRPGMaker — WAL Process (Engineering Playbook)

Concrete rules every team member follows. If you join this project, read this file
**before** writing any code, and follow it on every change.

> **Operating model.** Wording here that speaks of "team member" or a "leader"
> (§6) describes the **multi-member team + leader division-of-labor pattern** this
> repository was scaffolded for (an agentic-team preset). This project currently
> runs as a **single agent** (one owner + one agent), so those multi-member
> provisions are **not binding in this mode** — follow the owner-driven rules in
> `AGENTS.md` (Branch / merge rules) instead. See also
> [docs/temp/preset-branch-merge-rules.md](./temp/preset-branch-merge-rules.md).

---

## 1. What "WAL" means here

WAL = **Write-Ahead-Log** (docs written ahead of code, then corrected after the code
lands). In this project:

1. **No feature starts before its design doc + ADR exists.** Before the first line of
   feature code, a design doc (in `docs/`) and an Architecture Decision Record (in
   `docs/04-adr/`, using the template) must exist and be reviewed.
2. **After the task completes, the docs are corrected/finalized in the same change.**
   The commit that finishes a task also updates its docs to match reality. A task is
   not "done" until docs and code agree.
3. Documentation is reviewed like code, lives in the same repo, and follows the same
   branch/merge rules as code.

### Minimum doc/ADR for a new feature

- Design doc: what the feature does, constraints, interfaces, open questions.
- ADR: the *decision* (status, context, decision, consequences, supersedes) — use
  [`docs/04-adr/ADR-000-template.md`](./04-adr/ADR-000-template.md).

---

## 2. Mandatory logging

Logging is a hard requirement (user rule). We do not debug from zero — logs must exist.

### C++ side — spdlog

- Use **[spdlog](https://github.com/gabime/spdlog)** for all C++ logging.
- Log levels follow spdlog convention: `trace`, `debug`, `info`, `warn`, `error`, `critical`.
- **What to log** (minimum):
  - **Server lifecycle:** startup, config, listening address/port, shutdown, fatal errors.
  - **Connections:** connect / disconnect, client id, session begin/end, handshake result.
  - **Protocol errors:** malformed messages, unknown opcodes, version mismatches,
    checksum/sequence failures — always with enough context to reproduce.
  - **Per-request timing:** latency / processing time per message or per RPC, at least
    at `debug` level, to spot bottlenecks.

### Web side — structured logging

- Use structured (JSON) log entries: `console` + a **remote log sink** for debugging
  sessions (client-side logs forwarded to the server/launcher so a session can be
  inspected centrally).
- Levels mirror C++: `trace`, `debug`, `info`, `warn`, `error`.
- **What to log:** game lifecycle, scene transitions, script/event execution errors,
  network events, editor operations.

### Log level policy

- `info`: default operational level (lifecycle, connections, major events).
- `debug`: enabled when investigating a problem or during development; can be verbose.
- `trace`: fine-grained, off by default, on only in deep debugging.
- `warn` / `error`: always on, never suppressed.
- Log level is configurable at runtime (env var / config file), not hard-coded.

### What must NEVER be logged

- **Secrets:** passwords, tokens, API keys, session secrets, auth material — never in
  logs, never in log files, never in remote sinks. Redact or omit.
- Personal data beyond what is strictly needed for the session to function.

---

## 3. Mandatory tests

Tests are a hard requirement (user rule). Two gate conditions:

1. **Unit + integration + E2E before any merge to `main`.**
2. **Tests before any "real environment" run** — a real-environment run (real servers,
   real hardware, a live session) is only allowed after the test suite passes locally.

### Testing stack (confirmed, D15)

| Layer | Candidate | Status |
|-------|-----------|--------|
| C++ unit tests | **Catch2** | confirmed |
| Web unit/component tests | **Vitest** | confirmed |
| E2E | **Playwright** | confirmed |
| Data gate | **`pnpm validate`** (core schemas, D24) | confirmed |

---

## 4. Branch strategy & dev workflow

Re-orientation (D25, 2026-08-31) replaced the original phase-branch style with a
**module-scoped short-lived branch + validate-first** workflow:

- `main` is the **long-lived stable** branch; it is always buildable and green.
- Work happens on **short-lived feature branches scoped to one module**:
  `feat/<module>/<change>` (e.g. `feat/core/collision-rewrite`,
  `feat/runtime/save-roundtrip`, `docs/reorg-portable-first`). A branch is
  merged **and deleted** once its change lands — no historical branch pile-up.
- **Validate-first loop** (D24, the auto-code mainline):
  1. AI/agent authors versioned JSON (maps/events/dialogue) or code;
  2. `pnpm validate` — the data gate — passes on the change's data;
  3. `pnpm -r test` — unit/integration green;
  4. `pnpm lint` / `pnpm format:check` / `pnpm doc:lint` green;
  5. merge → delete the branch.
- **The owner merges to `main`.** This project is owner-driven; the preset's
  "merge-manager" role is **not** adopted (see
  [docs/temp/preset-branch-merge-rules.md](./temp/preset-branch-merge-rules.md)).
  The owner (or an agent the owner directs) merges directly; there is no separate
  merge-manager gate and no hard "never commit to `main`" rule.
- Branches are preferred for non-trivial work but optional; small changes may
  land directly on `main`, gated by the QA checklist (§5).
- **Historical branches are archived via local git tags, not deleted remotely**
  (C3): e.g. `archive/design-a`, `archive/feat-p2-editor`. A branch that is
  superseded by merged `main` history is tagged and the local branch is removed,
  but **remote branches are never deleted without explicit user authorization**.

---

## 5. QA checklist template

Every feature/change must pass this checklist before it is considered complete and
merged to `main`:

- [ ] **Build passes** (clean build, no warnings treated as errors per config).
- [ ] **Unit tests green** (all affected modules; full suite if cheap).
- [ ] **E2E script run** (the feature's E2E scenario executed and passing).
- [ ] **Logs checked** (the feature produces the mandatory log entries; nothing sensitive leaked).
- [ ] **Docs updated** (design doc + ADR finalized in the same change; project log appended if notable).

---

## 6. Reporting to the leader

- Finish a task → report result (files, branch, commit hash, test/log status) to the leader.
- Blocked or out of scope → report the blocker with a clear reason; do **not** silently
  proceed beyond the delegated scope.

---

## 7. ALL-ENGLISH rule

All **engineering** artifacts are in **English**: docs, code, comments, commit
messages, and UI strings. **Game content text** (dialogue, item names, in-game
descriptions) is **player data** — it is the game author's content and is **not**
language-restricted. English here is about the *engineering* of the product, not
the *content* of the games it builds. (Decision: **D17** — see
[02-open-questions.md](./02-open-questions.md); [ADR-007](./04-adr/ADR-007.md).)

---

## 8. AGENT-READABLE DOCS & agent operability

The system must be operable by agents, not only by humans clicking a GUI.

- **`AGENTS.md`** at the repo root is the **agent onboarding doc**, maintained as
  the entry point: repository layout, WAL rules, one-command build/test/lint
  scripts, where decisions live.
- **Doc structure conventions** apply to every doc: stable headings and
  machine-checkable status fields (see the status legend in
  [02-open-questions.md](./02-open-questions.md) and the ADR template).
- **Doc link/status lint runs in CI** — broken links and invalid status fields
  fail the build.
- **Agent-facing data gate (implemented, D24):** `pnpm validate` validates
  game data (maps/events/dialogue) against the `core` schemas — the validate-first
  step of the dev workflow (§4). This replaces the editor-headless-CLI seam that
  was reserved before the editor was removed (D20).
- **Reserved seams (designed now, implemented later, NOT now):** runtime headless
  test mode, server control API (rooms / status / kick over HTTP/CLI, JSON in/out),
  future WebGPU renderer backend + WASM core (D23). These must not be implemented
  prematurely. (Decisions: **D18/D19/D23/D24** — see
  [02-open-questions.md](./02-open-questions.md); [ADR-007](./04-adr/ADR-007.md),
  [ADR-008](./04-adr/ADR-008.md).)
