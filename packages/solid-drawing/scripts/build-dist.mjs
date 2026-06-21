// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-drawing` depends on the off-npm `@jeswr/fetch-rdf` package, which
 * a consumer running `npm install github:jeswr/solid-drawing#main` under the
 * suite's `ignore-scripts=true` invariant cannot resolve/build (fetch-rdf ships
 * no usable `dist/` — its `prepare` build is skipped by ignore-scripts). So the
 * consumer's `import` would fail at runtime. The fix is to make the committed
 * artifact self-contained re: that off-npm dep by INLINING its compiled code into
 * our `dist/scene.js` (the only module that imports it).
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/fetch-rdf` — by virtue of
 *       being ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved by the consumer): everything else —
 *       `n3`, `@rdfjs/wrapper`, `@rdfjs/types`, AND fetch-rdf's OWN npm runtime
 *       deps `jsonld-streaming-parser` + `content-type` (all npm-published; we add
 *       them to our `dependencies` so the consumer resolves them). We deliberately
 *       do NOT bundle these.
 *
 * `tsc` still emits the `.d.ts` declarations (declaration-only — esbuild owns the
 * JS). The committed `dist/` is kept in sync with `src/` by
 * `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Everything that must stay EXTERNAL (resolved by the consumer, not inlined). The
 * ONLY package bundled in is `@jeswr/fetch-rdf` — by virtue of being absent from
 * this list. fetch-rdf's own runtime deps stay external (npm-published).
 */
const EXTERNAL = [
  "n3",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  // @jeswr/fetch-rdf's own runtime deps — npm-published, kept external:
  "jsonld-streaming-parser",
  "content-type",
];

/**
 * The bundled entrypoints (matching the package `exports`). Each is bundled
 * STANDALONE with `@jeswr/fetch-rdf` inlined where it is imported. Code-splitting
 * is deliberately OFF: split chunks carry CONTENT-HASHED names that are not
 * reproducible across machines/tool versions, which would make the committed-
 * `dist/` drift guard (`check-dist-fresh.mjs`) flap. Without splitting the small
 * shared modules (e.g. `vocab`) are duplicated across entry bundles — negligible
 * for a vocab package, and the output is fully deterministic.
 */
const ENTRY_POINTS = ["index", "vocab", "scene", "shape"];

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install).
  execFileSync("node", [join(root, "scripts", "build-deps.mjs")], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // 2. Clean target then bundle the runtime JS (esbuild owns dist/*.js). One
  //    standalone bundle per entrypoint — no split chunks (see note above).
  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: ENTRY_POINTS.map((e) => join(root, "src", `${e}.ts`)),
    outdir: buildDir,
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "node",
    target: "node20",
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
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
