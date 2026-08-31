# Task 02 — Remove the editor from the tree (archive via git tag)

| Field | Value |
|---|---|
| **Goal** | `main` is genuinely editor-less: `packages/editor` files are deleted from the working tree, the history is archived with a git tag, and every build/test/deploy/workspace reference to the editor is removed or neutralized. |
| **Why** | D20 (editor removed until a real game exists); Q9 (code-side removal in this pass). The editor is archived, not lost: restore = `git checkout <tag>` + move the package back onto the same `core` model. |
| **Approach** | 1. **Tag first**: create `archive/editor-0.1.0` at the current HEAD (before deletion) so the editor code is recoverable in one step. 2. `git rm -r packages/editor`. 3. `pnpm-workspace.yaml` — unchanged (uses `packages/*` glob; removing the dir removes the package). 4. Root `package.json` — remove editor from description/workspace mentions; no script change needed unless it referenced the editor (check). 5. `scripts/build-deploy.mjs` — drop the editor build step, editor dist copy, asset-relativization, and `editor/` entries from layout/README. 6. `scripts/verify-deploy.mjs` — drop `/editor/` HTTP checks and editor-asset check. 7. Update AGENTS.md repository-layout table (remove `packages/editor` row; describe editor as archived). 8. `eslint.config.mjs` / `.prettierignore` / root configs — remove any editor path that no longer exists (lint/prettier must not fail on missing dirs). |
| **Files touched** | `packages/editor/` (deleted), `package.json`, `scripts/build-deploy.mjs`, `scripts/verify-deploy.mjs`, `AGENTS.md`, `eslint.config.mjs`, `.prettierignore`, git tag `archive/editor-0.1.0` |
| **Acceptance criteria** | `packages/editor` absent from `main` tree; tag `archive/editor-0.1.0` restores it; `pnpm -r build`, `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` pass with no editor references; `build:deploy` + `verify:deploy` pass without the editor. |
| **Status** | todo |
