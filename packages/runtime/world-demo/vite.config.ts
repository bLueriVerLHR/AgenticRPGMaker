import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// World demo harness config: a self-contained page for the seamless world
// (title → WorldScene → combat/CG/dialogue). Same aliasing trick as `demo/`
// (a package cannot import itself through node_modules, so the three
// workspace packages alias to their TypeScript sources and vite bundles them).
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
    port: 5198,
    strictPort: false,
  },
  preview: {
    port: 4176,
    strictPort: false,
  },
});
