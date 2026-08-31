# Task 05 — Update the core docs to the new direction

| Field | Value |
|---|---|
| **Goal** | `01-vision.md`, `06-architecture.md`, `07-mvp-plan.md`, `08-compatibility-checklist.md`, and `docs/README.md` reflect the re-orientation: editor removed/archived, C++ server optional, portable-first multi-backend (browser + JoiPlay), AI-authored data mainline, reserved WebGPU/WASM seams. |
| **Why** | WAL rule: docs must match what the repo actually is after this change (D20–D25). Stale docs are a bug. |
| **Approach** | 1. `01-vision.md` — add a re-orientation section (editor archived, auto-code mainline, portable-first); keep history. 2. `06-architecture.md` — update monorepo layout (§2: no editor package; server optional; note editor archived), dependency graph, seams table (§10: add platform-capability seam; note reserved WebGPU/WASM). 3. `07-mvp-plan.md` — mark P2 (editor) as archived/superseded; keep core/renderer/runtime/server-optional phases; adjust milestone table. 4. `08-compatibility-checklist.md` — make JoiPlay a first-class target row; add a "pending JoiPlay real-device verification (IndexedDB/WebGL)" item. 5. `docs/README.md` — update the docs map + ADR index. |
| **Files touched** | `docs/01-vision.md`, `docs/06-architecture.md`, `docs/07-mvp-plan.md`, `docs/08-compatibility-checklist.md`, `docs/README.md` |
| **Acceptance criteria** | Every doc is internally consistent and matches the new repo reality; `pnpm doc:lint` green (all links + status fields valid). |
| **Status** | todo |
