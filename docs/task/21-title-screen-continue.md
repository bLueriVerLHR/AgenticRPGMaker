# Task 21 — Title screen: New Game / Continue

| Field | Value |
|---|---|
| **Goal** | The shipped player opens on a **start screen** with two options — **New Game** (fresh start) and **Continue** (resume the latest save, entering the map the save was made on). Owner request, 2026-09-01: "开始屏幕可以开始新的游戏或者继续已有的游戏，然后就可以开始了". |
| **Why** | Owner direction recorded in [discussion/2026-09-01-quest-chapter-2.md](../discussion/2026-09-01-quest-chapter-2.md) (custom answer on the task-20 plan question). Today the runtime *silently* auto-loads a same-map save on enter (`autoLoad` default true), `MapScene.load()` ignores saves made on a different map, and saves only happen via the manual S key — a real "continue" cannot exist. A visible start screen needs (a) UI, (b) cross-map continue, (c) automatic saving so Continue has something meaningful to restore. |
| **Approach** | **1. Overlay** (`title-screen.ts`, new): DOM start menu in the scene root, dialogue-box styling family, conservative-API only; `data-testid="title-screen"` / `-new-game` / `-continue`; Continue disabled until a storage read finds a save; the `TitleScreenHandle` is the testable seam — unit tests drive `choose()` headlessly (Node tests have no DOM, same philosophy as MapScene's headless mode), the browser E2E drives the real buttons. **2. Boot** (`BootOptions.titleScreen`, default false): with the flag, `createGame` suppresses auto-load, attaches `Game.title`, and boot returns the game *not started*; New Game → `game.start()` fresh; Continue → `start()` then `game.continue()`. Without the flag behavior is byte-for-byte today's. **3. Cross-map continue** (`game.continue()`): read the save; same map → `scene.load()`; other map → load it through the task-17 loader seam and swap the playable scene via the shared `buildNextScene` helper (extracted from the task-14 transfer path, auto-load off) with the saved position/direction, then `load()` applies the save there; no save/loader failure → false. **4. Autosave**: every successful transfer scene swap saves automatically (toast already exists); S/L keys stay. The www entry enables the title screen only for single-player sessions (no `?server=`) so the multiplayer smoke boots straight into the game. |
| **Files touched** | `packages/runtime/src/title-screen.ts` (new), `game.ts`, `boot.ts`, `index.ts`; `scripts/www-entry.ts`; `packages/runtime/tests/title-screen.test.ts` (new); `packages/runtime/e2e/quest-e2e.mjs` (title prologue + reload/continue round-trip; the baseline E2E uses the dev demo harness, not the www entry, so it is unaffected); this doc; `docs/05-project-log.md` |
| **Acceptance criteria** | Unit tests: default-off contract; title waits unstarted; Continue refused with no save; New Game ignores an existing save; Continue restores same-map and cross-map saves; dispose is inert; transfer autosaves the new map/position. Quest E2E: boots through the title (Continue disabled on a fresh profile), and mid-quest reload → Continue restores the cave session (cross-map), all prior steps still green. Multiplayer smoke unchanged. Full web unit suite green twice; lint / format:check / doc:lint / validate green; docs updated in the same change. |
| **Status** | done |

## Details

### Why not a new Scene type

The title screen is a *pre-game* menu: the loop is not running and no scene is
entered. A DOM overlay driven by a plain handle (like the dialogue/choice UI)
keeps the scene graph untouched and makes the flow testable without a browser.

### Continue availability and the fallback path

`TitleScreenHandle.refresh()` answers "is there a restorable save?" by reading
storage (disabled button until true). `choose("continue")` re-checks before
beginning; if the save disappears between check and read, the handler falls
back to a fresh session instead of leaving a dead screen. A failed
`game.continue()` (corrupt/incompatible save) resolves false and the game
continues fresh — never stuck.

### Multiplayer

`?server=` sessions skip the title screen entirely (D16 players-only scope;
the relay has no session-persistence story yet). Revisit if multiplayer saves
become a product requirement.
