import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/build/**",
      "**/build-*/**",
      "**/CMakeFiles/**",
      "**/coverage/**",
      "**/.vite/**",
      "**/.tools/**",
      "**/www/**",
      "**/deploy/**",
      "work/**",
      "pnpm-lock.yaml",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.{mjs,cjs,js}"],
    languageOptions: { globals: globals.node },
  },
);
