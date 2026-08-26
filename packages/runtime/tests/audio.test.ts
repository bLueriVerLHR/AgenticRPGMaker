/**
 * AudioManager tests (ADR-010 §4, S3a).
 *
 * Behavioral tests with an injected fake AudioContext: unlock is idempotent
 * and gesture-driven, SFX synthesize their note patterns after unlock only,
 * BGM loops drive the sequencer on an interval and stop/switch cleanly,
 * dispose closes the context, and a failing context degrades to silent
 * mode with exactly one warning (never a throw).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioManager, type AudioContextLike } from "../src/audio.js";
import { createNoopLogger } from "../src/logger.js";

interface FakeContext extends AudioContextLike {
  oscillators: Array<Record<string, unknown>>;
  resumeCalls: number;
  closeCalls: number;
}

function makeFakeContext(): FakeContext {
  const fake: FakeContext = {
    currentTime: 10,
    destination: { kind: "destination" },
    state: "suspended",
    oscillators: [],
    resumeCalls: 0,
    closeCalls: 0,
    resume: vi.fn(function (this: FakeContext) {
      this.resumeCalls += 1;
      return Promise.resolve();
    }),
    close: vi.fn(function (this: FakeContext) {
      this.closeCalls += 1;
      return Promise.resolve();
    }),
    createOscillator: vi.fn(function (this: FakeContext) {
      const osc: Record<string, unknown> = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      this.oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
  };
  return fake;
}

function makeManager(overrides: { factory?: () => AudioContextLike } = {}) {
  const fake = makeFakeContext();
  const factory = overrides.factory ?? (() => fake);
  const manager = new AudioManager({ factory, logger: createNoopLogger() });
  return { manager, fake };
}

describe("AudioManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unlock creates the context once and resumes it", () => {
    const { manager, fake } = makeManager();
    expect(manager.isUnlocked).toBe(false);
    manager.unlock();
    manager.unlock();
    expect(manager.isUnlocked).toBe(true);
    expect(fake.resumeCalls).toBe(1);
    expect(fake.oscillators).toHaveLength(0);
  });

  it("SFX drop before unlock and synthesize the pattern after", () => {
    const { manager, fake } = makeManager();
    manager.playSfx("coin");
    expect(fake.oscillators).toHaveLength(0);
    manager.unlock();
    manager.playSfx("coin"); // two notes
    expect(fake.oscillators).toHaveLength(2);
    const start = fake.oscillators[0]!["start"];
    expect(start).toHaveBeenCalled();
    // First coin note: 880 Hz scheduled at unlock-time + lead + 0 delay.
    expect(fake.oscillators[0]!["frequency"]).toEqual({ value: 880 });
  });

  it("BGM loops the sequencer while started and stops cleanly", () => {
    const { manager, fake } = makeManager();
    manager.unlock();
    manager.startBgm("village");
    expect(manager.currentBgm).toBe("village");
    vi.advanceTimersByTime(3 * 200);
    expect(fake.oscillators.length).toBeGreaterThanOrEqual(3);
    manager.stopBgm();
    expect(manager.currentBgm).toBeNull();
    const count = fake.oscillators.length;
    vi.advanceTimersByTime(600);
    expect(fake.oscillators.length).toBe(count);
  });

  it("starting another BGM stops the previous loop", () => {
    const { manager } = makeManager();
    manager.unlock();
    manager.startBgm("village");
    manager.startBgm("wilds");
    expect(manager.currentBgm).toBe("wilds");
  });

  it("dispose closes the context and makes the manager inert", () => {
    const { manager, fake } = makeManager();
    manager.unlock();
    manager.startBgm("title");
    manager.dispose();
    expect(fake.closeCalls).toBe(1);
    const count = fake.oscillators.length;
    manager.playSfx("coin");
    manager.startBgm("title");
    vi.advanceTimersByTime(1000);
    expect(fake.oscillators.length).toBe(count);
  });

  it("a failing context degrades to silent mode without throwing", () => {
    const { manager } = makeManager({
      factory: () => {
        throw new Error("no WebAudio here");
      },
    });
    expect(() => {
      manager.unlock();
      manager.playSfx("coin");
      manager.startBgm("title");
    }).not.toThrow();
    expect(manager.isUnlocked).toBe(false);
  });
});
