// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the COMMITTED `dist/` drifting from `src/`.
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
 * The check is ENTIRELY HEAD-based, in BOTH directions, so it is independent of
 * the working tree:
 *  - It materialises the COMMITTED `src/` (+ the two tsconfigs) from git HEAD
 *    into a scratch checkout via `git archive HEAD`, builds THAT with
 *    `tsc -p tsconfig.build.json`, and
 *  - diffs the emitted JavaScript + declarations against the COMMITTED `dist/`
 *    blobs at `HEAD:dist/<path>`.
 *
 * Why HEAD-based on both sides (not the working tree):
 *  - The property that actually keeps the GitHub-installable artifact correct is
 *    "does the COMMITTED `dist/` match a fresh build of the COMMITTED `src/`?".
 *    Building from `HEAD:src` (not the working tree) means this check answers
 *    exactly that question and NOTHING else.
 *  - Reading the working-tree `dist/` would make a post-`build` run always equal
 *    (it just overwrote the working tree), so a STALE *committed* `dist/` would
 *    never be caught.
 *  - Building from the working-tree `src/` would make the check fail on
 *    legitimate UNCOMMITTED `src/` edits (the normal "preparing a commit" state),
 *    a false positive that would break the documented local workflow. Because the
 *    artifact is only ever published from a commit, gating against HEAD is both
 *    correct and ergonomic: edit src + dist freely, then commit src+dist together
 *    and this check confirms they agree at the commit that will be installed.
 *
 * It deliberately ignores the `*.map` sourcemap files: their byte content can
 * vary with absolute paths / tooling versions (the scratch outDir differs from
 * the committed build's cwd), and they are not load-bearing for a consumer
 * importing the package. Code (`.js`) and types (`.d.ts`) are what matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
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
 * The set of `.js`/`.d.ts` artifacts committed under `dist/` at git HEAD,
 * keyed by their path RELATIVE to `dist/` (matching `toKey(freshDist, …)`).
 * Uses `git ls-tree` so it reads the COMMITTED tree, never the working copy.
 */
function committedDistKeysAtHead() {
  const out = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "dist"], {
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
 * Read a committed `dist/<key>` blob from git HEAD, or `null` if absent.
 */
function readCommittedDist(key) {
  try {
    return execFileSync("git", ["show", `HEAD:dist/${key}`], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "rdf-serialize-dist-"));
  // Materialise the COMMITTED src/ + tsconfigs + package.json from git HEAD into
  // the scratch checkout, so the build input is the committed tree, not the
  // working tree. `git archive HEAD <paths> | tar -x` writes the blobs verbatim.
  // package.json is REQUIRED: with `module: nodenext`, tsc derives the emitted
  // module format (ESM vs CJS) from the nearest package.json `"type"` — omit it
  // and the scratch build wrongly emits CommonJS, spuriously failing the check.
  const archive = execFileSync(
    "git",
    ["archive", "HEAD", "src", "tsconfig.json", "tsconfig.build.json", "package.json"],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync("tar", ["-x", "-C", scratch], { input: archive });

  // tsc needs `n3` / `@rdfjs/types` to emit declarations; symlink this repo's
  // node_modules into the scratch checkout so module resolution succeeds.
  symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), "dir");

  const freshDist = join(scratch, "dist");
  // Build the committed src with the SAME plain-tsc pipeline `npm run build`
  // uses (`tsc -p tsconfig.build.json`), from the scratch checkout, into dist/.
  // The toolchain (typescript) is resolved from THIS repo's node_modules.
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
  const committedKeys = new Set(committedDistKeysAtHead());

  const drift = [];
  for (const [key, freshPath] of freshFiles) {
    const committed = readCommittedDist(key);
    if (committed === null) {
      drift.push(`missing in committed dist/: ${key}`);
      continue;
    }
    if (readFileSync(freshPath, "utf8") !== committed) {
      drift.push(`out of date: ${key}`);
    }
  }
  for (const key of committedKeys) {
    if (!freshFiles.has(key)) {
      drift.push(`stale (no longer emitted): dist/${key}`);
    }
  }

  if (drift.length > 0) {
    console.error("committed dist/ is out of sync with src/:");
    for (const d of drift) {
      console.error(`  - ${d}`);
    }
    console.error("\nRun `npm run build` and commit dist/.");
    process.exit(1);
  }
  console.log(`committed dist/ matches src/ (${freshFiles.size} artifacts).`);
} finally {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
  }
}
