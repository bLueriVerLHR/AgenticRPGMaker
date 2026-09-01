# Task 22 — Playability pass: zoom + camera follow, smooth movement, world readability

| Field | Value |
|---|---|
| **Goal** | Fix the owner's play-test blockers: the world renders at a readable size with the camera following the player, held-key walking is smooth, blocked tiles / interactables / transfer tiles are visually distinct, and the title-screen buttons look uniform. |
| **Why** | Owner feedback of 2026-09-01, recorded verbatim with root-cause analysis in [discussion/2026-09-01-playability-feedback.md](../discussion/2026-09-01-playability-feedback.md). Six concrete complaints, four code-level causes (1:1 camera, per-step repeat gate, low-contrast placeholder art, no affordances). |
| **Approach** | **1. Zoom + follow** (`map-scene.ts`): `computeCameraZoom()` = clamp(floor(backingHeight / (tileSize × 14)), 2, 16); `computeCameraViewport` sizes the viewport as backing/zoom world px and keeps centering on the live player position with the existing map clamp — zoom + follow together. **2. Movement** (`map-scene.ts`): `REPEAT_DELAY_SECONDS` gates only the first repeat of a held direction (tap/hold disambiguation); while still held, steps chain at `stepDuration` (0.15 s) with no extra 0.25 s per step. **3. Readability**: semantic placeholder atlas in `build-www.mjs` (index convention: 1 grass two-tone, 2 tan path, 3 water + waves, 4 stone; brighter varied palette overall); collider overlay becomes a readable semi-transparent dark fill + 1 px edge border; a bobbing "!" renders above the faced interactable (same task-19 live-body rule, suppressed while dialogue/choice is open), exposed as `scene.interactionHintEventId`; tiles whose events contain a `transfer` command get a pulsing bracket frame, exposed as `scene.transferEventIds`. **4. Title screen** (`title-screen.ts`): both buttons share one fixed-width style; disabled Continue reads "Continue (no save)". |
| **Files touched** | `packages/runtime/src/map-scene.ts`, `packages/runtime/src/title-screen.ts`, `packages/runtime/tests/map-scene.test.ts`, `packages/runtime/e2e/quest-e2e.mjs` (hint/marker assertions via `__game.scene`), `scripts/build-www.mjs` (atlas painter), docs (discussion, this doc, project log, temp deferrals) |
| **Acceptance criteria** | Unit tests: zoom shrinks the viewport by the zoom factor and keeps the player centered/clamped (StubRenderer records `setCamera` calls); held direction chains steps without the per-step 0.25 s gap (steps complete at ~`stepDuration` cadence); hint getter reports the faced interactable and clears while talking; transfer getter lists gate events. Quest E2E stays 75/75 with new hint/marker read steps; baseline E2E and multiplayer smoke green; full web unit suite green twice; lint / format:check / doc:lint / validate green; `pnpm build:www` rebuild ships the new atlas. |
| **Status** | done |

## Status log

- 2026-09-01 — created (doing) from the owner's play-test feedback.
- 2026-09-01 — done. Camera zoom (integer, ~14 tiles vertical) + follow via
  the existing center-on-player clamp; hold-to-walk chains steps at
  `stepDuration` after the first repeat (and held direction changes step
  immediately — previously they stalled until a new keypress); semantic
  placeholder atlas (grass/path/water/stone + tile-boundary shade); blocked
  tiles render translucent dark with solid edge borders; bobbing "!" above
  the faced interactable (suppressed while talking) and pulsing corner-bracket
  markers on transfer tiles, both observable via `scene.interactionHintEventId`
  / `scene.transferTileEventIds`; uniform fixed-width title buttons with a
  self-explanatory "Continue (no save)" disabled label. Quest E2E **78/78**
  (hint/marker read steps added); unit 308 green ×2; baseline E2E 21/21,
  multiplayer smoke 13/13, ctest 41/41; validate/lint/format/doc-lint green.

## Tunables (owner-adjustable after a play-test)

- Zoom target: ~14 tiles visible vertically (formula above) — change one number.
- `stepDuration` 0.15 s/tile and first-repeat delay 0.25 s — constants in
  `map-scene.ts`.
- Hint glyph "!" and marker style — localized in `map-scene.ts` render code.
