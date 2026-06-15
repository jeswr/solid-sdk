#!/usr/bin/env node
// AUTHORED-BY Claude Opus 4.8
/**
 * check-pm-drift.mjs — vendor-lock drift detector (pss-rg3).
 *
 * Compares the SHA-256 hashes of vendored Pod Manager source files (recorded
 * in vendor-lock.json) against the files currently on disk in the PM repo.
 * Exits 0 when everything matches, non-zero when any file has drifted.
 *
 * Usage:
 *   node scripts/check-pm-drift.mjs [--pm-dir <path>]
 *
 * Default PM dir: ../solid-pod-manager (sibling of this repo).
 * Override with --pm-dir or the PM_DIR env var.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Resolve PM dir from CLI arg, env, or sibling convention.
const pmDirArg = (() => {
  const idx = process.argv.indexOf("--pm-dir");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const pmDir = pmDirArg ?? process.env.PM_DIR ?? resolve(repoRoot, "../solid-pod-manager");

const lockPath = join(repoRoot, "vendor-lock.json");
if (!existsSync(lockPath)) {
  console.error("vendor-lock.json not found at", lockPath);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(lockPath, "utf8"));

if (!existsSync(pmDir)) {
  console.warn(`PM dir not found: ${pmDir}`);
  console.warn("Set --pm-dir or PM_DIR to the Pod Manager checkout path.");
  console.warn("Skipping drift check (CI without sibling checkout).");
  process.exit(0);
}

let drifted = 0;
let ok = 0;
let skipped = 0;

for (const entry of lock.files) {
  const pmFile = join(pmDir, entry.src);
  if (!existsSync(pmFile)) {
    console.warn(`  SKIP  ${entry.src}  (file not found in PM repo — may have been moved)`);
    skipped++;
    continue;
  }
  const contents = readFileSync(pmFile);
  const hash = createHash("sha256").update(contents).digest("hex");
  if (hash === entry.sha256) {
    console.log(`  OK    ${entry.src}`);
    ok++;
  } else {
    console.error(`  DRIFT ${entry.src}`);
    console.error(`        locked: ${entry.sha256}`);
    console.error(`        actual: ${hash}`);
    if (entry.note) console.error(`        note:   ${entry.note}`);
    drifted++;
  }
}

console.log(`\n${ok} unchanged, ${drifted} drifted, ${skipped} skipped`);
if (drifted > 0) {
  console.error(
    "\nDrift detected — review the PM changes and apply the relevant delta to the vendored copies in solid-issues.",
  );
  process.exit(1);
}
if (skipped > 0) {
  console.warn("Some files were skipped (missing from PM repo). Verify manually.");
}
