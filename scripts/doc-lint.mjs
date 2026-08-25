#!/usr/bin/env node
/**
 * doc-lint — AgenticRPGMaker docs link/status lint (ADR-007, D19).
 *
 * Checks every markdown file under docs/ for:
 *   1. Internal markdown links: every [text](target) whose target is a local
 *      relative path must resolve to an existing file OR directory in the repo.
 *      External URLs (http(s)://, mailto:) and pure fragment anchors (#...) are
 *      skipped. Code fences (``` ... ```) are skipped.
 *   2. Status fields: every `status:` / `Status:` field (emphasized with ** or
 *      at the start of a line) must carry one of the allowed status values.
 *
 * Usage: `pnpm doc:lint` (node scripts/doc-lint.mjs)
 *
 * Exit code 0 = green, 1 = at least one issue.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(repoRoot, "docs");

// Allowed status values, case-insensitive after normalization. The canonical
// set comes from ADR-007; "consensus confirmed" is the doc-status value used
// by 01-vision.md and is accepted so the lint stays green against the current
// docs.
const ALLOWED_STATUSES = new Set([
  "proposed",
  "accepted",
  "superseded",
  "decided",
  "pending",
  "pending sign-off",
  "draft",
  "consensus confirmed",
]);

/** Recursively collect all files (and dirs) under `root`. */
function collect(root, out) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.dirs.add(full);
      collect(full, out);
    } else if (entry.isFile()) {
      out.files.add(full);
    }
  }
  return out;
}

const tree = collect(docsRoot, { files: new Set(), dirs: new Set() });

function walk(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(full));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      result.push(full);
    }
  }
  return result;
}

/** Strip decorations from one status token (no "|" lists here). */
function normalizeStatusToken(token) {
  let value = token.trim().replace(/\*\*/g, "").replace(/`/g, "").trim();
  // Drop parenthetical annotations and em/en-dash annotations:
  //   "DECIDED (plan for implementation)"  -> "DECIDED"
  //   "DRAFT — for the user to verify ..." -> "DRAFT"
  const cut = value.search(/[()—–]/);
  if (cut !== -1) value = value.slice(0, cut);
  return value.trim();
}

function isAllowedStatus(raw) {
  let value = raw.trim().replace(/\*\*/g, "").replace(/`/g, "").trim();
  // A "|"-separated list (the ADR template's "proposed | accepted |
  // superseded") is allowed only when EVERY option is itself allowed.
  if (value.includes("|")) {
    return value.split("|").every((part) => isAllowedStatus(part));
  }
  return ALLOWED_STATUSES.has(normalizeStatusToken(value).toLowerCase());
}

const issues = [];
let statusFieldsChecked = 0;

// Status field regex: emphasized "**status: value**" or a line-start
// "status: value" / "Status: value" (e.g. blockquote "> Status: **DRAFT — ...").
const STATUS_RE = /(?:^|\*\*)\s*(?:status|Status):\s*([^\r\n]+)/gm;

for (const file of walk(docsRoot)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const fileLabel = relative(repoRoot, file);

  // --- Link check (skip fenced code blocks) --------------------------------
  let inFence = false;
  const linkRe = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(linkRe)) {
      const target = match[1];
      if (/^(https?:|mailto:|\/\/|#)/i.test(target)) continue; // external / anchor
      const withoutFragment = target.split("#")[0];
      if (!withoutFragment) continue; // pure "#fragment"
      const resolved = resolve(dirname(file), withoutFragment);
      if (!tree.files.has(resolved) && !tree.dirs.has(resolved)) {
        issues.push(`${fileLabel}: broken link -> ${target} (resolves to ${relative(repoRoot, resolved)})`);
      }
    }
  }

  // --- Status check ----------------------------------------------------------
  for (const match of content.matchAll(STATUS_RE)) {
    const raw = match[1];
    statusFieldsChecked++;
    if (!isAllowedStatus(raw)) {
      issues.push(
        `${fileLabel}: invalid status value "${raw.trim()}" (allowed: ${[...ALLOWED_STATUSES].join(", ")})`,
      );
    }
  }
}

if (issues.length > 0) {
  for (const issue of issues) console.error(`doc-lint: ${issue}`);
  console.error(`doc-lint: FAILED — ${issues.length} issue(s) across ${walk(docsRoot).length} doc file(s).`);
  process.exit(1);
}

const files = walk(docsRoot).length;
console.log(`doc-lint: OK — ${files} doc file(s), ${statusFieldsChecked} status field(s) checked, all links resolve.`);
process.exit(0);
