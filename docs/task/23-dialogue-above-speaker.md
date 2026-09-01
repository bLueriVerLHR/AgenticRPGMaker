# Task 23 — Dialogue boxes anchor above the speaker

| Field | Value |
|---|---|
| **Goal** | A dialogue box appears just above the head of whoever is speaking (the interacted event's live tile), flipping below when there is no room and clamping on-screen; with nothing to anchor to it keeps today's bottom-center placement. Choices attach to the same anchor. |
| **Why** | Owner feedback of 2026-09-02 ([discussion/2026-09-02-dialogue-above-speaker.md](../discussion/2026-09-02-dialogue-above-speaker.md)): "对话应该在说话的人头上，而不是统一在中间下方". The box was hard-coded `left:50%; bottom:10rem` while the bus `dialogue` event already carries `speakerId` — the scene discarded it. |
| **Approach** | **1. Queue speakers** (`map-scene.ts`): `dialogueQueue` holds `{ text, speakerId? }`; `currentDialogueText` keeps its shape; new getters `currentDialogueSpeakerId` and `dialogueAnchorMode` (`"speaker" \| "fallback"`). **2. Pure placement helper** (headless-testable, node vitest env): world anchor (speaker live transform tile top, task-19 resolution) → camera viewport (the same viewport `renderScene` computes) → backing px (× zoom) → CSS px (× `clientWidth/canvas.width`, + `getBoundingClientRect` offset); prefer above with an 8 CSS px gap, flip below the tile when the box would cross the screen top, clamp horizontally inside the canvas; off-viewport or unresolvable anchor → fallback. **3. DOM glue**: `renderDialogue()` and the per-frame render path re-position the dialogue and choice boxes (cached style writes); choice keeps today's relative order (above the dialogue box) on the same anchor; fallback CSS is byte-identical to today (`bottom:10rem` / `bottom:13rem` centered). **4. Tests**: unit tests for the placement helper (above / flip / horizontal clamp / off-screen fallback) and the speaker queue + getters; quest E2E gains a step asserting the visible box's bottom edge sits above the speaker's on-screen tile while talking to Elder Rowan. |
| **Files touched** | `packages/runtime/src/map-scene.ts`, `packages/runtime/tests/map-scene.test.ts` (or a new placement unit test file), `packages/runtime/e2e/quest-e2e.mjs`, docs (discussion, this doc, project log) |
| **Acceptance criteria** | Unit: placement helper covers above/flip/clamp/fallback; scene exposes speaker id + anchor mode; all existing dialogue tests pass unchanged (`currentDialogueText` compatible). Quest E2E green including the new above-the-speaker assertion; baseline E2E + multiplayer smoke green; full web unit suite green ×2; typecheck / lint / format:check / doc:lint / validate green; C++ server tests green; `pnpm build:www` rebuild ships the change. |
| **Status** | done |

## Status log

- 2026-09-02 — created (doing) from the owner's follow-up play-test feedback.
- 2026-09-02 — done. `dialogueQueue` keeps `{ text, speakerId }` (the
  interpreter already emitted the actor event id; the scene just used to drop
  it); the pure `computeDialoguePlacement()` converts the speaker's live
  world tile → camera viewport → backing px → page CSS px (canvas rect +
  CSS scale), prefers above the head with an 8 px gap, flips below the tile
  near the screen top, clamps inside the canvas, and reports
  unanchored/off-screen so the box falls back to the byte-identical
  bottom-center CSS. Choices stack just above the anchored dialogue box
  (today's relative order); a choice with no dialogue open anchors to the
  last speaker itself. Placement re-runs per rendered frame (speakers can
  move while talking) with cached style writes. Scene getters for tests/E2E:
  `currentDialogueSpeakerId`, `dialogueAnchorMode` (`"speaker" |
  "fallback"`), `speakerAnchorRect`. Quest E2E **79/79** (new
  above-the-speaker step); unit **314 green ×2** (runtime 125, core 121,
  renderer 68; +7 tests); baseline E2E 21/21; multiplayer smoke 13/13;
  ctest 41/41; typecheck / lint / format:check / doc-lint / validate green;
  `pnpm build:www` rebuilt.
