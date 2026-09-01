# Discussion — Next phase: finish the interaction loop, then a playable vertical slice

- **Date:** 2026-08-31
- **Participants:** owner, agent (engine)
- **Trigger:** owner asked "考察该项目下一阶段该做什么" (assess what the next
  phase should be).

## Assessment presented to the owner

- MVP P0–P6 shipped and tagged `mvp-0.1.0`; re-oriented 2026-08-31 to
  editor-less, data-first (D24), portable-first (D21/D23).
- Optimization batches (tasks 06–15) landed: multiplayer fix, platform probe,
  command registry, NPC behaviors wired, three perf caches, map transfer,
  variable conditions.
- Task 16 (`showChoices`) was mid-flight: core code written but uncommitted,
  runtime UI/tests/sample/docs missing.

**Recommendation given:** finish task 16, then make the next phase a **playable
vertical slice** (a small multi-map quest) rather than more engine-only work —
because D20 restores the editor only "when a real game justifies it", D24's
acceptance axis is playable samples, and the engine capabilities (dialogue,
choices, variables, switches, transfer, behaviors) had never been exercised
together by real content.

## Owner decision (via the structured question)

> 下一步要我从哪里开始动手？

**Chosen: "收尾后启动垂直切片"** — finish task 16, then start the vertical
slice (3–5 map playable mini-quest as the next-phase acceptance baseline).

Rejected-for-now alternatives (recorded in the assessment, revisit later):
combat/inventory system, LLM NPC strategy via the C++ server proxy,
host-authoritative world-state sync, editor restore, WebGPU/WASM investment
(D23 keeps them seams-only).

## Consequences

1. Task 16 was completed, QA-gated, committed (`6fa2832`), and tagged
   `engine-0.2.0`.
2. The vertical slice proceeds WAL-first: task 17 (boot map-loader seam — a
   gap the slice exposed: `CreateGameOptions.loadMap` was never wired into
   `boot()`/the www entry, so transfers were inert in the deployed build) and
   task 18 (the quest content itself).
3. The quest project becomes the shipped `www` default experience; the
   town-square demo maps stay bundled (reachable via the `map` URL override).
