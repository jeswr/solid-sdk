// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/federation-trust` depends on three OFF-NPM git deps — `@jeswr/solid-vc`,
 * `@jeswr/federation-registry`, and (transitively) `@jeswr/fetch-rdf`. A consumer
 * running `npm install github:jeswr/federation-trust#main` under the suite's
 * `ignore-scripts=true` invariant will NOT run our `build:deps`/`prepare`. The
 * solid-vc / federation-registry git deps DO commit a self-contained `dist/`, but
 * to make OUR install artifact robust regardless of how those deps were resolved
 * we INLINE all three `@jeswr/*` packages into our `dist/index.js`. Everything
 * npm-published (n3, jose, rdf-canonize, multiformats, @rdfjs/*, content-type,
 * jsonld-streaming-parser) stays EXTERNAL — resolved from npm by the consumer
 * (single shared copy + normal dedupe/audit).
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the `@jeswr/*` git deps only —
 *       `@jeswr/solid-vc`, `@jeswr/federation-registry`, `@jeswr/fetch-rdf`.
 *   - EXTERNAL (resolved from npm by the consumer): every other dependency,
 *       computed from `package.json` so adding an npm dep automatically keeps it
 *       external (the inline-only-@jeswr contract holds without editing a list),
 *       plus the known transitive externals fetch-rdf / the RDF stack pull in.
 *
 * `tsc` still emits the `.d.ts` declarations; esbuild owns the JS. The committed
 * `dist/` is kept in sync with `src/` by `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** The off-npm `@jeswr/*` packages we INLINE (everything else stays external). */
const INLINE = new Set([
  "@jeswr/solid-vc",
  "@jeswr/federation-registry",
  "@jeswr/fetch-rdf",
]);

/**
 * Known transitive externals the inlined `@jeswr/*` code (and the RDF stack) pull
 * in but that are not direct `package.json` deps — kept external (all npm-published).
 */
const EXTERNAL_TRANSITIVE = [
  "@rdfjs/dataset",
  "@rdfjs/data-model",
  "@rdfjs/environment",
  "@rdfjs/namespace",
  "@rdfjs/term-map",
  "@rdfjs/term-set",
  "@rdfjs/to-ntriples",
  "rdf-data-factory",
  "multiformats/bases/base58",
  // node built-ins the inlined code may touch (defensive; node platform already
  // externalises these, but listed for clarity).
  "node:crypto",
];

/**
 * The full EXTERNAL set: every `package.json` dependency + devDependency EXCEPT
 * the inlined `@jeswr/*` packages, plus the known transitive externals. Computed
 * from `package.json` so adding an npm dep automatically keeps it external.
 */
function externals() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].filter((name) => !INLINE.has(name));
  return [...new Set([...declared, ...EXTERNAL_TRANSITIVE])];
}

async function main(buildDir = outdir) {
  // 1. Ensure off-npm deps' dist exist so esbuild can resolve + inline them
  //    (ignore-scripts skipped their prepare on install).
  execFileSync("node", [join(root, "scripts", "build-deps.mjs")], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // 2. Clean target then bundle the runtime JS (esbuild owns dist/index.js).
  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(buildDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    // Inline ONLY the @jeswr/* git deps; keep the npm-published deps external.
    external: externals(),
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 3. Emit the .d.ts declarations (declaration-only — esbuild already wrote JS).
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
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
