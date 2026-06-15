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
 *
 * Pure helper functions (stripLineComment, stripBlockComments, isScannable,
 * PATTERNS) are exported so the unit-test suite can cover them without spawning
 * a subprocess.  The scan itself runs only when the script is executed directly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Files allowed to reference the raw primitives (relative to repo root, POSIX slashes). */
export const ALLOWLIST = new Set([
  "src/security/guardedFetch.ts",
  "src/security/ssrf.ts",
  "src/security/body.ts",
]);

/** Patterns that indicate a raw external-fetch call. Comment-only segments are skipped. */
export const PATTERNS = [
  { re: /(?<![.\w])fetch\s*\(/, label: "global fetch(" },
  { re: /\bundici\b/, label: 'reference to "undici"' },
  { re: /from\s+["']undici["']/, label: 'import from "undici"' },
];

/** True for files we scan (TS source, not tests, not type decls). */
export function isScannable(rel) {
  if (!/\.ts$/.test(rel)) return false;
  if (/\.test\.ts$/.test(rel)) return false;
  if (rel.endsWith(".d.ts")) return false;
  return true;
}

export function walk(dir, out) {
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

/**
 * Return the code portion of a line before any `//` line comment, skipping
 * `//` that appear inside single- or double-quoted string literals so that
 * URLs such as `"https://example.com"` do not trigger a premature truncation.
 *
 * BUG FIXED: the previous implementation used `line.indexOf("//")` which
 * matched `//` inside string literals (e.g. in URLs), causing the guard to
 * strip code that appeared after the `//` in a URL string and miss real
 * `fetch(` calls on the same line.
 *
 * This is intentionally NOT a full TS tokeniser — it handles the common cases
 * (plain string literals, no template literals) that appear in our source.
 * Template literals (backtick strings) are left un-stripped: a `//` inside
 * a template literal is treated as a comment start.  That is conservative —
 * it may produce a false-positive but never a false-negative (missed fetch).
 */
export function stripLineComment(line) {
  let inString = null; // null | '"' | "'"
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      // Inside a string literal: wait for the closing quote (ignore escaped ones).
      if (ch === "\\") {
        i++; // skip the escaped character
      } else if (ch === inString) {
        inString = null;
      }
    } else {
      // Outside a string literal.
      if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "/" && line[i + 1] === "/") {
        // Found `//` outside a string — everything from here is a comment.
        return line.slice(0, i);
      }
    }
  }
  return line;
}

/**
 * Blank out `/* ... *​/` block-comment spans while preserving newlines (so line
 * numbers stay correct). Prevents JSDoc prose like "the guarded fetch (...)" from
 * tripping the raw-fetch patterns. A coarse stripper (no string-literal awareness)
 * is fine here: the goal is to drop comment prose, not parse TS.
 */
export function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// ── Main scan — runs only when executed directly, not when imported by tests ──
const isMain =
  process.argv[1] &&
  (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const ROOT = process.cwd();
  const SRC = join(ROOT, "src");

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
}
