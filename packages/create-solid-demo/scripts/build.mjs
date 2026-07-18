#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
/**
 * build.mjs — the EXPLICIT packaging build (roborev 5646/5648 High):
 *
 *  1. The published executable is COMPILED JAVASCRIPT: `dist/bin.mjs`, an esbuild
 *     bundle of src/bin.ts. Node does not type-strip inside node_modules, so a
 *     published TS bin would fail under npx.
 *  2. This is a plain `build` script, NEVER a `prepack`/`prepare` hook: the suite
 *     `.npmrc` sets `ignore-scripts=true`, which would silently drop a hook-built
 *     dist/ from the tarball. The mirror-publish flow runs the package build
 *     explicitly before publishing; local `npm pack` runs it via `pnpm --filter
 *     create-solid-demo build` (the packed-bin test does exactly that).
 *
 * After bundling it verifies the tarball inputs: dist/bin.mjs present + shebang'd,
 * template present with the dotfile shims (npmrc/gitignore/env.example/github)
 * and WITHOUT the literal dotfiles npm pack would strip, and no artefact leaks.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = (message) => {
  process.stderr.write(`✗ build: ${message}\n`);
  process.exit(1);
};

// ---- 1. Bundle the bin (compiled JS, single file, node builtins external). ----
rmSync(join(pkgRoot, "dist"), { force: true, recursive: true });
const esbuild = spawnSync(
  "pnpm",
  [
    "exec",
    "esbuild",
    "src/bin.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    "--outfile=dist/bin.mjs",
    "--log-level=warning",
  ],
  { cwd: pkgRoot, stdio: "inherit" },
);
if (esbuild.status !== 0) fail("esbuild bundle failed");

const binPath = join(pkgRoot, "dist", "bin.mjs");
if (!existsSync(binPath)) fail("dist/bin.mjs missing after bundle");
const bin = readFileSync(binPath, "utf8");
if (!bin.startsWith("#!/usr/bin/env node")) fail("dist/bin.mjs must start with the node shebang");
// The bundle must be self-contained: only node builtin imports may remain.
const externalImport = /\bfrom\s*"(?!node:)[^".][^"]*"/.exec(bin);
if (externalImport !== null) fail(`dist/bin.mjs has a non-builtin import: ${externalImport[0]}`);
chmodSync(binPath, 0o755);

// ---- 2. Verify the bundled template ships publish-safe. ----
const templateDir = join(pkgRoot, "template");
if (!existsSync(join(templateDir, "package.json"))) {
  fail("bundled template/ is missing its root package.json");
}

// Each entry: [shim, real dotfile, content-line regex proving the shim is real].
const shims = [
  ["npmrc", ".npmrc", /^\s*ignore-scripts\s*=\s*true\s*$/m],
  ["gitignore", ".gitignore", /^\s*\.env\*?\s*$/m],
  ["env.example", ".env.example", /^__CSD_ENV_PREFIX___TRUSTED_OIDC_ISSUERS=/m],
];
for (const [shim, dotfile, contentRe] of shims) {
  const shimPath = join(templateDir, shim);
  if (!existsSync(shimPath))
    fail(`template/${shim} shim missing (renamed to ${dotfile} at scaffold time)`);
  if (!contentRe.test(readFileSync(shimPath, "utf8"))) {
    fail(`template/${shim} lost its real ${dotfile} content line`);
  }
  if (existsSync(join(templateDir, dotfile))) {
    fail(`template/${dotfile} must not exist — npm pack strips it; ship the ${shim} shim only`);
  }
}
if (!existsSync(join(templateDir, "github", "workflows", "ci.yml"))) {
  fail("template/github/workflows/ci.yml shim missing (renamed to .github at scaffold time)");
}
if (existsSync(join(templateDir, ".github"))) {
  fail("template/.github must not exist — ship the github/ shim only");
}

// Artefacts must never ride in the tarball.
for (const artefact of ["node_modules", ".next", ".turbo"]) {
  if (existsSync(join(templateDir, artefact))) fail(`template/${artefact} must not be bundled`);
}
// The walkthrough document is GENERATED per scaffold — a committed one would shadow it.
if (existsSync(join(templateDir, "apps", "tour", "content", "walkthrough.json"))) {
  fail("template must not carry a walkthrough.json — the scaffolder generates it");
}

process.stdout.write("✔ build: dist/bin.mjs bundled + template verified publish-safe\n");
