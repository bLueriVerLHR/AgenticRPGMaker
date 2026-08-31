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

## Follow-up observation (fixed 2026-08-31, task 06)

The multiplayer smoke test (`test:multiplayer`, 13 steps, 0 failed) logged a
`pageB pageerror: Cannot read properties of undefined (reading 'x')` on one of
the two contexts while booting into a room — caused by the **server's `welcome`
including a state-less member** (a player who joined but has not yet sent its
first rate-limited `player_state`; `server/src/server.cpp` only set
`entry["state"]` when `lastState` was present). **Fixed** in task 06:
- server: welcome always carries a default `state` (`{x:0,y:0,direction:"down"}`)
  for members without `lastState` (protocol-consistent);
- client: `handleWelcome` / `handleRemoteState` defensively tolerate missing
  state (default position / warn + ignore) instead of throwing;
- regression tests on both sides (runtime Vitest + C++ loopback integration).
Verified: multiplayer smoke logs **no pageerror**; full QA gate green.
