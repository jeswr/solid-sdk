#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
/**
 * check-lockfile-transport.mjs — the #78 guard, adapted to pnpm-lock.yaml.
 *
 * Package-manager lockfile regeneration can rewrite a git dependency's resolved URL to
 * the SSH transport (git+ssh://), which breaks clean-checkout installs (no SSH key in
 * CI/consumers). This gate fails if any lockfile in the workspace references git+ssh.
 * Runs as part of `pnpm run lint`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockfiles = ["pnpm-lock.yaml", "package-lock.json"]
  .map((f) => join(repoRoot, f))
  .filter((p) => existsSync(p));

let bad = false;
for (const lf of lockfiles) {
  const lines = readFileSync(lf, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("git+ssh://")) {
      console.error(
        `${lf}:${i + 1}: git+ssh:// transport in lockfile — run the https fix before committing`,
      );
      bad = true;
    }
  });
}
if (bad) process.exit(1);
console.log(`check:lockfile-transport OK (${lockfiles.length} lockfile(s) scanned, no git+ssh://)`);
