/**
 * Test setup (Vitest, jsdom).
 *
 * jsdom does not implement a real 2D canvas; calling `canvas.getContext("2d")`
 * logs an "Error: Not implemented" to the virtual console. Editor tests build
 * projects (which generate the placeholder tileset via canvas), so stub the
 * canvas 2D context to return null — the placeholder generator then falls back
 * to procedural colors and no jsdom noise is emitted.
 */
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}
