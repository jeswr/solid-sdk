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
// Idempotent: if `dist/index.js` is already present (e.g. a workspace symlink or
// a prior run) this is a no-op. Network is needed only the first time.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEP_DIR = join(ROOT, "node_modules", "@jeswr", "fetch-rdf");
const DEP_DIST = join(DEP_DIR, "dist", "index.js");
const FETCH_RDF_GIT = "https://github.com/jeswr/fetch-rdf.git";

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function main() {
  if (existsSync(DEP_DIST)) {
    return; // already built (or workspace-symlinked) — nothing to do.
  }
  if (!existsSync(DEP_DIR)) {
    console.error(
      "[build-deps] @jeswr/fetch-rdf is not installed. Run `npm install` first.",
    );
    process.exit(1);
  }

  console.log("[build-deps] building @jeswr/fetch-rdf dist (ignore-scripts skipped its prepare)…");
  const work = mkdtempSync(join(tmpdir(), "fetch-rdf-build-"));
  try {
    run(`git clone --depth 1 ${FETCH_RDF_GIT} "${work}"`);
    // Build with this repo's TypeScript so no extra toolchain is needed.
    run("npm install --no-audit --no-fund --ignore-scripts --prefer-offline", work);
    run(`node "${join(ROOT, "node_modules", "typescript", "bin", "tsc")}" -p tsconfig.json`, work);

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
