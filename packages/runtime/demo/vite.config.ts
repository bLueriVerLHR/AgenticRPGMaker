import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Demo harness config: the runtime demo page (Playwright E2E target + manual
// preview). The demo lives INSIDE packages/runtime, so it cannot import
// `@agenticrpg/runtime` through node_modules (a package cannot depend on
// itself). We alias the three workspace packages to their TypeScript sources:
// vite bundles them directly, so the E2E does not require pre-built dists and
// exercises the real public surface (`src/index.ts`).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  resolve: {
    alias: {
      "@agenticrpg/runtime": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "@agenticrpg/core": fileURLToPath(new URL("../../core/src/index.ts", import.meta.url)),
      "@agenticrpg/renderer": fileURLToPath(
        new URL("../../renderer/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
