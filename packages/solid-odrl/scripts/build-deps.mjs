// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Inline dependency build for `@jeswr/fetch-rdf` — the suite's `build:packages`
// pattern. Because the suite pins `ignore-scripts=true` (supply-chain hardening),
// the git/npm dependency's own `prepare` build never runs, and the published
// tarball / git pack of `@jeswr/fetch-rdf@0.1.0` ships NO `dist/` (a known
// upstream packaging gap — its `files` is `["dist","README.md"]` but `dist/` is
// absent at pack time). So we build it ourselves, once, after install: clone the
// source, compile it with the local TypeScript, and drop the built `dist/` into
// `node_modules/@jeswr/fetch-rdf`.
//
// REPRODUCIBILITY: the clone is pinned to the EXACT git commit resolved in the
// workspace `pnpm-lock.yaml` (not a moving `main`), so every workspace build uses
// the same source. Building from `main` would silently drift from the lockfile.
//
// DURABLE FIX: this whole `build:deps` hack exists ONLY because
// `@jeswr/fetch-rdf` does not publish a usable `dist/`. Once fetch-rdf ships a
// proper packaged `dist` (the upstream packaging fix), DELETE this script and the
// `build:deps` step entirely and depend on the published package directly.
//
// Idempotent: if `dist/index.js` is already present (e.g. a workspace symlink or
// a prior run) this is a no-op. Network is needed only the first time.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEP_DIR = join(ROOT, "node_modules", "@jeswr", "fetch-rdf");
const DEP_DIST = join(DEP_DIR, "dist", "index.js");
const LOCKFILE = join(ROOT, "..", "..", "pnpm-lock.yaml");
const LOCKFILE_IMPORTER = "packages/solid-odrl";
const FETCH_RDF_GIT = "https://github.com/jeswr/fetch-rdf.git";

/**
 * Run a command via `execFileSync` (NO shell) so an argument (e.g. a ref read
 * from the lockfile) can never be interpreted as shell syntax — a command-
 * injection hardening. `args` are passed as a literal argv, not concatenated into
 * a shell string.
 */
function run(file, args, cwd) {
  execFileSync(file, args, { cwd, stdio: "inherit" });
}

/**
 * Read the exact git commit used by this package's workspace importer. Scoping
 * the lookup to the importer prevents another package's independent fetch-rdf
 * revision from making this build ambiguous or selecting the wrong source.
 */
function resolvedFetchRdfRef() {
  if (!existsSync(LOCKFILE)) {
    return undefined;
  }
  let lock;
  try {
    lock = readFileSync(LOCKFILE, "utf8");
  } catch {
    return undefined;
  }
  const lines = lock.split("\n");
  const importerStart = lines.indexOf(`  ${LOCKFILE_IMPORTER}:`);
  if (importerStart === -1) {
    return undefined;
  }
  const importerLines = [];
  for (const line of lines.slice(importerStart + 1)) {
    if (/^ {2}\S/.test(line)) {
      break;
    }
    importerLines.push(line);
  }
  const refs = [
    ...importerLines
      .join("\n")
      .matchAll(/codeload\.github\.com\/jeswr\/fetch-rdf\/tar\.gz\/([0-9a-f]{40})/g),
  ].map((match) => match[1]);
  const uniqueRefs = [...new Set(refs)];
  if (uniqueRefs.length !== 1) {
    return undefined;
  }
  return uniqueRefs[0];
}

function main() {
  if (existsSync(DEP_DIST)) {
    return; // already built (or workspace-symlinked) — nothing to do.
  }
  if (!existsSync(DEP_DIR)) {
    console.error("[build-deps] @jeswr/fetch-rdf is not installed. Run `npm install` first.");
    process.exit(1);
  }

  const ref = resolvedFetchRdfRef();
  if (!ref) {
    console.error(
      `[build-deps] could not resolve one valid @jeswr/fetch-rdf commit for ${LOCKFILE_IMPORTER} ` +
        "from pnpm-lock.yaml; refusing a non-reproducible build. Run `pnpm install`.",
    );
    process.exit(1);
  }

  console.log(
    `[build-deps] building @jeswr/fetch-rdf dist at pinned commit ${ref} (ignore-scripts skipped its prepare)…`,
  );
  const work = mkdtempSync(join(tmpdir(), "fetch-rdf-build-"));
  try {
    // Clone then check out the EXACT lockfile-resolved commit (deterministic).
    // A bare `git clone` (no --depth) so an arbitrary commit SHA is fetchable;
    // we then detach onto the pinned ref. All commands run via execFileSync (NO
    // shell) so the ref / paths are literal argv, never shell-interpreted.
    run("git", ["clone", FETCH_RDF_GIT, work]);
    run("git", ["checkout", "--quiet", ref], work);
    // Build with this repo's TypeScript so no extra toolchain is needed.
    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline"],
      work,
    );
    run(
      "node",
      [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
      work,
    );

    // Copy the built dist (and src, for source maps) into the installed package.
    cpSync(join(work, "dist"), join(DEP_DIR, "dist"), { recursive: true });
    if (existsSync(join(work, "src"))) {
      cpSync(join(work, "src"), join(DEP_DIR, "src"), { recursive: true });
    }
    // Ensure the package.json `files` allowance does not hide the dist we just
    // copied from Node's resolver (it resolves by `main`, so this is belt-and-braces).
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
