/**
 * Capability detection tests (P1b, ADR-002).
 *
 * Detection order is WebGL2 → WebGL1 → Canvas2D; the chosen backend is logged
 * at info. All detection runs against stubbed canvases/probes — no real GL.
 */
import { describe, expect, it } from "vitest";

import { CAPABILITY_PROBE_ORDER, detectCapability } from "../src/capability.js";
import type { ContextKind } from "../src/capability.js";
import { createStubCanvas, createStubLogger } from "./helpers.js";

describe("capability detection (ADR-002 order: webgl2 -> webgl1 -> canvas2d)", () => {
  it("selects webgl2 when available", () => {
    const canvas = createStubCanvas({
      getContext: (id) => (id === "webgl2" ? { marker: "gl2" } : null),
    });
    const result = detectCapability({ canvas, logger: createStubLogger() });
    expect(result.supported).toBe(true);
    expect(result.backend).toBe("webgl2");
    expect(result.context).not.toBeNull();
  });

  it("falls back to webgl1 when webgl2 is unavailable", () => {
    const canvas = createStubCanvas({
      getContext: (id) =>
        id === "webgl" || id === "experimental-webgl" ? { marker: "gl1" } : null,
    });
    const result = detectCapability({ canvas, logger: createStubLogger() });
    expect(result.supported).toBe(true);
    expect(result.backend).toBe("webgl1");
    expect(result.context).not.toBeNull();
  });

  it("falls back to canvas2d when no webgl context can be created", () => {
    const canvas = createStubCanvas({
      getContext: (id) => (id === "2d" ? { fillRect: () => undefined } : null),
    });
    const result = detectCapability({ canvas, logger: createStubLogger() });
    expect(result.supported).toBe(true);
    expect(result.backend).toBe("canvas2d");
  });

  it("reports unsupported when nothing is available", () => {
    const canvas = createStubCanvas({ getContext: () => null });
    const result = detectCapability({ canvas, logger: createStubLogger() });
    expect(result.supported).toBe(false);
    expect(result.backend).toBe("canvas2d");
    expect(result.reason).toContain("unavailable");
    expect(result.context).toBeNull();
  });

  it("probes kinds in the documented order until one succeeds", () => {
    const probed: ContextKind[] = [];
    const canvas = createStubCanvas();
    const result = detectCapability({
      canvas,
      probe: (kind) => {
        probed.push(kind);
        // only 2d succeeds, so all three kinds must be attempted in order
        return kind === "2d" ? {} : null;
      },
      logger: createStubLogger(),
    });
    expect(probed).toEqual([...CAPABILITY_PROBE_ORDER]);
    expect(result.backend).toBe("canvas2d");
    expect(result.probes.map((p) => p.kind)).toEqual([...CAPABILITY_PROBE_ORDER]);
  });

  it("logs the chosen backend at info", () => {
    const logger = createStubLogger();
    const canvas = createStubCanvas({
      getContext: (id) => (id === "2d" ? { fillRect: () => undefined } : null),
    });
    detectCapability({ canvas, logger });
    expect(logger.info).toHaveBeenCalledWith(
      "renderer capability: selected backend",
      expect.objectContaining({ backend: "canvas2d" }),
    );
  });
});
