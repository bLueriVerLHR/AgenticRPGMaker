/**
 * Platform capabilities probe tests (task 07, D21/D23).
 *
 * Covers: Node (no DOM) default probe never throws and returns a well-typed
 * snapshot; injected probes are honored; renderer probe order (WebGL2 →
 * WebGL1 → Canvas2D); robustness against throwing probes.
 */
import { describe, expect, it } from "vitest";

import { probePlatformCapabilities, type PlatformProbes } from "../src/platform.js";

describe("probePlatformCapabilities", () => {
  it("returns a well-typed snapshot in Node (no DOM) without throwing", () => {
    const caps = probePlatformCapabilities();
    expect(caps.renderer).toHaveProperty("backend");
    expect(typeof caps.input.touch).toBe("boolean");
    expect(typeof caps.input.keyboard).toBe("boolean");
    expect(typeof caps.storage.indexeddb).toBe("boolean");
    expect(typeof caps.storage.localStorage).toBe("boolean");
    expect(typeof caps.audio.webAudio).toBe("boolean");
  });

  it("honors injected probes", () => {
    const probes: PlatformProbes = {
      canvasContexts: () => ["2d"],
      touch: () => true,
      keyboard: () => false,
      indexeddb: () => true,
      localStorage: () => false,
      webAudio: () => true,
    };
    const caps = probePlatformCapabilities(probes);
    expect(caps.renderer).toEqual({ backend: "canvas2d" });
    expect(caps.input).toEqual({ touch: true, keyboard: false });
    expect(caps.storage).toEqual({ indexeddb: true, localStorage: false });
    expect(caps.audio.webAudio).toBe(true);
  });

  it("selects the renderer backend in probe order (webgl2 → webgl1 → canvas2d)", () => {
    expect(probePlatformCapabilities({ canvasContexts: () => ["webgl2"] }).renderer).toEqual({
      backend: "webgl2",
    });
    expect(probePlatformCapabilities({ canvasContexts: () => ["webgl", "2d"] }).renderer).toEqual({
      backend: "webgl1",
    });
    expect(
      probePlatformCapabilities({ canvasContexts: () => ["webgl2", "webgl", "2d"] }).renderer,
    ).toEqual({ backend: "webgl2" });
    expect(probePlatformCapabilities({ canvasContexts: () => [] }).renderer.backend).toBeNull();
  });

  it("reports a reason when no renderer context is available", () => {
    const caps = probePlatformCapabilities({ canvasContexts: () => [] });
    expect(caps.renderer.backend).toBeNull();
    expect(typeof caps.renderer.reason).toBe("string");
  });

  it("never throws when a probe throws (defensive)", () => {
    const caps = probePlatformCapabilities({
      canvasContexts: () => {
        throw new Error("boom");
      },
      touch: () => {
        throw new Error("boom");
      },
    });
    // canvasContexts throwing is treated as "no report" → backend stays the
    // renderer default (null in Node); throwing boolean probes fall back to false.
    expect(caps.renderer).toHaveProperty("backend");
    expect(caps.input.touch).toBe(false);
  });

  it("honors a known rendererBackend and skips canvas probing (task 11)", () => {
    // A throwing canvasContexts probe proves the canvas path is NOT invoked
    // when a known backend is supplied (avoids a second WebGL context at boot).
    const caps = probePlatformCapabilities({
      rendererBackend: "webgl2",
      canvasContexts: () => {
        throw new Error("canvas probe should not be called");
      },
    });
    expect(caps.renderer).toEqual({ backend: "webgl2" });
  });

  it("reports null when rendererBackend is explicitly null (task 11)", () => {
    const caps = probePlatformCapabilities({
      rendererBackend: null,
      canvasContexts: () => ["webgl2"],
    });
    expect(caps.renderer.backend).toBeNull();
    expect(typeof caps.renderer.reason).toBe("string");
  });
});
