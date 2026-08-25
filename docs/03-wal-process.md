# AgenticRPGMaker — WAL Process (Engineering Playbook)

Concrete rules every team member follows. If you join this project, read this file
**before** writing any code, and follow it on every change.

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

### Testing stack (placeholder — to be confirmed)

| Layer | Candidate | Status |
|-------|-----------|--------|
| C++ unit tests | **Catch2** or **GoogleTest** | to be confirmed |
| Web unit/component tests | **Vitest** | to be confirmed |
| E2E | **Playwright** | to be confirmed |

Update this table once the leader confirms the stack.

---

## 4. Branch strategy

- Members work on **feature branches** (e.g. `docs/wal-init`, `feat/editor-map`, `fix/collision`).
- A designated **merge-manager** merges feature branches to `main`. **Nobody else merges.**
- Feature branches are pushed to the shared remote so the merge-manager can review and merge.
- Never commit directly to `main`.

---

## 5. QA checklist template

Every feature/change must pass this checklist before it is considered complete and
handed to the merge-manager:

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
