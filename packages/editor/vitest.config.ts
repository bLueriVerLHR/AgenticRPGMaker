import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the editor (ADR-006 / D15).
 *
 * Unit + component tests run in jsdom (component tests render React with
 * @testing-library/react); pure-logic tests (storage, zip, commands) run in
 * the same environment without DOM dependencies. E2E is separate
 * (`e2e/run-e2e.mjs`, Playwright) and mirrors the runtime package's E2E.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
});
