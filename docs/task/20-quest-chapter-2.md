# Task 20 — Quest chapter 2: "The Ferryman's Ledger"

| Field | Value |
|---|---|
| **Goal** | Extend the shipped vertical slice ("The Lost Shipment") with a playable chapter 2, as pure data: one new map (`quest-river`, "Riverbank Landing"), new village events, and an extended elder arc — exercising the engine capabilities chapter 1 underused, with **no core/schema/engine changes**. The quest E2E grows the chapter-2 steps after the chapter-1 reward and stays fully green against a rebuilt `www/`. |
| **Why** | Owner decision: [discussion/2026-09-01-quest-chapter-2.md](../discussion/2026-09-01-quest-chapter-2.md) — extend quest content as the next phase (D24: playable samples are the acceptance axis; real content found real defects in tasks 17–19). Chapter 1 exercised `showText`, `showChoices` + `eq` pages, `setSwitch`, positive `setVariable add`, transfers, one patrol NPC. Still unexercised: comparison ops beyond `eq` (`gte`, `lt`), negative `setVariable` (spending), a multi-page trade loop, a gated transfer, a second patrol NPC. Depends on task 21 (the E2E boots through New Game before any walking). |
| **Approach** | All content stays in the shipped command set (`showText`, `setVariable` `set`/`add`, `setSwitch`, `transfer`, `showChoices`) and single-clause first-match page conditions. **Story:** (1) elder hook — after the chapter-1 reward, the next talk starts chapter 2 (collect Old Pol's 30-coin ferry debt; the east road re-opened) → `sw_ch2_started`; (2) gated east-road transfer — "flood wall seals the road" text page before `sw_ch2_started`, transfer page after; (3) Old Pol — `showChoices` → `ferry_choice` ("Demand the debt" / "Offer to work it off"), payment settles on the next talk, one-shot-guarded by `sw_debt_settled`, cancel re-offers (`ferry_choice lt 0`); (4) Herbalist Mira (new NPC) — 10-coin remedy, page ladder `sw_remedy` → purchase (`remedy_buy eq 0`, `gold −10`) → offer (`gold gte 10`) → too-poor, exercising `gte`, negative `add`, and the choice → re-interact pattern; (5) elder close — thanks branches on `ferry_choice` (`eq 0`/`eq 1`), sets `sw_ch2_done` (chapter-3 hook in the worked branch); (6) flavor — signpost and Guard Bren gain `sw_ch2_started` pages, a patrolling Dock Worker re-exercises task-19 patrol+talk. **Elder page ladder** (first-match): `[ferry_choice eq 0]`, `[ferry_choice eq 1]`, `[sw_ch2_started]`, `[sw_quest_done]` (ch-2 hook), `[sw_crate_found]` (ch-1 reward), `[null]` (intro). |
| **Files touched** | `samples/maps/quest-river.map.json` (new); `samples/maps/quest-village.map.json`; `samples/projects/lost-shipment.project.json`; `packages/core/tests/quest-slice.test.ts`; `packages/runtime/e2e/quest-e2e.mjs`; this doc; `docs/05-project-log.md`; `samples/README.md` (if it lists maps) |
| **Acceptance criteria** | `pnpm validate` green over `samples/`; core suite green incl. the extended quest-slice test (map list, closed transfer graph, elder ladder order, Pol one-shot guard, Mira ladder order); full web unit suite green twice; `pnpm build:www` + quest E2E green with the chapter-2 steps; baseline E2E and multiplayer smoke re-run green; lint / format:check / doc:lint green; docs updated in the same change; no changes under `packages/core/src` (any engine gap becomes its own task). |
| **Status** | done |

## Status log

- 2026-09-01 — created (todo), WAL-first per
  [discussion/2026-09-01-quest-chapter-2.md](../discussion/2026-09-01-quest-chapter-2.md).
- 2026-09-01 — done. Chapter 2 shipped as data: `map_quest_river` (Old Pol
  debt choice, patrolling Dock Worker, gated west road), village elder
  6-page first-match ladder, Herbalist Mira's 4-page purchase ladder, gated
  east road. Quest E2E extended to **75/75** (gated sealed-wall text, Pol
  one-shot payment, dock-worker patrol talk, Mira buy loop, worked-branch
  close); quest-slice data test extended to the new ladders (core 121
  green); unit 301 green ×2; validate/lint/format/doc-lint green; baseline
  E2E 21/21 and multiplayer smoke 13/13 re-run green; ctest 41/41.
  Content-design lesson recorded in the E2E comments: NPCs never stand in
  the only east-west lane (Mira first shipped at (9,4), blocking the road —
  moved to (9,6)).

## Details

### Data

- **`quest-river.map.json` (new, `map_quest_river`, "Riverbank Landing", 12×9):**
  water + dock terrain on the existing placeholder tileset; events: `evt_pol`
  (Old Pol, 4-page ladder: settled-guard → press-pay → work-pay →
  `ferry_choice lt 0` choice-offer), `evt_dock_hand` (patrol waypoints,
  speed 1, idle 1.0), `evt_river_west` (west transfer back to the village),
  `evt_dock_barrel` (flavor). Declares `sw_debt_settled`, `sw_ledger`
  (declarations are a union across maps, per the task-18 test).
- **`quest-village.map.json`:** elder page ladder as in the table; new events
  `evt_mira`, `evt_village_east`; signpost + Guard Bren gain a page. Declares
  the chapter-2 state: `ferry_choice`/`remedy_buy` (init `-1`),
  `sw_ch2_started`, `sw_ch2_done`, `sw_remedy`.
- **`lost-shipment.project.json`:** add `map_quest_river` to `assets.maps`.

### State-machine walkthrough (single-clause conditions suffice)

| Session state | Elder first-match page | Pol first-match page |
|---|---|---|
| fresh | intro (`null`) | — |
| started, unsettled | in-progress (`sw_ch2_started`) | choice offer (`ferry_choice lt 0`; re-offers on cancel) |
| settled, pressed (`ferry_choice` 0) | press-thanks (`eq 0`) | settled guard |
| settled, worked (`ferry_choice` 1) | work-thanks (`eq 1`) | settled guard |

Reaching Pol requires `sw_ch2_started` (the east gate's transfer page is
gated on it), so `ferry_choice ≥ 0` implies the elder hook fired; a canceled
choice (`-1`) keeps the in-progress page matched until the player re-talks
Pol.

### Tests

- **`quest-slice.test.ts`:** map list + project assets gain the river map;
  the elder page-order assertions move to the new ladder; new invariants: the
  transfer graph stays closed (east gate ↔ west road), Pol's payment pages
  are one-shot-guarded (`sw_debt_settled` page precedes both reward pages),
  Mira's ladder order (`sw_remedy` → purchase → `gte 10` offer → poor).
- **`quest-e2e.mjs`:** boot through the task-21 title screen (New Game); after
  the chapter-1 reward steps, walk chapter 2: east gate sealed text → elder
  hook → east transfer → Pol choice ("Offer to work it off") → Pol re-talk
  (ledger + 20 coin) → Dock Worker talk (bounded patrol retry, task-19
  pattern) → west transfer → Mira offer → buy → Mira re-talk (owned) → elder
  worked-branch thanks → elder re-talk repeats it (first-match stability).

### Docs

- This task doc to `done`; project-log entry. No ADR/open-questions change
  (no engine or schema decision). Sample README updated if it lists maps.
