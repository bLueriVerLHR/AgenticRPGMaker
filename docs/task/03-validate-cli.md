# Task 03 — Minimal validation CLI (agent-facing gate)

| Field | Value |
|---|---|
| **Goal** | A one-command validation entry point (`pnpm validate`) that validates `data/` JSON documents against the `core` schemas, as the agent/AI author's gate (D24). No project generation / scaffolding. |
| **Why** | D24 (AI-authored JSON → validate → run) needs a deterministic, CLI-able validator that agents can run in CI/local before the runtime boots. Builds on the validation already in `core` (ADR-003). |
| **Approach** | 1. Create `scripts/validate.mjs`: walk the given data directory (default `samples/` or `www/data`), load each document, run it through `core`'s parsers (`parseMapDocument`, `parseProjectDocument`, `parseTilesetDocument`, manifest), and report per-file pass/fail with error detail; exit 0/1. 2. Wire `"validate": "node scripts/validate.mjs"` in root `package.json`. 3. Reuse the banned-API-free, Node-runnable core (core is zero-DOM). 4. Add a tiny Vitest test for the CLI logic (pure function over a fixture dir) if cheap; otherwise cover via the QA gate's existing core validation tests. 5. Document usage in `AGENTS.md` one-command scripts and `docs/03-wal-process.md` (validate-first step of the new workflow). |
| **Files touched** | `scripts/validate.mjs` (new), `package.json`, `AGENTS.md`, `docs/03-wal-process.md`, (optional) a validate test |
| **Acceptance criteria** | `pnpm validate` exits 0 on `samples/` (or `www/data`) and exits 1 with clear per-file errors on a tampered copy; runs from a clean clone without a prebuilt dist (aliases to TS sources like build-www); `pnpm lint`/`format:check` pass. |
| **Status** | todo |
