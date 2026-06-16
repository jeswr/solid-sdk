// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/federation-client` depends on TWO off-npm `@jeswr/*` packages —
 * `@jeswr/fetch-rdf` and `@jeswr/federation-registry` — that a consumer running
 * `npm install github:jeswr/federation-client#main` under the suite's
 * `ignore-scripts=true` invariant cannot resolve/build (fetch-rdf ships no usable
 * `dist/`; federation-registry is a git-only package not on the npm registry). So
 * the consumer's import would fail. The fix is to make the committed artifact
 * self-contained re: those off-npm deps by INLINING their compiled code into our
 * `dist/index.js`. (The registry's own bundle already inlines its copy of
 * `@jeswr/fetch-rdf`, so the result is self-contained transitively.)
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/*` deps —
 *       `@jeswr/fetch-rdf` AND `@jeswr/federation-registry` — by virtue of being
 *       ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved from npm by the consumer): everything else —
 *       `n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, AND the off-npm
 *       deps' OWN npm runtime deps `jsonld-streaming-parser` + `content-type`
 *       (all npm-published; we add them to our `dependencies` so the consumer
 *       resolves them). We deliberately do NOT bundle these — keeping them
 *       external means a single shared copy + normal npm dedupe/audit.
 *
 * `tsc` still emits the `.d.ts` declarations (declarations carry no fetch-rdf
 * type import — verified — so they are already self-contained). esbuild owns the
 * JS; tsc owns the types (declaration-only).
 *
 * The committed `dist/` is kept in sync with `src/` by `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Everything that must stay EXTERNAL (resolved from npm, not inlined). The ONLY
 * package bundled in is `@jeswr/fetch-rdf` — by virtue of being absent from this
 * list. fetch-rdf's own runtime deps stay external too (they are on npm).
 */
const EXTERNAL = [
  "n3",
  "@solid/object",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  // @jeswr/fetch-rdf's own runtime deps — npm-published, kept external:
  "jsonld-streaming-parser",
  "content-type",
];

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install).
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
    // Inline ONLY @jeswr/fetch-rdf; keep the npm-published deps external.
    external: EXTERNAL,
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
await main(
  argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir,
);
