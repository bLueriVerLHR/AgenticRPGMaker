/**
 * Platform capabilities probe (D21/D23, docs/06-architecture.md §7).
 *
 * The portable-first seam: one read-only snapshot of what the current
 * environment can do — renderer backend, input devices, storage, audio —
 * so browser and JoiPlay (and future targets) are *configurations of the same
 * runtime* rather than separate programs.
 *
 * Every detection is guarded so calling the probe **never throws**, in Node
 * (tests), a desktop browser, or an old/restricted WebView (JoiPlay). The
 * whole probe is injectable for tests (fake probes).
 */
import type { RendererBackend } from "@agenticrpg/renderer";

/** Renderer capability section. */
export interface PlatformRendererCapability {
  /** The backend the renderer *would* use (probe order WebGL2→WebGL1→Canvas2D). */
  backend: RendererBackend | null;
  /** Why no backend was detected (only when `backend` is null). */
  reason?: string;
}

/** Input capability section. */
export interface PlatformInputCapability {
  /** A touch-capable input path exists (JoiPlay / mobile). */
  touch: boolean;
  /** A physical keyboard exists (desktop browsers). */
  keyboard: boolean;
}

/** Storage capability section. */
export interface PlatformStorageCapability {
  /** IndexedDB is available (saves, RQ1). */
  indexeddb: boolean;
  /** localStorage is available (small data fallback, docs/08 §4.7). */
  localStorage: boolean;
}

/** Audio capability section. */
export interface PlatformAudioCapability {
  /** Web Audio `AudioContext` is available (MVP audio is deferred; docs/08 §4.2). */
  webAudio: boolean;
}

/** The complete platform snapshot (one read-only object). */
export interface PlatformCapabilities {
  renderer: PlatformRendererCapability;
  input: PlatformInputCapability;
  storage: PlatformStorageCapability;
  audio: PlatformAudioCapability;
}

/** Injectable detection hooks (tests stub these; defaults probe the environment). */
export interface PlatformProbes {
  canvasContexts?: () => Array<ContextKind>;
  touch?: () => boolean;
  keyboard?: () => boolean;
  indexeddb?: () => boolean;
  localStorage?: () => boolean;
  webAudio?: () => boolean;
}

/** Renderer context kinds probed in order (mirrors renderer capability, ADR-002). */
type ContextKind = "webgl2" | "webgl" | "2d";

/** Probe order, mirroring packages/renderer capability detection (ADR-002). */
const RENDERER_PROBE_ORDER: readonly ContextKind[] = ["webgl2", "webgl", "2d"];

const BACKEND_FOR_CONTEXT: Record<ContextKind, RendererBackend> = {
  webgl2: "webgl2",
  webgl: "webgl1",
  "2d": "canvas2d",
};

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/**
 * Probe the current platform. Returns a well-typed snapshot; never throws.
 * All arguments are optional — omit them to probe the real environment.
 */
export function probePlatformCapabilities(probes?: PlatformProbes): PlatformCapabilities {
  // --- renderer ----------------------------------------------------------
  let renderer: PlatformRendererCapability = { backend: null, reason: "no canvas available" };
  if (probes?.canvasContexts !== undefined) {
    try {
      const contexts = probes.canvasContexts();
      const found = RENDERER_PROBE_ORDER.find((kind) => contexts.includes(kind));
      renderer =
        found === undefined
          ? { backend: null, reason: "no context kind reported by probe" }
          : { backend: BACKEND_FOR_CONTEXT[found] };
    } catch {
      // A throwing probe is treated as "no report" — never propagate (the
      // whole probe promises not to throw).
      renderer = { backend: null, reason: "canvas context probe threw" };
    }
  } else if (typeof document !== "undefined" && typeof document.createElement === "function") {
    try {
      const canvas = document.createElement("canvas");
      for (const kind of RENDERER_PROBE_ORDER) {
        if (canvas.getContext(kind) !== null) {
          renderer = { backend: BACKEND_FOR_CONTEXT[kind] };
          break;
        }
      }
    } catch {
      renderer = { backend: null, reason: "canvas context probing threw" };
    }
  }
  // Note: in Node (no document) with no injected probe, renderer stays
  // { backend: null } — intentional: the probe is a *runtime* capability
  // reporter, and boot still creates the real renderer via its own factory.

  // --- input -------------------------------------------------------------
  const touch = safe(() =>
    probes?.touch !== undefined
      ? probes.touch()
      : navigator.maxTouchPoints > 0 || "ontouchstart" in navigator,
  );
  const keyboard = safe(() =>
    probes?.keyboard !== undefined ? probes.keyboard() : "KeyboardEvent" in navigator,
  );

  // --- storage -----------------------------------------------------------
  const indexeddb = safe(() =>
    probes?.indexeddb !== undefined ? probes.indexeddb() : "indexedDB" in globalThis,
  );
  const localStorage = safe(() =>
    probes?.localStorage !== undefined
      ? probes.localStorage()
      : typeof globalThis.localStorage !== "undefined",
  );

  // --- audio -------------------------------------------------------------
  const webAudio = safe(() =>
    probes?.webAudio !== undefined
      ? probes.webAudio()
      : typeof globalThis.AudioContext !== "undefined" ||
        (typeof globalThis !== "undefined" && "webkitAudioContext" in globalThis),
  );

  return {
    renderer,
    input: { touch, keyboard },
    storage: { indexeddb, localStorage },
    audio: { webAudio },
  };
}
