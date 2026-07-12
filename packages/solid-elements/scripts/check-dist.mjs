// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// check:dist — drift guard. `dist/` is COMMITTED (so the package is
// GitHub-installable under `ignore-scripts=true` with no build step). This
// guards against `dist/` drifting from `src/`: it builds into a FRESH temporary
// output directory and fails if the committed `dist/` differs. Run in the gate + CI.
//
// Design notes (each learned from review):
//   - Build into a TEMP dir, never into the committed `dist/`. A fresh temp dir
//     has no leftover outputs, so a deleted/renamed source module's stale
//     `.js`/`.d.ts` cannot survive into the comparison and mask drift (tsc does
//     not prune removed outputs). And because the committed `dist/` is never
//     touched, a build FAILURE leaves the working tree intact (no destructive
//     delete-then-fail window).
//   - The compiler is launched as `process.execPath` (this Node binary) running
//     the LOCAL `typescript/bin/tsc` script, via `execFileSync` with an argv
//     array (no shell). This is fully cross-platform: it does NOT depend on the
//     `npx`/`npx.cmd` shim (which `shell:false` can't launch on Windows), and
//     the temp path is a discrete argv element, so no shell quoting/expansion
//     hazard regardless of what `tmpdir()` (TMPDIR/TMP/TEMP) resolves to.
//   - The directory comparison is done in pure Node (no external `diff`), so the
//     check has zero external-binary/shell dependencies and runs identically on
//     every platform.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const require = createRequire(import.meta.url);
// The local TypeScript compiler entry script (a Node program) — resolved from
// the installed `typescript` dependency, never via the `npx` shim.
const tscBin = require.resolve("typescript/bin/tsc");
const freshDir = mkdtempSync(join(tmpdir(), "jeswr-solid-elements-dist-"));

/** Sorted relative paths of every FILE under `dir` (recursive). */
function listFiles(dir) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(relative(dir, child));
    }
  };
  walk(dir);
  return out.sort();
}

/** Diff two directories by file set + byte content; returns a list of differences. */
function diffDirs(a, b) {
  const aFiles = listFiles(a);
  const bFiles = listFiles(b);
  const diffs = [];
  const aSet = new Set(aFiles);
  const bSet = new Set(bFiles);
  for (const f of aFiles) if (!bSet.has(f)) diffs.push(`only in committed dist/: ${f}`);
  for (const f of bFiles) if (!aSet.has(f)) diffs.push(`only in fresh build: ${f}`);
  for (const f of aFiles) {
    if (!bSet.has(f)) continue;
    const ab = readFileSync(join(a, f));
    const bb = readFileSync(join(b, f));
    if (!ab.equals(bb)) diffs.push(`content differs: ${f}`);
  }
  return diffs;
}

try {
  // Build into the FRESH temp dir (overriding outDir) — the committed dist/ is
  // never modified, so a build failure here is non-destructive. argv array, no shell.
  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.build.json", "--outDir", freshDir], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  // Compare the committed dist/ against the fresh build (pure Node, no `diff`).
  const diffs = diffDirs(dist, freshDir);
  if (diffs.length > 0) {
    console.error("\n[check:dist] FAIL — committed dist/ differs from a fresh build.");
    console.error("Run `npm run build` and commit the result.\n");
    for (const d of diffs) console.error(`  - ${d}`);
    // Set the exit code and fall through naturally so the `finally` still runs
    // (a bare `process.exit(1)` would terminate immediately and SKIP the temp
    // dir cleanup below). The process exits non-zero once the script ends.
    process.exitCode = 1;
  } else {
    console.log("[check:dist] OK — committed dist/ matches a fresh build.");
  }
} finally {
  rmSync(freshDir, { recursive: true, force: true });
}
