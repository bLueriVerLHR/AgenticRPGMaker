# Discussion — Playability feedback after the first real play-through

- **Date:** 2026-09-01
- **Participants:** owner, agent (engine)
- **Trigger:** owner ran the game (shipped `www/` build) and reported
  usability problems.

## Owner feedback (verbatim)

> 东西看起来都太小了，而且 demo 里的美术不是很好，开始屏幕上按钮不统一，
> 进去后我都不知道哪里是门，哪些可以交互，哪里可以走。而且你如果放大了，
> 也得做好镜头跟随玩家，不要玩家都出了镜头了还没跟上。最后，玩家移动是不
> 是卡顿太严重了？流畅一点，不要阻碍玩家玩游戏。

Points: (1) everything renders too small; (2) placeholder art is poor;
(3) title-screen buttons look inconsistent; (4) cannot tell doors /
interactables / walkable tiles apart; (5) if we zoom in, the camera must
follow the player; (6) movement feels janky — smooth it out.

## Agent diagnosis (code-level root causes)

1. **Too small:** the camera renders 1:1 (`setCamera(viewport, 1)` with the
   full backing-store size as the viewport), so a 16 px tile is ~8 CSS px on
   a HiDPI display. The renderer already supports integer zoom
   (`setCamera(viewport, zoom)` scales the world transform).
2. **Janky movement:** `REPEAT_DELAY_SECONDS` (0.25 s) gates **every**
   repeated step while a direction is held, not just the first — held walking
   runs at ~2.5 tiles/s with a visible pause between steps.
3. **Cannot read the world:** the placeholder atlas paints every tile as a
   dark flat fill with a center dot (no semantic colors), and the collider
   overlay (`#1a2a1f`) has almost no contrast against it. Nothing marks
   interactables or transfer tiles.
4. **Camera follow:** `computeCameraViewport` already centers on the live
   player position and clamps to the map — at 1:1 the whole map fits the
   screen, so follow never engages. Zooming makes the existing follow + clamp
   logic meaningful.

## Decisions

- **Zoom:** integer camera zoom, computed from the canvas backing height
  (~14 tiles visible vertically, clamped to [2, 16]); viewport shrinks by the
  zoom factor; the existing center-on-player + clamp becomes the camera
  follow. Small maps still show whole and centered on large windows.
- **Movement:** the repeat delay gates only the FIRST repeat of a held
  direction; after that, held walking chains steps back-to-back at
  `stepDuration` cadence (0.15 s/tile ≈ 6.7 tiles/s).
- **Readability:** semantic placeholder atlas (grass/path/water/stone by tile
  index convention), higher-contrast blocked-tile overlay with edge borders,
  a bobbing "!" hint above the faced interactable (suppressed while talking),
  and a pulsing bracket marker on transfer tiles. Hint and markers are
  observable via scene getters for tests/E2E.
- **Title screen:** identical fixed-width buttons; a disabled Continue reads
  "Continue (no save)" so the dimmed state is self-explanatory.
- **Deferred** (see [temp](../temp/2026-09-01-playability-deferrals.md)):
  window-resize re-zoom, real art assets, sprite outlines.

Rejected-for-now: non-integer zoom (uneven pixels with `image-rendering:
pixelated`), free camera (grid game needs no scrolling freedom), touching
movement stepDuration (0.15 s/tile is brisk once the repeat bug is gone).
