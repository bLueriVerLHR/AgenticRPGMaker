# Discussion — Dialogue should sit above the speaker, not bottom-center

- **Date:** 2026-09-02
- **Participants:** owner, agent (engine)
- **Trigger:** owner's follow-up play-test feedback on the shipped `www/`
  build after the task-22 playability pass.

## Owner feedback (verbatim)

> 1. 对话应该在说话的人头上，而不是统一在中间下方。
> 继续优化吧

The dialogue box should appear above the head of whoever is speaking, instead
of always sitting at the bottom-center of the screen. Keep optimizing.

## Agent diagnosis (code-level root causes)

- The dialogue box (`map-scene.ts` `createUi`) is `position:fixed` hard-coded
  to `left:50%; bottom:10rem` — pure screen-space placement with no notion of
  the world.
- The data needed for world anchoring already exists and is thrown away: the
  core `Say` command emits `dialogue` with `speakerId` (the actor event id,
  `packages/core/src/interpreter/commands.ts`), and behavior `say` passes the
  entity id — but the scene's bus handler queues only `event.text`.
- Task 22 shipped the camera follow, so "above the speaker's head" is a
  well-defined screen position: speaker world tile → camera viewport →
  backing px → CSS px (the canvas is CSS-scaled, `max-width:100vw`, so the
  backing→CSS scale and the canvas rect offset must be applied).

## Decisions

- **Anchor rule:** dialogue is placed just above the speaker's live body tile
  (task-19 live-transform resolution, authored tile as fallback); if there is
  no room above (speaker near the screen top) the box flips below the tile;
  horizontally it clamps inside the canvas. This is the same "world-anchored
  affordance" idea as the task-22 "!" hint, applied to the dialogue box.
- **Fallback stays bottom-center** (today's exact CSS) when there is nothing
  to anchor to: headless/no DOM, no `speakerId`, unknown entity, or the
  speaker's anchor tile is outside the camera viewport.
- **Choices follow the dialogue:** the choice box attaches to the same
  speaker anchor, keeping today's relative order (choice above the dialogue
  box); a choice with no dialogue open takes the anchored spot itself.
- **Reposition every frame:** NPC behaviors can move a speaker while a
  dialogue is open, and the box size changes per line — placement re-runs in
  the render path with cached style writes.
- **Observable for tests:** the pure placement math lives in a headless
  helper (unit tests run in a node environment, no DOM), and the scene
  exposes the current speaker id and whether the box is anchored or in
  fallback, so the quest E2E can assert "box above the speaker" for real.

Rejected-for-now: speech-bubble style tails pointing at the speaker (needs
real art pass; the flat box position already answers the "who is talking"
question), per-character typewriter effects (not requested), dialogue history
log (not requested).
