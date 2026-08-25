import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the editor (ADR-006). The production build (`dist/`) is
// served by the C++ server (ADR-005) or any static host.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
