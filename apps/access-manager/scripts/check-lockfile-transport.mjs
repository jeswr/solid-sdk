#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5 (guard copied from pod-health/web, originally Opus-4.8-authored)
//
// check:lockfile-transport — recurrence guard for the #78 bug class.
//
// `npm install` (npm 11.x / hosted-git-info) silently REWRITES `@jeswr` github:
// dependency `resolved` URLs in package-lock.json back to the SSH transport
// (`git+ssh://git@github.com/...`). That form requires an SSH key, so `npm ci`
// then fails in CI / Vercel / any fresh environment without one. #78 rewrote
// every lockfile to the HTTPS transport; this guard stops a stray `npm install`
// from quietly re-breaking them.
//
// It FAILS (exit 1) if any committed package-lock.json (root or nested, e.g.
// web/) contains an SSH git transport. stdlib-only Node ESM, no dependency, so
// it is safe under ignore-scripts=true.
//
// Usage: node scripts/check-lockfile-transport.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor the scan at the REPOSITORY ROOT, not `process.cwd()`. The npm script runs
// this from `web/` (its package.json), so a cwd-based root would only ever scan the
// `web/` subtree and silently miss a repo-ROOT `package-lock.json` (pod-health has
// both a root data-layer lockfile and `web/`). Walk UP from this script's own dir to
// the first directory containing a `.git` (the checkout root); fall back to two
// levels up (`web/scripts` → repo root) if no `.git` is found (e.g. a worktree's
// `.git` is a FILE, which existsSync still detects, but be defensive). This makes the
// guard cover the ENTIRE checkout regardless of the invoking cwd, matching its
// documented "root and nested lockfiles" contract.
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Fallback: this script lives at `<repo>/web/scripts/`, so two dirs up is the repo
  // root. (Used only if no `.git` is found, e.g. an exported tarball.)
  return dirname(dirname(startDir));
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = findRepoRoot(SCRIPT_DIR);

// Directories we never descend into when discovering lockfiles.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".vercel",
  ".turbo",
]);

// The forbidden transports. hosted-git-info rewrites to `git+ssh://git@github`
// or the scp-like `ssh://git@github`; match both. (We only flag GitHub here,
// which is where every @jeswr github: dep lives — the #78 surface.)
const FORBIDDEN = [/git\+ssh:\/\/git@github/, /(^|["@/])ssh:\/\/git@github/];

/** Recursively collect every package-lock.json under `dir` (skipping SKIP_DIRS). */
function findLockfiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      findLockfiles(join(dir, e.name), acc);
    } else if (e.isFile() && e.name === "package-lock.json") {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const lockfiles = findLockfiles(ROOT, []);

if (lockfiles.length === 0) {
  console.log("check:lockfile-transport — no package-lock.json found (nothing to guard).");
  process.exit(0);
}

let bad = 0;
for (const file of lockfiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const offending = text
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => FORBIDDEN.some((re) => re.test(line)));
  if (offending.length > 0) {
    bad++;
    console.error(`\n✖ ${relative(ROOT, file)} uses an SSH git transport (breaks \`npm ci\`):`);
    for (const { line, n } of offending) console.error(`    line ${n}: ${line}`);
  }
}

if (bad > 0) {
  console.error(
    `\ncheck:lockfile-transport — ${bad} lockfile(s) contain an SSH git transport.\n` +
      "  Rewrite each `git+ssh://git@github.com/...` (or `ssh://git@github...`) to\n" +
      "  `git+https://github.com/...` and re-run. (This is the #78 bug class:\n" +
      "  `npm install` rewrites @jeswr github: deps to SSH, which fails `npm ci`\n" +
      "  in CI / Vercel without an SSH key.)",
  );
  process.exit(1);
}

console.log(
  `check:lockfile-transport — OK (${lockfiles.length} lockfile(s) checked, no SSH git transport).`,
);
process.exit(0);
