/**
 * TitleScene tests (ADR-010 §3, S3b).
 *
 * The any-key listener dismisses the title exactly once, unlocks the audio
 * manager, and calls `onStart`; exit detaches the listener. Tested against a
 * fake EventTarget so no DOM is required.
 */
import { describe, expect, it, vi } from "vitest";

import type { Renderer } from "@agenticrpg/renderer";
import type { AudioManager } from "../src/audio.js";
import { TitleScene } from "../src/title-scene.js";
import { stubCanvas } from "./helpers.js";

interface FakeTarget extends EventTarget {
  listeners: Map<string, (event: Event) => void>;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, (event: Event) => void>();
  return {
    listeners,
    addEventListener: vi.fn((type: string, fn: (event: Event) => void) => {
      listeners.set(type, fn);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
    dispatchEvent: vi.fn(() => true),
  } as unknown as FakeTarget;
}

/** A minimal recording renderer (the full call-recording stub needs Input). */
class RecordingRenderer {
  frames = 0;
  beginFrame(): void {
    this.frames += 1;
  }
  endFrame(): void {}
  setCamera(): void {}
  drawRect(): void {}
  drawText(): void {}
  drawSprite(): void {}
  drawTile(): void {}
  registerTexture(): void {}
  drawTexture(): void {}
  textureReady(): boolean {
    return false;
  }
  pushTransform(): void {}
  popTransform(): void {}
  getBackend(): string {
    return "stub";
  }
}

function makeTitle() {
  const audio = { unlock: vi.fn() } as unknown as AudioManager;
  const onStart = vi.fn();
  const target = fakeTarget();
  const renderer = new RecordingRenderer();
  const scene = new TitleScene({
    renderer: renderer as unknown as Renderer,
    canvas: stubCanvas(),
    audio,
    onStart,
    target,
  });
  return { scene, audio, onStart, target, renderer };
}

describe("TitleScene", () => {
  it("any key unlocks audio and starts exactly once", () => {
    const { scene, audio, onStart, target } = makeTitle();
    scene.enter();
    expect(onStart).not.toHaveBeenCalled();

    const keydown = target.listeners.get("keydown");
    expect(keydown).toBeDefined();
    keydown?.(new Event("keydown"));
    keydown?.(new Event("keydown")); // second press → no-op

    expect(audio.unlock).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(scene.isStarted).toBe(true);
    scene.exit();
  });

  it("detaches the listener on exit", () => {
    const { scene, target } = makeTitle();
    scene.enter();
    expect(target.listeners.has("keydown")).toBe(true);
    scene.exit();
    expect(target.listeners.has("keydown")).toBe(false);
  });

  it("renders a frame through the renderer", () => {
    const { scene, renderer } = makeTitle();
    scene.enter();
    scene.render();
    expect(renderer.frames).toBeGreaterThan(0);
    scene.exit();
  });

  it("works without any listener target (headless no-window)", () => {
    const audio = { unlock: vi.fn() } as unknown as AudioManager;
    const onStart = vi.fn();
    const renderer = new RecordingRenderer();
    const scene = new TitleScene({
      renderer: renderer as unknown as Renderer,
      canvas: stubCanvas(),
      audio,
      onStart,
      target: null,
    });
    scene.enter();
    expect(onStart).not.toHaveBeenCalled();
    expect(scene.isStarted).toBe(false);
    scene.exit();
  });
});
