// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ensure the off-npm `@jeswr` git dependencies have a usable `dist/` after a
// `ignore-scripts=true` install. `@jeswr/federation-trust` depends on three git
// deps:
//
//   - `@jeswr/solid-vc`            — commits a SELF-CONTAINED `dist/` (fetch-rdf
//                                     already inlined). Usable as-is.
//   - `@jeswr/federation-registry` — commits a SELF-CONTAINED `dist/` (fetch-rdf
//                                     already inlined). Usable as-is.
//   - `@jeswr/fetch-rdf`           — ships NO usable `dist/` (a known upstream
//                                     packaging gap: its `files` lists `dist` but
//                                     `dist/` is absent at pack time). It is a
//                                     devDependency we keep ONLY so a fresh build
//                                     of solid-vc/federation-registry (if ever done
//                                     from src) can resolve it; the committed dists
//                                     we consume already inline it, so at our build
//                                     time it is normally NOT needed. We build it
//                                     defensively IFF it is installed and unbuilt,
//                                     so a `build:dev`/source build never fails.
//
// REPRODUCIBILITY: the fetch-rdf clone is pinned to the EXACT git commit resolved
// in `package-lock.json` (not a moving `main`), so the built dep matches the
// lockfile — `npm ci` on CI and a dev `npm install` build identical source. A
// missing/invalid lockfile ref fails closed (a non-reproducible build is worse
// than a hard error).
//
// SECURITY: every command runs via `execFileSync` (NO shell) so the ref read from
// the lockfile / the clone paths are passed as a literal argv and can never be
// interpreted as shell syntax (command-injection hardening). The ref must be a
// bare 40-hex commit SHA — a defence-in-depth guard against a corrupted/malicious
// lockfile entry.
//
// Idempotent: if fetch-rdf's `dist/index.js` is already present (a prior run or a
// workspace symlink) this is a no-op. Network is needed only the first time.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEP_DIR = join(ROOT, "node_modules", "@jeswr", "fetch-rdf");
const DEP_DIST = join(DEP_DIR, "dist", "index.js");
const LOCKFILE = join(ROOT, "package-lock.json");
const FETCH_RDF_GIT = "https://github.com/jeswr/fetch-rdf.git";

/**
 * Run a command via `execFileSync` (NO shell) so an argument (e.g. a ref read from
 * the lockfile) can never be interpreted as shell syntax — command-injection
 * hardening. `args` are passed as a literal argv, not concatenated into a shell
 * string.
 */
function run(file, args, cwd) {
  execFileSync(file, args, { cwd, stdio: "inherit" });
}

/**
 * Read the EXACT git commit `@jeswr/fetch-rdf` resolves to from
 * `package-lock.json`, so the clone is pinned (reproducible) rather than tracking a
 * moving `main`. Requires a full 40-hex commit SHA — refusing anything else both
 * pins the build AND rejects a corrupted/malicious lockfile ref. Returns the SHA,
 * or `undefined` (caller then refuses to build) if it cannot be determined.
 */
function resolvedFetchRdfRef() {
  if (!existsSync(LOCKFILE)) {
    return undefined;
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCKFILE, "utf8"));
  } catch {
    return undefined;
  }
  const entry = lock.packages?.["node_modules/@jeswr/fetch-rdf"];
  const resolved = entry?.resolved;
  if (typeof resolved !== "string") {
    return undefined;
  }
  const hash = resolved.lastIndexOf("#");
  if (hash === -1) {
    return undefined;
  }
  const ref = resolved.slice(hash + 1).trim();
  // Require a full 40-hex git commit SHA (reproducible + injection-hardening).
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    return undefined;
  }
  return ref;
}

function main() {
  if (existsSync(DEP_DIST)) {
    return; // already built (or workspace-symlinked) — nothing to do.
  }
  if (!existsSync(DEP_DIR)) {
    // fetch-rdf is not installed: the committed dists of solid-vc /
    // federation-registry already inline it, so for our normal bundled build this
    // is fine — nothing to do.
    return;
  }

  const ref = resolvedFetchRdfRef();
  if (!ref) {
    console.error(
      "[build-deps] could not resolve a valid @jeswr/fetch-rdf git commit SHA from " +
        "package-lock.json; refusing to build from an unpinned/invalid source (a " +
        "non-reproducible build). Run `npm install` to (re)generate the lockfile.",
    );
    process.exit(1);
  }

  console.log(
    `[build-deps] building @jeswr/fetch-rdf dist at pinned commit ${ref} (ignore-scripts skipped its prepare)…`,
  );
  const work = mkdtempSync(join(tmpdir(), "fetch-rdf-build-"));
  try {
    // Clone then check out the EXACT lockfile-resolved commit (deterministic). All
    // commands run via execFileSync (NO shell) so the ref / paths are literal argv.
    run("git", ["clone", FETCH_RDF_GIT, work]);
    run("git", ["checkout", "--quiet", ref], work);
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline"], work);
    run("node", [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], work);

    cpSync(join(work, "dist"), join(DEP_DIR, "dist"), { recursive: true });
    if (existsSync(join(work, "src"))) {
      cpSync(join(work, "src"), join(DEP_DIR, "src"), { recursive: true });
    }
    const pkgPath = join(DEP_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.main = pkg.main ?? "./dist/index.js";
    pkg.types = pkg.types ?? "./dist/index.d.ts";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("[build-deps] @jeswr/fetch-rdf dist built.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
