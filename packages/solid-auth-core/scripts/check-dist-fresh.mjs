#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
// (Adapted from @jeswr/unstorage-solid's check-dist-fresh — same contract.)
/**
 * check-dist-fresh — guard against the COMMITTED `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch without a build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source. This script rebuilds into a scratch
 * dir (the SAME bundled build as `npm run build`) and diffs the emitted
 * JavaScript + declarations against the version of `dist/` at git HEAD.
 *
 * Why compare against git HEAD, not the working-tree `dist/`: `npm run build`
 * overwrites the working tree, so a working-tree comparison after `build` would
 * always be equal and a STALE *committed* dist would never be caught.
 *
 * ADDITIONALLY (this package's self-containment contract): no emitted `.d.ts`
 * may reference the inlined off-npm `@jeswr/solid-session-restore` — a GitHub
 * consumer does not have it installed, so a type-level reference would break
 * `tsc` for them even though the bundled JS works.
 *
 * `*.map` sourcemaps are ignored (path/tooling-variant, not load-bearing).
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Recursively list `.js`/`.d.ts` artifact paths under `dir` (skipping maps). */
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

/** Committed `dist/` artifact keys at git HEAD (never the working copy). */
function committedDistKeysAtHead() {
  const out = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "dist"], {
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

/** Read a committed `dist/<key>` blob from git HEAD, or `null` if absent. */
function readCommittedDist(key) {
  try {
    return execFileSync("git", ["show", `HEAD:dist/${key}`], { cwd: root, encoding: "utf8" });
  } catch {
    return null;
  }
}

const scratch = mkdtempSync(join(tmpdir(), "solid-auth-core-dist-"));
let failed = false;
try {
  execFileSync("node", [join(root, "scripts", "build-dist.mjs"), scratch], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const fresh = listArtifacts(scratch);
  const freshKeys = new Set(fresh.map((p) => toKey(scratch, p)));
  const committedKeys = new Set(committedDistKeysAtHead());

  for (const abs of fresh) {
    const key = toKey(scratch, abs);
    const freshContent = readFileSync(abs, "utf8");
    // Self-containment: no d.ts may IMPORT from the inlined off-npm package
    // (doc-comment mentions are fine — only a resolvable type reference breaks
    // a consumer's tsc).
    if (
      key.endsWith(".d.ts") &&
      /(from\s*"@jeswr\/solid-session-restore"|import\("@jeswr\/solid-session-restore"\))/.test(
        freshContent,
      )
    ) {
      console.error(
        `check:dist FAIL — dist/${key} references @jeswr/solid-session-restore ` +
          "(inlined off-npm dep; a GitHub consumer has no types for it). " +
          "Re-declare the leaked type locally in src/ instead.",
      );
      failed = true;
    }
    const committed = readCommittedDist(key);
    if (committed === null) {
      console.error(`check:dist FAIL — dist/${key} is missing from the committed dist at HEAD.`);
      failed = true;
    } else if (committed !== freshContent) {
      console.error(`check:dist FAIL — dist/${key} at HEAD differs from a fresh build.`);
      failed = true;
    }
  }
  for (const key of committedKeys) {
    if (!freshKeys.has(key)) {
      console.error(`check:dist FAIL — committed dist/${key} is no longer emitted by the build.`);
      failed = true;
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failed) {
  console.error("check:dist — run `npm run build` and commit the refreshed dist/.");
  process.exit(1);
}
console.log("check:dist OK — committed dist/ matches a fresh build and is self-contained.");
