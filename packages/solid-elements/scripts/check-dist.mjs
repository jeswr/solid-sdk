// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// check:dist — drift guard. `dist/` is COMMITTED (so the package is
// GitHub-installable under `ignore-scripts=true` with no build step). This
// guards against `dist/` drifting from `src/`: it rebuilds into a temp checkout
// of dist and fails if the committed output differs. Run in the gate + CI.
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const backup = join(root, ".dist-check-backup");

rmSync(backup, { recursive: true, force: true });
cpSync(dist, backup, { recursive: true });

try {
  // Clear dist/ BEFORE rebuilding so stale outputs from a deleted/renamed source
  // module cannot survive into the rebuild and mask drift (a committed-but-orphan
  // .js/.d.ts would otherwise be present in BOTH the backup and the rebuild, so
  // `diff -r` would not flag it). tsc does not prune removed files on its own.
  rmSync(dist, { recursive: true, force: true });
  execSync("npm run build", { cwd: root, stdio: "inherit" });
  // Compare freshly-built dist against the committed snapshot.
  try {
    execSync(`diff -r "${backup}" "${dist}"`, { stdio: "pipe" });
  } catch (e) {
    console.error("\n[check:dist] FAIL — committed dist/ differs from a fresh build.");
    console.error("Run `npm run build` and commit the result.\n");
    console.error(String(e.stdout ?? ""));
    process.exit(1);
  }
  console.log("[check:dist] OK — committed dist/ matches a fresh build.");
} finally {
  rmSync(backup, { recursive: true, force: true });
}
