# Decided-not-to-be-scope — pre-existing runtime boot bug found during re-org QA

- **Date:** 2026-08-31
- **Context:** While running the QA gate for the 2026-08-31 re-orientation
  (D20–D25), the runtime Playwright E2E (`pnpm --filter @agenticrpg/runtime
  test:e2e`) failed for the first time in this environment: "timed out waiting
  for HUD (boot)".
- **Root cause:** `rendererBackend()` in `packages/runtime/src/boot.ts` extracts
  the `getBackend` method and calls it bare:
  `const getBackend = renderer.getBackend; ... getBackend()` → `this` is
  `undefined`, and `WebGLRenderer.getBackend()` returns `this.backend` → throws
  `TypeError: Cannot read properties of undefined (reading 'backend')` during
  `boot()`.
- **Why it was latent:** the code is identical in the original commit `851fad1`
  (pre-re-org). The QA gate step 10 says E2E is "skipped gracefully when
  Playwright browsers are unavailable" — the original environment evidently
  skipped it, so the bug never surfaced.
- **Decision:** this is a **pre-existing bug outside the re-org scope**, but it
  blocks the QA gate, so it is fixed in this same change: call
  `renderer.getBackend()` directly (preserves `this`) in `rendererBackend()`.
- **Resolution:** fixed in the re-org branch; E2E re-run to confirm.

## Follow-up observation (not fixed here)

The multiplayer smoke test (`test:multiplayer`, 13 steps, 0 failed) logs a
`pageB pageerror: Cannot read properties of undefined (reading 'x')` on one of
the two contexts while booting into a room — a **pre-existing** latent bug in the
multiplayer client's remote-player state path (reading a position field before
the remote entity exists). It does not fail the smoke test (handshakes complete,
cross-visibility and movement pass). Out of scope for the re-org; recorded here
so a future multiplayer task can pick it up.
