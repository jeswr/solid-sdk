// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist — guard against the COMMITTED `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch without a build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source. This script rebuilds into a scratch
 * dir (the SAME plain `tsc` build as `npm run build` — `@jeswr/fetch-rdf` is a
 * NORMAL npm dependency resolved by the consumer, NOT inlined) and diffs the
 * emitted JavaScript + declarations against the version of `dist/` in the git
 * INDEX (the staged tree = what the next commit will contain).
 *
 * Why compare against the staged index, not the working tree nor HEAD:
 *  - `npm run build` overwrites the working-tree `dist/`. If this check read the
 *    working tree, then running it AFTER `build` would compare a fresh build
 *    against a just-overwritten fresh build — always equal, so a STALE *committed*
 *    `dist/` would never be caught.
 *  - Comparing against `HEAD:dist/` catches that but FALSE-FAILS mid-change: the
 *    working tree (and index, once staged) are correct, yet HEAD still holds the
 *    old `dist/`, so the gate stays red until after the commit lands.
 *  - The index blobs at `:dist/<path>` are exactly what the next commit will
 *    contain, so the check BOTH catches a stale staged `dist/` AND passes as soon
 *    as the freshly-built `dist/` is `git add`-ed — independent of whether `build`
 *    ran first and of the working tree's state.
 *
 * It deliberately ignores the `*.map` sourcemap files: their byte content can
 * vary with absolute paths / tooling versions, and they are not load-bearing for
 * a consumer importing the package. Code (`.js`) and types (`.d.ts`) matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function listArtifacts(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(js|d\.ts)$/.test(entry.name) && !entry.name.endsWith(".map")) {
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

function stagedDistKeys() {
  const out = execFileSync("git", ["ls-files", "--", "dist"], {
    cwd: root,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((p) => /\.(js|d\.ts)$/.test(p) && !p.endsWith(".map"))
    .map((p) => p.replace(/^dist\//, ""));
}

function readStagedDist(key) {
  try {
    return execFileSync("git", ["show", `:dist/${key}`], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "solid-drawing-dist-"));
  const freshDist = join(scratch, "dist");
  execFileSync(
    "node",
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(root, "tsconfig.build.json"),
      "--outDir",
      freshDist,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );

  const freshFiles = new Map(listArtifacts(freshDist).map((p) => [toKey(freshDist, p), p]));
  const stagedKeys = new Set(stagedDistKeys());

  const drift = [];
  for (const [key, freshPath] of freshFiles) {
    const staged = readStagedDist(key);
    if (staged === null) {
      drift.push(`missing in staged dist/: ${key}`);
      continue;
    }
    if (readFileSync(freshPath, "utf8") !== staged) {
      drift.push(`out of date: ${key}`);
    }
  }
  for (const key of stagedKeys) {
    if (!freshFiles.has(key)) {
      drift.push(`stale (no longer emitted): dist/${key}`);
    }
  }

  if (drift.length > 0) {
    console.error("staged dist/ is out of sync with src/:");
    for (const d of drift) {
      console.error(`  - ${d}`);
    }
    console.error("\nRun `npm run build` and `git add dist/`.");
    process.exit(1);
  }
  console.log(`staged dist/ matches src/ (${freshFiles.size} artifacts).`);
} finally {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
  }
}
