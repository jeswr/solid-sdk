// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/unstorage-solid` depends on the off-npm `@jeswr/fetch-rdf` package,
 * which a consumer running `npm install github:jeswr/unstorage-solid#main` under
 * the suite's `ignore-scripts=true` invariant cannot resolve/build (fetch-rdf
 * ships no usable `dist/`). So the consumer's import would fail. The fix is to
 * make the committed artifact self-contained re: that off-npm dep by INLINING its
 * compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/fetch-rdf` — by virtue of
 *       being ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved by the consumer): everything else —
 *       `n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, AND fetch-rdf's
 *       OWN npm runtime deps `jsonld-streaming-parser` + `content-type` (all
 *       npm-published; we add them to our `dependencies` so the consumer resolves
 *       them), PLUS `unstorage` itself — which is a PEER dependency and MUST NOT
 *       be bundled (bundling a peer creates two copies of its `defineDriver` /
 *       types and breaks dedupe). We deliberately do NOT bundle these.
 *
 * BROWSER SAFETY: `src/watch.ts` (Solid Notifications) only ever uses the global
 * `WebSocket` (a web API available in the browser and in Node ≥ 22), so the core
 * driver path pulls in NO node-only builtin. esbuild `platform:"node"` is fine
 * for the emitted JS — unstorage itself is platform-agnostic and the consumer's
 * bundler tree-shakes/resolves accordingly.
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
 * this list. fetch-rdf's own runtime deps stay external (npm-published), and
 * `unstorage` stays external because it is a PEER dependency.
 */
const EXTERNAL = [
  "n3",
  "@solid/object",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  // @jeswr/fetch-rdf's own runtime deps — npm-published, kept external:
  "jsonld-streaming-parser",
  "content-type",
  // unstorage is a PEER dependency — never bundle it (dual-copy hazard).
  "unstorage",
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
    target: "node20",
    // Inline ONLY @jeswr/fetch-rdf; keep the npm-published + peer deps external.
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
