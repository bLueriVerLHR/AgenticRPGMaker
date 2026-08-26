/**
 * CgScene tests (ADR-010 §3, S3b).
 *
 * Drives a CgScript through the scene with a recording stub renderer and an
 * injected Input: instant steps chain, fades animate the overlay over time
 * and auto-advance, text lines wait for confirm, confirm skips fades/still
 * waits, a still waits for the renderer's texture readiness, and onEnd fires
 * exactly once.
 */
import { describe, expect, it, vi } from "vitest";

import type { AudioManager } from "../src/audio.js";
import type { CgScript } from "../src/cg.js";
import { CgScene, CG_TEXTURE_ID } from "../src/cg-scene.js";
import { Input } from "../src/input.js";
import { StubRenderer, stubCanvas, type RenderCall } from "./helpers.js";

function makeAudio() {
  return {
    startBgm: vi.fn(),
    playSfx: vi.fn(),
    unlock: vi.fn(),
  } as unknown as AudioManager;
}

function makeScene(script: CgScript, renderer = new StubRenderer()) {
  const audio = makeAudio();
  const input = new Input({ keyboard: false, virtualControls: false });
  const onEnd = vi.fn();
  const scene = new CgScene({
    script,
    renderer,
    canvas: stubCanvas(),
    audio,
    input,
    onEnd,
  });
  return { scene, renderer, audio, input, onEnd };
}

function drawRectCalls(calls: readonly RenderCall[]): unknown[][] {
  return calls.filter((c) => c.method === "drawRect").map((c) => (c as { args: unknown[] }).args);
}

describe("CgScene", () => {
  it("runs instant steps at enter and ends when nothing waits", () => {
    const { scene, audio, onEnd } = makeScene([
      { kind: "bgm", ref: "village" },
      { kind: "sfx", ref: "coin" },
      { kind: "letterbox", on: true },
      { kind: "end" },
    ]);
    scene.enter();
    expect(audio.startBgm).toHaveBeenCalledWith("village");
    expect(audio.playSfx).toHaveBeenCalledWith("coin");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(scene.isFinished).toBe(true);
    scene.exit();
  });

  it("animates the fade overlay over time and auto-advances (fadeIn → end)", () => {
    const { scene, renderer, onEnd } = makeScene([
      { kind: "fadeIn", durationMs: 100 },
      { kind: "end" },
    ]);
    scene.enter(); // overlay 1 → target 0 over 100ms
    expect(onEnd).not.toHaveBeenCalled();
    scene.update(0.05);
    scene.render();
    const rgba = drawRectCalls(renderer.calls).filter((args) =>
      String(args[4]).startsWith("rgba("),
    );
    expect(rgba.length).toBeGreaterThan(0); // semi-transparent overlay drawn
    scene.update(0.05);
    expect(onEnd).toHaveBeenCalledTimes(1);
    scene.exit();
  });

  it("text steps wait for confirm, line by line", () => {
    const { scene, input, onEnd } = makeScene([
      { kind: "text", text: "First line" },
      { kind: "text", text: "Second line" },
      { kind: "end" },
    ]);
    scene.enter();
    expect(scene.currentText).toBe("First line");
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.currentText).toBe("Second line");
    input.queueConfirm();
    scene.update(0.016);
    expect(onEnd).toHaveBeenCalledTimes(1);
    scene.exit();
  });

  it("confirm skips a running fade to the next step", () => {
    const { scene, input } = makeScene([
      { kind: "fadeIn", durationMs: 2000 },
      { kind: "text", text: "skipped here" },
      { kind: "end" },
    ]);
    scene.enter();
    input.queueConfirm();
    scene.update(0.016);
    expect(scene.currentText).toBe("skipped here");
    scene.exit();
  });

  it("waits for the still to load (texture readiness) before advancing", () => {
    const renderer = new StubRenderer();
    let ready = false;
    (renderer as { textureReady: (id: string) => boolean }).textureReady = () => ready;
    const { scene, onEnd } = makeScene(
      [{ kind: "cg", image: "img/cg/opening.png", mode: "cover" }, { kind: "end" }],
      renderer,
    );
    scene.enter();
    expect(onEnd).not.toHaveBeenCalled(); // still loading
    ready = true;
    scene.update(0.016);
    expect(onEnd).toHaveBeenCalledTimes(1);
    scene.render();
    const drawTexture = renderer.calls.find((c) => c.method === "drawTexture");
    expect(drawTexture).toBeDefined();
    expect((drawTexture as { args: unknown[] }).args[0]).toBe(CG_TEXTURE_ID);
    scene.exit();
  });

  it("letterbox draws top/bottom bars", () => {
    const { scene, renderer } = makeScene([{ kind: "letterbox", on: true }, { kind: "end" }]);
    scene.enter();
    scene.render();
    const bars = drawRectCalls(renderer.calls).filter(
      (args) => args[4] === "#000000" && args[2] === 320,
    );
    expect(bars).toHaveLength(2); // top + bottom; canvas 320x240 → bar height 28
    expect(bars[0]?.[1]).toBe(0);
    expect(bars[1]?.[1]).toBe(240 - 28);
    scene.exit();
  });
});
