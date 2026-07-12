// AUTHORED-BY GPT-5.6
// Build the pinned off-npm @jeswr/fetch-rdf dependency when pnpm's
// ignore-scripts policy leaves its dist/ absent. The monorepo has one root
// lockfile, so the exact source ref comes from this package's validated manifest
// pin rather than a removed per-package package-lock.json.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEP_DIR = join(ROOT, "node_modules", "@jeswr", "fetch-rdf");
const DEP_DIST = join(DEP_DIR, "dist", "index.js");
const FETCH_RDF_GIT = "https://github.com/jeswr/fetch-rdf.git";
const SPEC_PREFIX = "github:jeswr/fetch-rdf#";

function run(file, args, cwd) {
  execFileSync(file, args, { cwd, stdio: "inherit" });
}

function pinnedRef() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const spec = manifest.devDependencies?.["@jeswr/fetch-rdf"];
  const ref =
    typeof spec === "string" && spec.startsWith(SPEC_PREFIX)
      ? spec.slice(SPEC_PREFIX.length)
      : undefined;

  if (!ref || !/^[0-9a-f]{40}$/.test(ref)) {
    throw new Error("@jeswr/fetch-rdf must remain pinned to an exact 40-character Git SHA");
  }
  return ref;
}

function main() {
  if (existsSync(DEP_DIST)) {
    return;
  }
  if (!existsSync(DEP_DIR)) {
    throw new Error("@jeswr/fetch-rdf is not installed; run pnpm install first");
  }

  const ref = pinnedRef();
  const work = mkdtempSync(join(tmpdir(), "fetch-rdf-build-"));
  try {
    console.log(`[build-deps] building @jeswr/fetch-rdf at pinned commit ${ref}`);
    run("git", ["clone", FETCH_RDF_GIT, work]);
    run("git", ["checkout", "--quiet", ref], work);
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
    cpSync(join(work, "dist"), join(DEP_DIR, "dist"), { recursive: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
