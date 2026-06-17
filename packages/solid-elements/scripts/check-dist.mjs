// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// check:dist — drift guard. `dist/` is COMMITTED (so the package is
// GitHub-installable under `ignore-scripts=true` with no build step). This
// guards against `dist/` drifting from `src/`: it builds into a FRESH temporary
// output directory and fails if the committed `dist/` differs. Run in the gate + CI.
//
// Design notes (both learned from review):
//   - Build into a TEMP dir, never into the committed `dist/`. A fresh temp dir
//     has no leftover outputs, so a deleted/renamed source module's stale
//     `.js`/`.d.ts` cannot survive into the comparison and mask drift (tsc does
//     not prune removed outputs). And because the committed `dist/` is never
//     touched, a build FAILURE leaves the working tree intact (no destructive
//     delete-then-fail window).
//   - `diff -r` compares the committed snapshot against the fresh build.
//   - Both child processes are spawned via `execFileSync` with an ARGUMENT
//     ARRAY (no shell). The temp dir comes from `tmpdir()`, which honours
//     `TMPDIR`/`TMP`/`TEMP`, so its path could contain shell-special characters;
//     passing it as a discrete argv element (never string-interpolated into a
//     shell command line) means no quoting/expansion hazard regardless of path.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const freshDir = mkdtempSync(join(tmpdir(), "jeswr-solid-elements-dist-"));

try {
  // Build into the FRESH temp dir (overriding outDir) — the committed dist/ is
  // never modified, so a build failure here is non-destructive. argv array, no shell.
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", freshDir], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  // Compare the committed dist/ against the fresh build. argv array, no shell.
  try {
    execFileSync("diff", ["-r", dist, freshDir], { stdio: "pipe", shell: false });
  } catch (e) {
    console.error("\n[check:dist] FAIL — committed dist/ differs from a fresh build.");
    console.error("Run `npm run build` and commit the result.\n");
    console.error(String(e.stdout ?? ""));
    process.exit(1);
  }
  console.log("[check:dist] OK — committed dist/ matches a fresh build.");
} finally {
  rmSync(freshDir, { recursive: true, force: true });
}
