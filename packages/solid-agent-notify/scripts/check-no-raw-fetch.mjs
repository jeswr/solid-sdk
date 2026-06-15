#!/usr/bin/env node
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-no-raw-fetch — CI guard for the single-egress-chokepoint invariant.
 *
 * Fails (exit 1) if any source file OTHER than the guard itself references a raw
 * external-fetch primitive: the global `fetch(`, `undici.fetch`, `undici.request`,
 * or `import ... from "undici"`. Every attacker-influenced dereference MUST go
 * through `src/security/guardedFetch.ts`.
 *
 * Allowlist (files permitted to reference the raw primitives):
 *   - src/security/guardedFetch.ts  (the chokepoint — imports undici fetch/Agent)
 *   - src/security/ssrf.ts          (vendored SSRF guard — node:dns, no undici)
 *   - src/security/body.ts          (vendored bounded reader)
 * Test files (*.test.ts) are exempt — they spin up fixture servers and exercise
 * the guard directly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Files allowed to reference the raw primitives (relative to repo root, POSIX slashes). */
const ALLOWLIST = new Set([
  "src/security/guardedFetch.ts",
  "src/security/ssrf.ts",
  "src/security/body.ts",
]);

/** Patterns that indicate a raw external-fetch call. Comment-only segments are skipped. */
const PATTERNS = [
  { re: /(?<![.\w])fetch\s*\(/, label: "global fetch(" },
  { re: /\bundici\b/, label: 'reference to "undici"' },
  { re: /from\s+["']undici["']/, label: 'import from "undici"' },
];

/** True for files we scan (TS source, not tests, not type decls). */
function isScannable(rel) {
  if (!/\.ts$/.test(rel)) return false;
  if (/\.test\.ts$/.test(rel)) return false;
  if (rel.endsWith(".d.ts")) return false;
  return true;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

function stripLineComment(line) {
  const idx = line.indexOf("//");
  return idx === -1 ? line : line.slice(0, idx);
}

/**
 * Blank out `/* ... *​/` block-comment spans while preserving newlines (so line
 * numbers stay correct). Prevents JSDoc prose like "the guarded fetch (...)" from
 * tripping the raw-fetch patterns. A coarse stripper (no string-literal awareness)
 * is fine here: the goal is to drop comment prose, not parse TS.
 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const files = [];
walk(SRC, files);

const violations = [];
for (const full of files) {
  const rel = relative(ROOT, full).split("\\").join("/");
  if (!isScannable(rel)) continue;
  if (ALLOWLIST.has(rel)) continue;
  const text = stripBlockComments(readFileSync(full, "utf8"));
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const code = stripLineComment(lines[i]);
    for (const { re, label } of PATTERNS) {
      if (re.test(code)) {
        violations.push(
          `${rel}:${i + 1}: ${label} — route through guardedFetch instead.`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "check:fetch FAILED — raw external-fetch outside the guarded chokepoint:\n"
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\nEvery attacker-influenced fetch MUST go through src/security/guardedFetch.ts."
  );
  process.exit(1);
}

const scanned = files.filter((f) =>
  isScannable(relative(ROOT, f).split("\\").join("/"))
).length;
console.log(
  `check:fetch OK — ${scanned} source files scanned, no raw external fetch.`
);
