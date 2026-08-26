/**
 * Minimal WebAudio manager (ADR-010 §4, S3a).
 *
 * One `AudioContext`, unlocked by the first user gesture (browser autoplay
 * policy): BGM is a tiny note sequencer on `OscillatorNode` (looped, per-ref
 * patterns), SFX are synthesized one-shots. The `bgm`/`sfx` refs are the
 * stable identifiers from ADR-010 — real audio files can replace synthesis
 * later without touching event data.
 *
 * Headless/jsdom safety: the context is created lazily via an injectable
 * factory; when constructing or resuming fails the manager degrades to a
 * silent no-op with a single warn (never a thrown boot path).
 */
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

/** The subset of AudioContext the manager touches (fakes in tests). */
export interface AudioNodeLike {
  connect(target: unknown): unknown;
}

export interface AudioContextLike {
  currentTime: number;
  destination: unknown;
  state?: string;
  resume?(): Promise<void>;
  close?(): Promise<void>;
  createOscillator(): AudioNodeLike & {
    start(when?: number): void;
    stop?(when?: number): void;
    frequency?: { value?: number };
  };
  createGain(): AudioNodeLike & { gain?: { value?: number } };
}

export type AudioContextFactory = () => AudioContextLike;

/** One synthesized SFX note (frequency Hz, duration s, relative delay s). */
interface Note {
  freq: number;
  duration: number;
  delay: number;
}

/** Per-ref SFX patterns (ADR-010: coin/sword/hit/defeated/door/save). */
const SFX_PATTERNS: Readonly<Record<string, readonly Note[]>> = {
  coin: [
    { freq: 880, duration: 0.08, delay: 0 },
    { freq: 1320, duration: 0.14, delay: 0.07 },
  ],
  sword: [
    { freq: 220, duration: 0.05, delay: 0 },
    { freq: 330, duration: 0.06, delay: 0.04 },
  ],
  hit: [{ freq: 110, duration: 0.14, delay: 0 }],
  defeated: [
    { freq: 330, duration: 0.1, delay: 0 },
    { freq: 220, duration: 0.12, delay: 0.1 },
    { freq: 110, duration: 0.22, delay: 0.22 },
  ],
  door: [
    { freq: 160, duration: 0.16, delay: 0 },
    { freq: 120, duration: 0.2, delay: 0.14 },
  ],
  save: [
    { freq: 523, duration: 0.09, delay: 0 },
    { freq: 784, duration: 0.14, delay: 0.08 },
  ],
};

/** Per-ref BGM loops: frequencies cycled one per step (0 = rest). */
export interface BgmPattern {
  stepMs: number;
  notes: readonly number[];
}

const BGM_PATTERNS: Readonly<Record<string, BgmPattern>> = {
  title: { stepMs: 240, notes: [262, 330, 392, 523, 392, 330, 262, 0] },
  village: { stepMs: 200, notes: [392, 440, 523, 440, 392, 349, 330, 0] },
  wilds: { stepMs: 220, notes: [220, 233, 262, 233, 220, 196, 175, 0] },
  fortress: { stepMs: 260, notes: [131, 147, 165, 147, 131, 110, 123, 0] },
  ending: { stepMs: 230, notes: [523, 587, 659, 784, 659, 587, 523, 0] },
};

const DEFAULT_SFX: readonly Note[] = [{ freq: 440, duration: 0.1, delay: 0 }];
const DEFAULT_BGM: BgmPattern = { stepMs: 250, notes: [262, 330, 392, 0] };

export interface AudioManagerOptions {
  /** Injected context factory (tests); defaults to `new AudioContext()`. */
  factory?: AudioContextFactory;
  logger?: Logger;
  /** Leading silence before scheduled notes, in seconds. */
  leadSeconds?: number;
}

function browserFactory(): AudioContextLike {
  if (typeof AudioContext === "undefined") {
    throw new Error("AudioContext is not available in this environment");
  }
  return new AudioContext() as unknown as AudioContextLike;
}

export class AudioManager {
  private readonly factory: AudioContextFactory;
  private readonly logger: Logger;
  private readonly leadSeconds: number;

  private ctx: AudioContextLike | null = null;
  private unlocked = false;
  private silent = false;
  private silenceWarned = false;
  private disposed = false;
  private bgmRef: string | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private bgmStep = 0;

  constructor(options: AudioManagerOptions = {}) {
    this.factory = options.factory ?? browserFactory;
    this.logger = options.logger ?? createNoopLogger();
    this.leadSeconds = options.leadSeconds ?? 0.08;
  }

  /** True once the context exists and playback is allowed. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** The current BGM ref, or null. */
  get currentBgm(): string | null {
    return this.bgmRef;
  }

  /**
   * Create + resume the context. Called from the first user gesture (title
   * screen "press any key", ADR-010 §3). Idempotent; a failed context makes
   * the manager silently inert (warn once, never throws).
   */
  unlock(): void {
    if (this.disposed || this.unlocked || this.silent) {
      return;
    }
    try {
      this.ctx = this.factory();
    } catch (error: unknown) {
      this.markSilent("unlock: context creation failed", error);
      return;
    }
    const resume = this.ctx.resume;
    if (typeof resume === "function") {
      resume.call(this.ctx).catch((error: unknown) => {
        this.logger.warn("audio: resume failed", { error: String(error) });
      });
    }
    this.unlocked = true;
    this.logger.info("audio: unlocked", {});
  }

  /** Play a synthesized one-shot (silently dropped while locked). */
  playSfx(ref: string): void {
    if (this.disposed || this.silent) {
      return;
    }
    if (!this.unlocked || this.ctx === null) {
      this.logger.debug("audio: sfx dropped (not unlocked)", { ref });
      return;
    }
    const pattern = SFX_PATTERNS[ref] ?? DEFAULT_SFX;
    const now = this.ctx.currentTime + this.leadSeconds;
    for (const note of pattern) {
      this.scheduleTone(note.freq, note.duration, now + note.delay, 0.08);
    }
    this.logger.debug("audio: sfx", { ref });
  }

  /** Start (or switch) the BGM loop for a ref. */
  startBgm(ref: string): void {
    if (this.disposed || this.silent || this.bgmRef === ref) {
      return;
    }
    this.stopBgm();
    if (!this.unlocked || this.ctx === null) {
      this.logger.debug("audio: bgm deferred (not unlocked)", { ref });
      return;
    }
    this.bgmRef = ref;
    this.bgmStep = 0;
    const pattern = BGM_PATTERNS[ref] ?? DEFAULT_BGM;
    this.bgmTimer = setInterval(() => {
      if (this.ctx === null || this.unlocked === false) {
        return;
      }
      const freq = pattern.notes[this.bgmStep % pattern.notes.length] ?? 0;
      if (freq > 0) {
        this.scheduleTone(
          freq,
          Math.min(0.16, pattern.stepMs / 1000),
          this.ctx.currentTime + 0.05,
          0.05,
        );
      }
      this.bgmStep += 1;
    }, pattern.stepMs);
    this.logger.info("audio: bgm started", { ref });
  }

  /** Stop the current BGM loop (no-op when none is running). */
  stopBgm(): void {
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmRef !== null) {
      this.logger.info("audio: bgm stopped", { ref: this.bgmRef });
      this.bgmRef = null;
    }
  }

  /** Stop everything and close the context. Further calls are no-ops. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stopBgm();
    const close = this.ctx?.close;
    if (typeof close === "function") {
      void close.call(this.ctx).catch((error: unknown) => {
        this.logger.warn("audio: close failed", { error: String(error) });
      });
    }
    this.ctx = null;
    this.unlocked = false;
    this.disposed = true;
    this.logger.info("audio: disposed", {});
  }

  private scheduleTone(freq: number, duration: number, when: number, volume: number): void {
    if (this.ctx === null) {
      return;
    }
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      if (osc.frequency !== undefined) {
        osc.frequency.value = freq;
      }
      if (gain.gain !== undefined) {
        gain.gain.value = volume;
      }
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(when);
      osc.stop?.(when + duration);
    } catch (error: unknown) {
      // A throwing node should never break gameplay; degrade to silence.
      this.markSilent("tone scheduling failed", error);
    }
  }

  private markSilent(reason: string, error: unknown): void {
    this.silent = true;
    this.stopBgm();
    if (!this.silenceWarned) {
      this.silenceWarned = true;
      this.logger.warn(`audio: entering silent mode (${reason})`, { error: String(error) });
    }
  }
}
