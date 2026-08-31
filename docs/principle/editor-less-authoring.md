# Principle — Editor-less, Data-First Authoring

> Source: `docs/discussion/2026-08-31-reorg.md` (D20, D24). Applies to every
> future task that touches game data or tooling.

## The law

**Game content is authored as data, not via a visual editor, and the runtime
interpreter is the single authority on what that data means.** Today the primary
author is an AI agent; a human hand-writer is a second-class (but supported)
author. A visual editor may return **later, only after a real game exists** to
justify it — and it must sit on the same `core` data model (ADR-001/ADR-003),
never a parallel one.

## Why

- The user's stated reality: development is primarily **auto-generated code**.
  An editor is UI that an AI author does not need to look at.
- Survey evidence (`rpg-maker-agent`, `Shinsekai`): with a strict, stable JSON
  schema + a good interpreter, an LLM can produce a playable game end to end.
- Removing the editor shrinks the movable surface of the repo (no React, no
  Vite editor build) and re-focuses the runtime on portability.

## Rules

1. **JSON data is the interchange.** Maps, events, dialogue, tilesets, projects
   are versioned JSON documents validated against `core` schemas (ADR-003). No
   editor-only serialization format may exist.
2. **`core` owns every "what is legal" rule.** Editing operations that used to
   live in the editor (`map-ops`, command stack constraints) are **validation
   rules in `core`** — so an AI author learns legality from the same source the
   runtime enforces. If a constraint is not in `core`, it is not a real
   constraint.
3. **Validate before run.** Every data document must pass `core` validation
   before the runtime will boot with it. The **CLI validation entry point**
   (`pnpm validate`) is the agent-facing gate (D24).
4. **AI/hand friendly format.** Schemas favor readable, minimal, stable JSON
   (dense but explicit); tolerate reasonable defaults; avoid ambiguous or
   redundant fields that trip up generators.
5. **Strictness lives in validation, not in the wire format.** Keep documents
   permissive at the type level where sensible, and encode invariants in
   `core`'s validators — so errors are precise and actionable for the generator.
6. **No editor-shaped dependencies in the runtime.** Nothing in
   `core`/`renderer`/`runtime` may depend on React, Vite, or editor code — the
   runtime stays lean vanilla TS for portability (D13 principle kept).

## Reversible

This is deliberately reversible (D20): the editor is archived via git tag and
can be restored onto the same `core` model when a game justifies it. The data
model is the contract that keeps that path cheap.
