# Principle — Portable-First, Multi-Backend Engine

> Source: `docs/discussion/2026-08-31-reorg.md` (D21, D23). Applies to the
> renderer, storage, input, network, and any future platform capability.

## The law

**The engine runs, unmodified, on every target environment in scope — browser
and JoiPlay today, more later — before any performance work is invested.**
Backends are **concrete configurations of the same runtime**, selected by a thin
platform-capability layer, not separate programs. Higher-performance paths
(WebGPU, WASM) are **reserved seams**, designed now and implemented only after
the portable engine demonstrably runs everywhere.

## Why

- JoiPlay runs RPG Maker MV/MZ from their **`www` HTML5 folder** (verified from
  JoiPlay's own FAQ). Our portable `www` package is therefore a first-class
  JoiPlay target; browser and JoiPlay differ only in:
  - input (JoiPad on-screen D-pad/buttons vs keyboard),
  - renderer capability (WebGL may be weak/missing → Canvas2D fallback),
  - storage limits (IndexedDB quota/availability on the WebView),
  - file/asset access constraints.
- The user's stated route: **first make it run on every component, then research
  vgpu / wasm for performance** (Q4/Q6).

## Rules

1. **One runtime, many configurations.** Do not fork the engine per platform.
   A `PlatformCapabilities` probe (renderer support, input devices, storage,
   audio) configures the existing seams: Renderer interface (ADR-002),
   Storage adapter, Transport adapter, Input adapter.
2. **Portability is a hard gate.** A feature may not depend on an API that the
   conservative-JoiPlay environment lacks unless it degrades gracefully through
   the capability layer (docs/08 compatibility checklist is the enforcement).
3. **Performance seams are interfaces now, work later.** Design the Renderer
   interface to admit a future WebGPU backend and keep the core interpreter
   separable for a future WASM build — but **do not implement either now**
   (D23). "Reserved" means the seam exists, not that the work is scheduled.
4. **Browser is the reference; JoiPlay is a checked configuration.** Verify
   against the browser first; run the compatibility checklist (docs/08) and the
   conservative-API rules for the JoiPlay path.
5. **Optional components stay optional.** The C++ server (ADR-005) is an
   optional relay/hosting component (D22); the portable single-player engine
   must never require it.

## Reversible / future

When a real game demands it, revisit in this order: (1) prove portability on all
targets, (2) add WebGPU renderer backend behind the Renderer interface, (3)
evaluate WASM core for the hot paths. Each step must be behind its seam so it
can be rolled back without touching the portable path.
