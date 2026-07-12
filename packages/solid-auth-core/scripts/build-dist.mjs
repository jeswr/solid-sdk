#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-auth-core` depends on the OFF-NPM `@jeswr/solid-session-restore`
 * (github:-installed). A consumer running
 * `npm install github:jeswr/solid-auth-core#main` under the suite's
 * `ignore-scripts=true` invariant would not have it, so its compiled code is
 * INLINED into `dist/index.js` (it ships a committed dist of its own, so esbuild
 * resolves it directly). Its only runtime deps — `oauth4webapi` + `dpop` — are
 * ALREADY this package's own npm dependencies, so inlining adds no new external.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled): `@jeswr/solid-session-restore` ONLY — by virtue of
 *     being ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved by the consumer): every npm-published dependency —
 *     `oauth4webapi`, `dpop`, `n3`, `@jeswr/fetch-rdf`, `@solid/object` — plus
 *     the OPTIONAL PEER `react` (bundling a peer creates a second copy and
 *     breaks hooks/dedupe; the `/react` entry stays a thin layer).
 *   - The `/react` entry imports the core via the RELATIVE `../index.js`, which
 *     is kept EXTERNAL so both entries share ONE module instance at runtime
 *     (the pristine snapshot + the global-install singleton are module state).
 *
 * `tsc` emits the `.d.ts` declarations (declaration-only — esbuild owns the JS).
 * The committed `dist/` is kept in sync with `src/` by
 * `scripts/check-dist-fresh.mjs`, which ALSO asserts no emitted `.d.ts`
 * references the inlined off-npm package (a consumer has no types for it).
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assertDeclarationsSelfContained } from "./assert-declarations.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** Everything that must stay EXTERNAL (consumer-resolved, never inlined). */
const EXTERNAL = [
  "oauth4webapi",
  "dpop",
  "n3",
  "@jeswr/fetch-rdf",
  "@solid/object",
  // react is an OPTIONAL PEER — never bundle it (dual-copy breaks hooks).
  "react",
  "react/jsx-runtime",
];

async function main(buildDir = outdir) {
  rmSync(buildDir, { recursive: true, force: true });

  // The core entry: @jeswr/solid-session-restore is inlined (absent from EXTERNAL).
  await build({
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(buildDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // The /react entry: the core is reached through the RELATIVE ../index.js —
  // kept external so both dist entries share ONE core module instance (the
  // pristine snapshot + install singleton are module state, and bundling a
  // second copy of the engine would defeat the brand-unwrap guarantee).
  await build({
    entryPoints: [join(root, "src", "react", "index.tsx")],
    outfile: join(buildDir, "react", "index.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: [...EXTERNAL, "../index.js"],
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // Emit the .d.ts declarations (declaration-only — esbuild already wrote JS).
  execFileSync(
    "node",
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(root, "tsconfig.build.json"),
      "--outDir",
      buildDir,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  assertDeclarationsSelfContained(buildDir);
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
