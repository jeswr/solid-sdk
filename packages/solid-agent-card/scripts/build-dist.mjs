// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/federation-client` depends on `@jeswr/fetch-rdf`, which is NOT on npm
 * and ships no usable `dist/` (a git dep that needs its own build). A consumer
 * running `npm install github:jeswr/federation-client#main` under the suite's
 * `ignore-scripts=true` invariant will NOT run our `build:deps`/`prepare`, so
 * `@jeswr/fetch-rdf` would never get built and the import would fail. The fix is
 * to make the committed artifact self-contained re: that off-npm dep by INLINING
 * `@jeswr/fetch-rdf`'s compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr` suite deps —
 *       `@jeswr/fetch-rdf` (ships no usable dist) AND `@jeswr/rdf-serialize`
 *       (the shared serialiser; a git dep not on npm). Both are absent from the
 *       EXTERNAL list below, so esbuild bundles them into the self-contained dist.
 *   - EXTERNAL (resolved from npm by the consumer): everything else —
 *       `n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, AND
 *       fetch-rdf's OWN runtime deps `jsonld-streaming-parser` + `content-type`
 *       (all npm-published; we add them to our `dependencies` so the consumer
 *       resolves them). `@jeswr/rdf-serialize`'s only runtime dep, `n3`, is
 *       already in this list, so inlining it pulls in nothing new. We deliberately
 *       do NOT bundle these — keeping them external means a single shared copy +
 *       normal npm dedupe/audit.
 *
 * `tsc` still emits the `.d.ts` declarations (declarations carry no fetch-rdf
 * type import — verified — so they are already self-contained). esbuild owns the
 * JS; tsc owns the types (declaration-only).
 *
 * The committed `dist/` is kept in sync with `src/` by `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Rewrite an esbuild sourcemap `sources[]` entry to a stable, package-root-relative
 * path — dropping any absolute prefix or `../` traversal so the committed map is
 * deterministic and never leaks the builder's filesystem. A bundled-dep source
 * becomes `node_modules/…`; an own source becomes `src/…`. (`node_modules` is
 * matched first so a dep whose own path contains `src/` still normalises to its
 * `node_modules/` root.)
 */
function toPkgRelativeSource(source) {
  const nm = source.indexOf("node_modules/");
  if (nm !== -1) return source.slice(nm);
  const src = source.indexOf("src/");
  if (src !== -1) return source.slice(src);
  return source;
}

/**
 * Everything that must stay EXTERNAL (resolved from npm, not inlined). The
 * packages bundled in are the off-npm `@jeswr` suite deps `@jeswr/fetch-rdf` and
 * `@jeswr/rdf-serialize` — by virtue of being absent from this list. Their own
 * npm-published runtime deps (fetch-rdf's `jsonld-streaming-parser`/`content-type`,
 * rdf-serialize's `n3`) stay external.
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
    // Inline the off-npm @jeswr suite deps (@jeswr/fetch-rdf + @jeswr/rdf-serialize)
    // by their absence from EXTERNAL; keep the npm-published deps external.
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2b. Normalise esbuild's path labels so the COMMITTED bundle + sourcemap never
  //     embed an absolute local build path (`/Users/…`, `/home/…`) or an
  //     environment-specific `../…` traversal — both leak the builder's filesystem
  //     and vary across checkouts / a symlinked `node_modules`. Rewrite to stable,
  //     package-root-relative paths (`node_modules/…`, `src/…`). Idempotent; keeps
  //     the committed dist deterministic.
  const indexFile = join(buildDir, "index.js");
  const mapFile = join(buildDir, "index.js.map");

  // (i) The bundle's module-boundary `// <path>` comments.
  const normalisedJs = readFileSync(indexFile, "utf8").replace(
    /^\/\/ \S*\/(node_modules\/\S*)$/gm,
    "// $1",
  );
  writeFileSync(indexFile, normalisedJs, "utf8");

  // (ii) The sourcemap `sources[]` entries (esbuild records them absolute /
  //      traversal-relative; rewrite each to package-root-relative).
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  if (Array.isArray(map.sources)) {
    map.sources = map.sources.map(toPkgRelativeSource);
  }
  writeFileSync(mapFile, JSON.stringify(map), "utf8");

  // 2c. Leak guard: FAIL the build if any absolute local path survives in the
  //     committed JS bundle OR its sourcemap. Cheap, and it stops a regression in
  //     the normalisation above from silently shipping a filesystem path.
  for (const f of [indexFile, mapFile]) {
    const content = readFileSync(f, "utf8");
    const leak = content.match(/\/(?:Users|home)\/[^\s"']+/);
    if (leak) {
      throw new Error(
        `build-dist: committed artifact ${f} leaks an absolute local path: ${leak[0]}`,
      );
    }
  }

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
