#!/usr/bin/env node
// AUTHORED-BY Claude Opus 4.8
//
// fix:lockfile-transport — the FIX half of the #78 guard (check-lockfile-transport
// is the DETECT half). `npm install`/`npm update` (npm 11.x / hosted-git-info)
// silently REWRITES `@jeswr` git dependency `resolved` URLs to the SSH transport
// (`git+ssh://git@github.com/...`), which requires an SSH key and so breaks
// `npm ci` in CI / Vercel / any fresh checkout. This script rewrites every SSH
// GitHub git transport in every committed package-lock.json back to HTTPS,
// idempotently. stdlib-only Node ESM, safe under ignore-scripts=true.
//
// Run it after any `npm install`/`npm update` that touches a git dependency.
// Usage: node scripts/normalize-lockfile.mjs

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
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

// Rewrite both the `git+ssh://git@github.com/` and scp-like `ssh://git@github.com/`
// transports to `git+https://github.com/` — the form `npm ci` resolves without a key.
function normalize(text) {
  return text
    .replaceAll("git+ssh://git@github.com/", "git+https://github.com/")
    .replaceAll("ssh://git@github.com/", "git+https://github.com/");
}

let changed = 0;
for (const file of findLockfiles(ROOT, [])) {
  const before = readFileSync(file, "utf8");
  const after = normalize(before);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log(
      `fix:lockfile-transport — normalized ${relative(ROOT, file)} to the HTTPS transport.`,
    );
  }
}

console.log(
  changed === 0
    ? "fix:lockfile-transport — OK (no SSH git transport to normalize)."
    : `fix:lockfile-transport — normalized ${changed} lockfile(s).`,
);
