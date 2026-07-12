// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/federation-registry` depends on `@jeswr/fetch-rdf`, which is NOT on npm
 * and ships no usable `dist/` (a git dep that needs its own build). A consumer
 * running `npm install github:jeswr/federation-registry#main` under the suite's
 * `ignore-scripts=true` invariant will NOT run our `build:deps`/`prepare`, so
 * `@jeswr/fetch-rdf` would never get built and the import would fail. The fix is
 * to make the committed artifact self-contained re: that off-npm dep by INLINING
 * `@jeswr/fetch-rdf`'s compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): `@jeswr/fetch-rdf` only — the one off-npm dep.
 *   - EXTERNAL (resolved from npm by the consumer): everything else —
 *       `n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, AND
 *       fetch-rdf's OWN runtime deps `jsonld-streaming-parser` + `content-type`
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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { sanitizeJs, sanitizeMap } from "./sanitize-dist.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Rewrite the machine-dependent build paths esbuild embeds — the `index.js` banner
 * comments and the `index.js.map` `sources[]` / `sourceRoot` — to a stable
 * package-relative label, failing closed if any host path survives. The pure rewrite
 * + guard logic lives in `sanitize-dist.mjs` (unit-tested in `test/dist-sanitize.test.ts`,
 * incl. the parent-node_modules + space-in-path leak cases); this wrapper only does the
 * file read/write and supplies the two frames of reference the classifier needs:
 *   - `root` is the package root (own source lives under it → `src/…`);
 *   - esbuild emits banner paths relative to the build WORKING DIR (= `root`, since the
 *     build always runs with cwd = the package root) and sourcemap `sources[]` relative
 *     to the MAP FILE's dir (= `buildDir`). Passing each base lets the sanitiser resolve
 *     to an absolute path and classify by `path.relative(root, …)` rather than by a
 *     substring that a parent dir named `src`/`node_modules` could defeat.
 */
function sanitizeDist(buildDir) {
  const jsPath = join(buildDir, "index.js");
  writeFileSync(jsPath, sanitizeJs(readFileSync(jsPath, "utf8"), root, root));

  const mapPath = join(buildDir, "index.js.map");
  if (existsSync(mapPath)) {
    const map = sanitizeMap(JSON.parse(readFileSync(mapPath, "utf8")), root, buildDir);
    writeFileSync(mapPath, JSON.stringify(map));
  }
}

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
    // Pin the working dir esbuild computes banner/sourcemap paths against to the
    // package root, so those embedded paths are ROOT-relative regardless of the cwd
    // the build is invoked from. Without this, running the build from a different cwd
    // would emit caller-cwd-relative paths that the sanitiser (which resolves banners
    // against `root`) would resolve against the wrong base → nondeterministic labels
    // that could bypass the leak guard.
    absWorkingDir: root,
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

  // 4. Strip machine-absolute paths from the emitted JS + sourcemap, and fail closed
  //    if any host/home path prefix survives (keeps the committed dist deterministic +
  //    leak-free).
  sanitizeDist(buildDir);
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
