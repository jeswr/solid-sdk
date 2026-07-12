// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the COMMITTED `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch with NO build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source.
 *
 * This package has NO bundled off-npm dependency, so the build is a plain `tsc`
 * (unlike federation-client, which must esbuild-inline `@jeswr/fetch-rdf`). The
 * check therefore rebuilds with `tsc` into a scratch outDir and diffs the
 * emitted `.js` + `.d.ts` against the blobs committed at git HEAD (`*.map`
 * ignored — they vary with absolute paths and are not load-bearing).
 *
 * Why compare against git HEAD, not the working tree: `npm run build` overwrites
 * the working-tree `dist/`, so reading the working tree after a build would
 * always compare equal and never catch a STALE committed dist/. Comparing the
 * committed blobs answers "does what's committed match a fresh build of the
 * committed src?" — the property that keeps the GitHub-installable artifact correct.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit dist/).
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

function committedDistKeysAtHead() {
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "dist"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return new Set(); // no committed dist/ yet (first build) → all fresh files are "missing"
  }
  return new Set(
    out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((p) => /\.(js|d\.ts)$/.test(p) && !p.endsWith(".map"))
      .map((p) => p.replace(/^dist\//, "")),
  );
}

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
  scratch = mkdtempSync(join(tmpdir(), "scf-dist-"));
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
  const committedKeys = committedDistKeysAtHead();

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
