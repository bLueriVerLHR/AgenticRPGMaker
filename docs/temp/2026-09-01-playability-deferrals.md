# Deferred during the playability pass (task 22, 2026-09-01)

Deliberately **not** done now, and why:

1. **Window-resize re-zoom** — `sizeCanvasToDpr()` runs once at boot; resizing
   the window rescales the CSS canvas but does not recompute the camera zoom.
   Zoom is recomputed per frame from the backing-store size, so it only
   changes on reload. A `ResizeObserver` + backing-store reallocation is a
   self-contained follow-up if it bothers anyone.
2. **Real art assets** — the placeholder atlas is generated deterministically
   by `scripts/build-www.mjs` (data-first, D24). Semantic colors + affordance
   markers address readability; replacing the art pipeline (sprite sheets,
   animation frames) is a content-investment decision for the owner.
3. **Sprite outlines / direction indicators** — player and NPCs draw as flat
   tiles today. Outline polish is cheap but touches every draw path; deferred
   until the art direction is chosen.
4. **Non-integer zoom** — rejected: uneven pixel sizes under
   `image-rendering: pixelated` look worse than smaller-but-crisp tiles.
