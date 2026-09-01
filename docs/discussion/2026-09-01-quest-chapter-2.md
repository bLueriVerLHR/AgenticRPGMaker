# Discussion — Next phase: quest chapter 2 (extend the vertical slice with content)

- **Date:** 2026-09-01
- **Participants:** owner, agent (engine)
- **Trigger:** owner said "继续下一个任务" (continue with the next task) after
  task 19 landed; three candidates were on the table.

## Assessment presented to the owner

Task 19 (interaction follows the body) is committed (`8bbd629`) and pushed.
The vertical slice "The Lost Shipment" (tasks 17–18) is the shipped `www`
default experience. Remaining candidates:

1. **Extend quest content** — add chapter 2 to the slice (new map(s), events,
   dialogue), using real content to exercise the current engine capabilities
   deeper. Tasks 17 and 18 both found real defects this way (the inert
   `loadMap` seam; interaction-vs-body divergence).
2. **Suspend/resume interpreter** — engine seam to pause/resume event
   sequences (cutscenes, mid-event saves). No content consumer yet; an
   early investment.
3. **JoiPlay compatibility checklist** — device-compatibility pass per
   `docs/08-compatibility-checklist.md`. Not verifiable from the dev
   environment; output is mostly documentation, validation needs a real device.

## Owner decision (via the structured question)

> 下一个任务从哪里开始？(任务 19 已完成并推送，三个候选方向待选)

**Chosen: "扩展任务内容"** — extend the quest content (chapter 2) and keep
using real content as the engine's acceptance axis.

Rejected-for-now alternatives (revisit later): suspend/resume interpreter
(revisit when content demands it, e.g. cutscenes or mid-event saves);
JoiPlay compatibility checklist (revisit when there is enough content to
make a real-device pass worthwhile).

## Consequences

1. Task 20 proceeds WAL-first: design chapter 2 so it exercises capabilities
   chapter 1 underused — comparison page conditions (`gte`/`lt` instead of
   only `eq`), negative `setVariable` (spending gold), a multi-page purchase
   loop, a second patrol NPC, and a gated (conditional) map transfer.
2. No core/schema/engine changes are expected; if content exposes a real
   engine gap, that becomes its own task (the task-18 → task-19 pattern).
3. The chapter-2 quest flow extends the shipped `www` default experience, so
   the quest E2E grows new steps after the chapter-1 reward and the
   chapter-1 "quest done" elder talk becomes the chapter-2 hook.
