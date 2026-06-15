// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the committed `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch without a build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source. This script rebuilds into a scratch
 * dir and diffs the EMITTED JavaScript + declarations against committed `dist/`.
 *
 * It deliberately ignores the `*.map` sourcemap files: their byte content can vary
 * with absolute paths / tooling versions, and they are not load-bearing for a
 * consumer importing the package. Code (`.js`) and types (`.d.ts`) are what matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const committedDist = join(root, "dist");

/** Recursively list relative paths of `.js`/`.d.ts` files under `dir`. */
function listArtifacts(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (
        /\.(js|d\.ts)$/.test(entry.name) &&
        !entry.name.endsWith(".map")
      ) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

function toKey(base, abs) {
  return relative(base, abs).split(sep).join("/");
}

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "san-dist-"));
  const freshDist = join(scratch, "dist");
  // Rebuild into a scratch outDir using the build tsconfig.
  execFileSync(
    "npx",
    ["tsc", "-p", "tsconfig.build.json", "--outDir", freshDist],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
  );

  const freshFiles = new Map(
    listArtifacts(freshDist).map((p) => [toKey(freshDist, p), p])
  );
  const committedFiles = new Map(
    statSync(committedDist, { throwIfNoEntry: false })
      ? listArtifacts(committedDist).map((p) => [toKey(committedDist, p), p])
      : []
  );

  const drift = [];
  for (const [key, freshPath] of freshFiles) {
    const committedPath = committedFiles.get(key);
    if (!committedPath) {
      drift.push(`missing in committed dist/: ${key}`);
      continue;
    }
    if (
      readFileSync(freshPath, "utf8") !== readFileSync(committedPath, "utf8")
    ) {
      drift.push(`out of date: ${key}`);
    }
  }
  for (const key of committedFiles.keys()) {
    if (!freshFiles.has(key))
      drift.push(`stale (no longer emitted): dist/${key}`);
  }

  if (drift.length > 0) {
    console.error("committed dist/ is out of sync with src/:");
    for (const d of drift) console.error(`  - ${d}`);
    console.error("\nRun `npm run build` and commit dist/.");
    process.exit(1);
  }
  console.log(`committed dist/ matches src/ (${freshFiles.size} artifacts).`);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
