#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
//
// fix:lockfile-transport — the durable FIX half of the #78 recurrence guard
// (check:lockfile-transport is the DETECT half).
//
// npm 11's git-dependency resolution unconditionally writes the SSH transport
// (`git+ssh://git@github.com/...`) into package-lock.json's `resolved` field
// for any `github:owner/repo#ref` (or explicit `git+https://...`) dependency —
// regardless of the spec used in package.json, and regardless of local git
// config (a repo-local `url.<https>.insteadOf <ssh>` does NOT change what npm
// writes; it only affects what the `git` binary does when it is actually
// invoked to fetch, which is a different, narrower fix than committing a
// correct lockfile). This happens on ANY `npm install` / `npm update` that
// touches the lockfile at all, even a completely unrelated dependency bump
// (npm regenerates git-dependency `resolved` entries as a side effect of
// recomputing the whole tree).
//
// Fix: after any `npm install` / `npm update`, run
// `npm run fix:lockfile-transport` to rewrite the SSH transport back to HTTPS
// in every committed package-lock.json, then re-run
// `npm run check:lockfile-transport` (or `npm run lint`) before committing.
// `npm ci` never rewrites the lockfile in place, so once a lockfile is checked
// in with the HTTPS transport it stays correct until the next install/update.
//
// stdlib-only Node ESM, no dependency, so it is safe under ignore-scripts=true
// and cannot itself be a supply-chain vector.
//
// Usage: node scripts/normalize-lockfile.mjs

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// Fix from the REPOSITORY ROOT, not the cwd. This script is wired through
// web/package.json's `fix:lockfile-transport`, so a naive `process.cwd()`
// would only ever rewrite web/package-lock.json and silently miss the
// repo-root lockfile (the data-layer core's) — the same scoping the detect
// half (check-lockfile-transport.mjs) already corrects for. Resolve the git
// toplevel; fall back to cwd if git is unavailable (e.g. a tarball build), so
// the fixer still runs (just scoped to cwd) rather than crashing.
const ROOT = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
})();

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

// Rewrite every known SSH-git-transport shape npm/hosted-git-info can emit
// for a github.com URL back to the HTTPS transport `npm ci` can fetch without
// an SSH key. Order matters: the scp-like form must run before the bare
// `ssh://` form since it has no scheme to otherwise match.
const REWRITES = [
  // git+ssh://git@github.com/owner/repo.git#ref  ->  git+https://github.com/owner/repo.git#ref
  [/git\+ssh:\/\/git@github\.com\//g, "git+https://github.com/"],
  // ssh://git@github.com/owner/repo.git#ref  ->  https://github.com/owner/repo.git#ref
  [/(?<!git\+)ssh:\/\/git@github\.com\//g, "https://github.com/"],
  // scp-like git@github.com:owner/repo.git#ref  ->  https://github.com/owner/repo.git#ref
  [/(?<!\/\/)git@github\.com:/g, "https://github.com/"],
];

const lockfiles = findLockfiles(ROOT, []);

if (lockfiles.length === 0) {
  console.log("fix:lockfile-transport — no package-lock.json found (nothing to normalize).");
  process.exit(0);
}

let changed = 0;
for (const file of lockfiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const before = text;
  for (const [pattern, replacement] of REWRITES) {
    text = text.replace(pattern, replacement);
  }
  if (text !== before) {
    writeFileSync(file, text);
    changed++;
    console.log(
      `fix:lockfile-transport — normalized ${relative(ROOT, file)} to HTTPS git transport.`,
    );
  }
}

if (changed === 0) {
  console.log(
    `fix:lockfile-transport — OK (${lockfiles.length} lockfile(s) checked, already HTTPS; nothing to do).`,
  );
} else {
  console.log(
    `\nfix:lockfile-transport — normalized ${changed} lockfile(s). Review the diff and commit it ` +
      "alongside your dependency change.",
  );
}
process.exit(0);
