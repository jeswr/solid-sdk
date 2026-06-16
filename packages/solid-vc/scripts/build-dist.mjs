// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-vc` depends on `@jeswr/fetch-rdf`, which is NOT on npm and ships
 * no usable `dist/` (a git dep that needs its own build). A consumer running
 * `npm install github:jeswr/solid-vc#main` under the suite's `ignore-scripts=true`
 * invariant will NOT run our `build:deps`/`prepare`, so `@jeswr/fetch-rdf` would
 * never get built and the import would fail. The fix is to make the committed
 * artifact self-contained re: that off-npm dep by INLINING `@jeswr/fetch-rdf`'s
 * compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): `@jeswr/fetch-rdf` ONLY — the one off-npm dep.
 *   - EXTERNAL (resolved from npm by the consumer): EVERYTHING ELSE. We compute the
 *       external set as `package.json` {dependencies ∪ devDependencies} MINUS
 *       `@jeswr/fetch-rdf`, plus the known transitive deps that `@jeswr/fetch-rdf`
 *       pulls in (`jsonld-streaming-parser`, `content-type`, the `@rdfjs/*` tree,
 *       …). All are npm-published, so a single shared copy + normal npm
 *       dedupe/audit is correct — bundling them would duplicate the whole `@rdfjs`
 *       tree into our dist.
 *   esbuild treats a parent package name in `external` as covering its subpaths,
 *   so listing e.g. `@rdfjs/dataset` externalises `@rdfjs/dataset/...` too.
 *
 * `tsc` still emits the `.d.ts` declarations (declarations carry no fetch-rdf
 * type import — verified — so they are already self-contained). esbuild owns the
 * JS; tsc owns the types (declaration-only).
 *
 * The committed `dist/` is kept in sync with `src/` by `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** The ONE off-npm dependency we INLINE; everything else stays external. */
const INLINE = "@jeswr/fetch-rdf";

/**
 * Transitive deps that are NOT direct entries in our `package.json` but are
 * pulled in by `@jeswr/fetch-rdf` (and `@rdfjs/wrapper`/`@solid/object`). They
 * must stay EXTERNAL — they are all npm-published, and bundling them would copy
 * the whole `@rdfjs`/`jsonld` tree into our `dist`. esbuild externalises
 * subpaths of any listed parent automatically.
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
  // node built-ins fetch-rdf / its deps may touch (defensive; node platform
  // already externalises these, but listed for clarity).
  "node:crypto",
];

/**
 * The full EXTERNAL set: every `package.json` dependency + devDependency EXCEPT
 * the inlined `@jeswr/fetch-rdf`, plus the known transitive externals. Computed
 * from `package.json` so adding a dep automatically keeps it external (the
 * inline-only-fetch-rdf contract holds without editing this list).
 */
function externals() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].filter((name) => name !== INLINE);
  return [...new Set([...declared, ...EXTERNAL_TRANSITIVE])];
}

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
