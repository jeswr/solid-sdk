// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the COMMITTED `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch with no build step — consumers run under `ignore-scripts=true` and
 * never execute this package's `prepare`/`build`. That only stays correct if the
 * committed artifact matches the source. This script rebuilds into a scratch dir
 * (the SAME bundled build as `npm run build` — esbuild bundles + inlines, tsc
 * emits the `.d.ts`) and diffs the emitted JavaScript + declarations against the
 * version of `dist/` at git HEAD.
 *
 * Why compare against git HEAD, not the working-tree `dist/`:
 *  - `npm run build` overwrites the working-tree `dist/`. If this check read the
 *    working tree, then running it AFTER `build` would compare a fresh build
 *    against a just-overwritten fresh build — always equal, so a STALE *committed*
 *    `dist/` would never be caught. Comparing against the blobs at
 *    `HEAD:dist/<path>` makes the check independent of whether `build` ran first
 *    and of the working tree's state. (Before the first commit there is no HEAD
 *    dist/ — the check reports everything as "missing in committed dist/", which
 *    correctly tells you to build + commit it.)
 *
 * It deliberately ignores `*.map` sourcemaps: their byte content can vary with
 * absolute paths / tooling versions and they are not load-bearing for a consumer.
 * Code (`.js`) and types (`.d.ts`) matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * `execFileSync` buffers child output in memory with a 1 MiB default. The committed
 * dist inlines shacl-form + the RDF stack into a ~1.1 MiB chunk, so `git show` of
 * it exceeds the default and throws ENOBUFS. Raise the cap well past any committed
 * artifact so the comparison reads the whole blob.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Recursively list relative paths of `.js`/`.d.ts` files under `dir` (no maps). */
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

/** The `.js`/`.d.ts` keys committed under `dist/` at git HEAD (relative to dist/). */
function committedDistKeysAtHead() {
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "dist"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
  } catch {
    return []; // no HEAD yet (pre-first-commit) — nothing committed.
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((p) => /\.(js|d\.ts)$/.test(p) && !p.endsWith(".map"))
    .map((p) => p.replace(/^dist\//, ""));
}

/**
 * Read a committed `dist/<key>` blob from git HEAD, or `null` if genuinely absent.
 *
 * IMPORTANT: only an actual "path does not exist in HEAD" git error maps to `null`.
 * Any OTHER failure (e.g. an `ENOBUFS` buffer overflow on a large inlined chunk —
 * this bit us: the 1.1 MB esbuild chunk blew the 1 MB execFileSync default and was
 * silently reported "missing") is RE-THROWN, so a tooling failure can never
 * masquerade as drift. `maxBuffer` is raised well past the largest committed
 * artifact for the same reason.
 */
function readCommittedDist(key) {
  try {
    return execFileSync("git", ["show", `HEAD:dist/${key}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    // git prints "fatal: path '…' does not exist" / "exists on disk, but not in
    // 'HEAD'" with exit status 128 when the blob is absent — that is a genuine
    // "missing" (→ null). Distinguish it from any other failure by the message.
    const stderr = String(error?.stderr ?? error?.message ?? "");
    if (/does not exist|exists on disk, but not in/i.test(stderr)) return null;
    throw error; // a real tooling failure (ENOBUFS, git missing, …) — surface it.
  }
}

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "solid-components-dist-"));
  const freshDist = join(scratch, "dist");
  execFileSync(process.execPath, [join(root, "scripts", "build-dist.mjs"), freshDist], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

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
