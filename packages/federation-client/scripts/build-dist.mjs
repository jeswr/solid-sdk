// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/federation-client` depends on THREE off-npm `@jeswr/*` packages —
 * `@jeswr/fetch-rdf`, `@jeswr/federation-registry`, and `@jeswr/guarded-fetch`
 * (the consolidated suite SSRF guard) — that a consumer running
 * `npm install github:jeswr/federation-client#main` under the suite's
 * `ignore-scripts=true` invariant cannot resolve/build (fetch-rdf ships no usable
 * `dist/`; federation-registry + guarded-fetch are git-only packages not on the
 * npm registry). So the consumer's import would fail. The fix is to make the
 * committed artifact self-contained re: those off-npm deps by INLINING their
 * compiled code into our `dist/index.js`. (The registry's own bundle already
 * inlines its copy of `@jeswr/fetch-rdf`, and guarded-fetch's own committed
 * `dist/` already inlines its copy of `ipaddr.js`, so the result is
 * self-contained transitively — no `ipaddr.js` runtime dep is needed.)
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/*` deps —
 *       `@jeswr/fetch-rdf`, `@jeswr/federation-registry`, AND
 *       `@jeswr/guarded-fetch` — by virtue of being ABSENT from the EXTERNAL
 *       list below. (guarded-fetch's dist carries `ipaddr.js` inline, so it
 *       comes along too — the `.` entry needs no `ipaddr.js` dependency.)
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
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Any absolute home path that must NEVER appear in a committed artifact (an info
 * leak + non-reproducible build). Shared by the `.js` comment guard and the
 * `.js.map` `sources[]` guard.
 */
const HOME_PATH_RE = /\/Users\/|\/home\/|\/root\//;

/**
 * Collapse a path down to a bare `node_modules/<rest>` at its FIRST
 * `/node_modules/` segment; a path with no `node_modules` (e.g. `../src/list.ts`)
 * is returned unchanged. This makes an inlined dependency's recorded path
 * independent of WHERE the build ran.
 */
function collapseNodeModules(p) {
  const marker = "/node_modules/";
  const i = p.indexOf(marker);
  return i === -1 ? p : `node_modules/${p.slice(i + marker.length)}`;
}

/** Throw if any absolute home path survives normalisation in `text`. */
function assertNoHomePath(label, text) {
  if (HOME_PATH_RE.test(text)) {
    const leak = text.split("\n").find((l) => HOME_PATH_RE.test(l)) ?? text.slice(0, 200);
    throw new Error(
      `build-dist: absolute local path survived normalisation in ${label}: ${leak}`,
    );
  }
}

/**
 * Normalise esbuild's inlined-module PATH COMMENTS in an emitted bundle so the
 * committed artifact is reproducible + leaks no local filesystem path.
 *
 * esbuild prefixes each inlined module with a `// <path>` comment giving that
 * module's path RELATIVE TO THE WORKING DIRECTORY. When the build runs in a git
 * worktree whose `node_modules` is a SYMLINK to the main checkout, esbuild
 * resolves the symlink to its realpath, so the relative path traverses up to the
 * filesystem root and back down into an absolute `/Users/<user>/…/node_modules/…`
 * location — embedding the local FS/user path into `dist/*.js` (an info leak +
 * non-reproducible, since the traversal depth varies by build location).
 *
 * This collapses any `…/node_modules/` prefix on a comment line down to a bare
 * `node_modules/…`, making the committed JS independent of WHERE it was built.
 * It only rewrites lines that START with `// ` (esbuild's module-path comments),
 * never code or string literals. Fails hard if any `/Users/` (or other absolute
 * home) path survives, so a future leak can never land silently.
 */
function normalizeBundlePaths(file) {
  const original = readFileSync(file, "utf8");
  // Collapse `// <anything>/node_modules/<rest>` → `// node_modules/<rest>`
  // (lazy up to the FIRST `/node_modules/`) on comment lines only.
  const rewritten = original.replace(
    /^\/\/ .*?\/node_modules\//gm,
    "// node_modules/",
  );
  assertNoHomePath(file, rewritten);
  if (rewritten !== original) {
    writeFileSync(file, rewritten);
  }
}

/**
 * Normalise a `.js.map`'s `sources[]` so the committed source map is reproducible
 * + leaks no local filesystem path (the SAME symlink-realpath traversal that
 * affects the `.js` comments records absolute `/Users/…/node_modules/…` paths in
 * the map's `sources` array). Each entry is collapsed to package-relative
 * (`node_modules/…`), matching the `.js` comment form; package-local sources
 * (`../src/…`) are left untouched. The `sources[]` array is then re-checked for
 * any surviving home path (scanned separately from `sourcesContent`, which is the
 * inlined SOURCE CODE and may legitimately contain such a substring). `mappings`
 * / `names` / `sourcesContent` are untouched, so the map stays valid.
 */
function normalizeSourceMap(file) {
  const original = readFileSync(file, "utf8");
  const map = JSON.parse(original);
  if (Array.isArray(map.sources)) {
    map.sources = map.sources.map(collapseNodeModules);
    for (const s of map.sources) {
      if (HOME_PATH_RE.test(s)) {
        throw new Error(
          `build-dist: absolute local path survived normalisation in ${file} (sources[]): ${s}`,
        );
      }
    }
  }
  const rewritten = JSON.stringify(map);
  if (rewritten !== original) {
    writeFileSync(file, rewritten);
  }
}

/**
 * Everything that must stay EXTERNAL (resolved from npm, not inlined). The off-npm
 * `@jeswr/*` deps (`@jeswr/fetch-rdf`, `@jeswr/federation-registry`,
 * `@jeswr/guarded-fetch`) are bundled IN by virtue of being absent from this list.
 * `ipaddr.js` is NOT listed here either — it is already inlined inside
 * `@jeswr/guarded-fetch`'s committed `dist/`, so bundling guarded-fetch carries it
 * along; listing it would be inert (esbuild never sees a bare `import "ipaddr.js"`).
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

/**
 * The Node entry (`./node` → dist/node.js) additionally keeps external:
 *   - `undici` — an npm-published runtime `dependency` resolved by the consumer (NOT
 *     inlined). The `./node` entry is the ONLY artifact that references `undici`, so the
 *     default `.` entry (dist/index.js) is unaffected and the browser bundle never sees
 *     it (task #92);
 *   - `./index.js` — this package's ROOT bundle. `node.ts` re-exports
 *     `@jeswr/guarded-fetch/node`, whose `createNodeGuardedFetch` throws the guarded-fetch
 *     ROOT's `SsrfError` and uses its `isPublicAddress`/`isLoopbackAddress`. For an error
 *     thrown by `@jeswr/federation-client/node` to satisfy `instanceof SsrfError` imported
 *     from `@jeswr/federation-client`, BOTH emitted bundles must share ONE guarded-fetch
 *     root at runtime. We achieve that by (a) keeping `./index.js` external in the node
 *     bundle and (b) ALIASING the guarded-fetch root (`@jeswr/guarded-fetch`, which
 *     guarded-fetch's own `node` module imports as `./index.js`) to THIS package's
 *     `dist/index.js` — which is the SOLE place the guarded-fetch root is inlined. So
 *     `dist/node.js` references the SAME `SsrfError` class as `dist/index.js` (roborev:
 *     avoid two split `SsrfError` classes / two ipaddr copies);
 *   - Node builtins (`node:dns`, `node:net`) — external on `platform:"node"` by default;
 *     named for clarity.
 */
const NODE_EXTERNAL = [...EXTERNAL, "undici", "./index.js", "node:dns", "node:net"];

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

  // 2b. Bundle the SEPARATE Node entry (dist/node.js). It INLINES
  //     `@jeswr/guarded-fetch/node` (the off-npm undici DNS-pinning fetch) but keeps
  //     `undici` + node: builtins external (undici is a consumer-resolved npm dep). The
  //     load-bearing part: guarded-fetch's own `dist/node.js` imports the guarded-fetch
  //     ROOT via a RELATIVE `./index.js`; we must NOT let esbuild inline that root a SECOND
  //     time (it is already inlined into THIS package's `dist/index.js`), or `dist/node.js`
  //     would carry a split `SsrfError` (+ ipaddr) class and break `instanceof` across the
  //     `.` and `./node` entries. The plugin below intercepts THAT relative `./index.js`
  //     (only when it is imported from inside the installed `@jeswr/guarded-fetch` package)
  //     and marks it EXTERNAL as `./index.js`, so at runtime it resolves to the sibling
  //     `dist/index.js` (this package's root) — the SOLE inlined guarded-fetch root. So
  //     both emitted bundles share ONE `SsrfError`. (`./index.js` is also in NODE_EXTERNAL
  //     for the direct `node.ts` import; the plugin covers the guarded-fetch-internal one.)
  const shareGuardedFetchRootPlugin = {
    name: "share-guarded-fetch-root",
    setup(buildApi) {
      const guardedFetchDir = `${sep}node_modules${sep}@jeswr${sep}guarded-fetch${sep}`;
      buildApi.onResolve({ filter: /^\.\/index\.js$/ }, (args) => {
        // Only the guarded-fetch package's OWN internal `./index.js` import (its node module
        // referencing its root). A `./index.js` from our own src is handled by NODE_EXTERNAL.
        if (args.importer.includes(guardedFetchDir)) {
          return { path: "./index.js", external: true };
        }
        return null;
      });
    },
  };
  await build({
    entryPoints: [join(root, "src", "node.ts")],
    outfile: join(buildDir, "node.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: NODE_EXTERNAL,
    plugins: [shareGuardedFetchRootPlugin],
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2c. Normalise esbuild's inlined-module path comments (in `.js`) AND the
  //     `sources[]` arrays (in `.js.map`) so the committed artifacts are
  //     reproducible + carry no local `/Users/…` filesystem path (see
  //     `normalizeBundlePaths` / `normalizeSourceMap`). Applied to BOTH bundles.
  normalizeBundlePaths(join(buildDir, "index.js"));
  normalizeBundlePaths(join(buildDir, "node.js"));
  normalizeSourceMap(join(buildDir, "index.js.map"));
  normalizeSourceMap(join(buildDir, "node.js.map"));

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
