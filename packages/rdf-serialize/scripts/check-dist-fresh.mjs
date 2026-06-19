// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the committed `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch without a build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source.
 *
 * Unlike the suite packages that bundle an off-npm dep (e.g. @jeswr/solid-vc
 * inlines @jeswr/fetch-rdf via esbuild), this package depends ONLY on the
 * npm-published `n3` + `@rdfjs/types`, so its `dist/` is a plain `tsc` build with
 * no inlining.
 *
 * The check operates on the STAGED tree (the git index) — i.e. exactly the tree
 * that is about to be committed — in BOTH directions, so it is independent of the
 * unstaged working tree:
 *  - It snapshots the index with `git write-tree`, materialises the STAGED `src/`
 *    + tsconfigs + package.json from that tree via `git archive <tree> | tar -x`
 *    into a scratch checkout (symlinking node_modules for module resolution),
 *    builds THAT with `tsc -p tsconfig.build.json`, and
 *  - diffs the emitted JavaScript + declarations against the STAGED `dist/`
 *    blobs (`git show :dist/<path>` reads the index, not the working tree).
 *
 * Why the staged/index tree (not the working tree, not plain HEAD):
 *  - The property that keeps the GitHub-installable artifact correct is "does the
 *    `dist/` that will be committed match a fresh build of the `src/` that will be
 *    committed?". The git index IS that tree, so checking it answers exactly that
 *    question for the commit being prepared.
 *  - Reading the working-tree `dist/` would make a post-`build` run always equal
 *    (it just overwrote the working tree), so a stale *to-be-committed* `dist/`
 *    would never be caught; and building from the working-tree `src/` would FALSE
 *    POSITIVE on legitimate unstaged-and-uncommitted `src/` edits (the normal
 *    "still editing" state) — both wrong (the two roborev findings this resolves).
 *  - Plain HEAD would MISS a commit-in-preparation that stages a `src/` change but
 *    forgets to re-stage `dist/`: HEAD still agrees with itself. The index does
 *    not — it carries the staged `src/` against the (unchanged) staged `dist/`, so
 *    the drift is caught before the commit lands. After committing, the index
 *    equals HEAD, so a post-commit re-run is consistent.
 *
 * It deliberately ignores the `*.map` sourcemap files: their byte content can
 * vary with absolute paths / tooling versions (the scratch outDir differs from
 * the committed build's cwd), and they are not load-bearing for a consumer
 * importing the package. Code (`.js`) and types (`.d.ts`) are what matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and stage/commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Recursively list relative paths of emitted `.js`/`.d.ts` files under `dir`,
 * skipping `*.map` sourcemaps (vary with absolute paths, not load-bearing).
 */
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

/**
 * Snapshot the current git index as a tree object and return its SHA. Operates
 * on the STAGED tree without mutating HEAD or the working directory.
 */
function writeIndexTree() {
  return execFileSync("git", ["write-tree"], { cwd: root, encoding: "utf8" }).trim();
}

/**
 * The set of `.js`/`.d.ts` artifacts under `dist/` in the given tree, keyed by
 * their path RELATIVE to `dist/` (matching `toKey(freshDist, …)`).
 */
function distKeysInTree(tree) {
  const out = execFileSync("git", ["ls-tree", "-r", "--name-only", tree, "dist"], {
    cwd: root,
    encoding: "utf8",
  });
  return (
    out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((p) => /\.(js|d\.ts)$/.test(p) && !p.endsWith(".map"))
      // Strip the leading `dist/` so the key matches the fresh-build relative key.
      .map((p) => p.replace(/^dist\//, ""))
  );
}

/**
 * Read a STAGED `dist/<key>` blob from the git index, or `null` if absent.
 * `git show :<path>` reads stage 0 of the index (the to-be-committed content).
 */
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
  const indexTree = writeIndexTree();

  scratch = mkdtempSync(join(tmpdir(), "rdf-serialize-dist-"));
  // Materialise the STAGED src/ + tsconfigs + package.json from the index tree
  // into the scratch checkout, so the build input is the to-be-committed tree,
  // not the unstaged working tree. `git archive <tree> <paths> | tar -x` writes
  // the staged blobs verbatim. package.json is REQUIRED: with `module: nodenext`,
  // tsc derives the emitted module format (ESM vs CJS) from the nearest
  // package.json `"type"` — omit it and the scratch build wrongly emits CommonJS,
  // spuriously failing the check.
  const archive = execFileSync(
    "git",
    ["archive", indexTree, "src", "tsconfig.json", "tsconfig.build.json", "package.json"],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync("tar", ["-x", "-C", scratch], { input: archive });

  // tsc needs `n3` / `@rdfjs/types` to emit declarations; symlink this repo's
  // node_modules into the scratch checkout so module resolution succeeds.
  symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), "dir");

  const freshDist = join(scratch, "dist");
  // Build the staged src with the SAME plain-tsc pipeline `npm run build` uses
  // (`tsc -p tsconfig.build.json`), from the scratch checkout, into dist/. The
  // toolchain (typescript) is resolved from THIS repo's node_modules.
  execFileSync(
    "node",
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(scratch, "tsconfig.build.json"),
      "--outDir",
      freshDist,
    ],
    {
      cwd: scratch,
      stdio: ["ignore", "ignore", "inherit"],
    },
  );

  const freshFiles = new Map(listArtifacts(freshDist).map((p) => [toKey(freshDist, p), p]));
  const stagedKeys = new Set(distKeysInTree(indexTree));

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
    console.error("\nRun `npm run build` and stage dist/ (git add dist).");
    process.exit(1);
  }
  console.log(`staged dist/ matches src/ (${freshFiles.size} artifacts).`);
} finally {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
  }
}
