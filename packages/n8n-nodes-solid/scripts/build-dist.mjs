// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for a GitHub-branch
 * install under `ignore-scripts=true` AND for n8n's community-node loader.
 *
 * MODULE FORMAT — CommonJS (load-bearing). n8n loads a community node + its
 * credential by `require()`-ing the build paths in `package.json`'s `n8n` field —
 * `dist/nodes/Solid/Solid.node.js` + `dist/credentials/SolidApi.credentials.js` —
 * and this `package.json` is a CommonJS package (NO `"type": "module"`). So the
 * emitted artifacts MUST be CommonJS: an ESM `.js` here would be parsed as CJS by
 * Node and throw on `import`/`export` at load time. (The `src/`/`nodes/` SOURCE is
 * NodeNext ESM for typechecking + vitest; esbuild transpiles it to CJS for dist.)
 *
 * Externalisation contract (the load-bearing part) — note that what stays
 * external is constrained by the CJS format: an ESM-ONLY dependency cannot be
 * `require()`d, so it MUST be bundled in.
 *   - INLINED (bundled into dist):
 *       - `@jeswr/fetch-rdf` — off-npm; a consumer under `ignore-scripts=true`
 *         cannot resolve/build it, so it is inlined to make dist self-contained.
 *       - `@solid/object` + `@rdfjs/wrapper` — ESM-ONLY (`"type":"module"`, no CJS
 *         export). A CJS `require()` of them would FAIL, so they are bundled in.
 *   - EXTERNAL (resolved by the consumer / provided by the n8n runtime):
 *       - `n3`, `content-type`, `jsonld-streaming-parser` — all CJS-importable, so
 *         they stay external (in our `dependencies`, consumer resolves them).
 *       - `@rdfjs/types` — types only, no runtime; never emitted.
 *       - `n8n-workflow` — a PEER dependency PROVIDED BY THE n8n RUNTIME; bundling
 *         it would create a second copy of n8n's enums/types and break the node
 *         loader's `NodeConnectionTypes` identity checks. NEVER bundle.
 *
 * The build copies the node SVG icon (n8n loads it via the `icon: "file:solid.svg"`
 * reference, relative to the node file) and `tsc` emits the `.d.ts` declarations.
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Everything that stays EXTERNAL (resolved by the consumer / provided by the n8n
 * runtime, not inlined). Only CJS-importable runtime deps + the peer dep are here;
 * the off-npm `@jeswr/fetch-rdf` and the ESM-ONLY `@solid/object`/`@rdfjs/wrapper`
 * are INLINED by virtue of being ABSENT from this list (see the header).
 */
const EXTERNAL = [
  // CJS runtime deps — kept external, resolved from our `dependencies`:
  "n3",
  "jsonld-streaming-parser",
  "content-type",
  // n8n-workflow is a PEER dependency provided by the n8n runtime — NEVER bundle.
  "n8n-workflow",
];

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install).
  execFileSync("node", [join(root, "scripts", "build-deps.mjs")], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // 2. Clean target then bundle BOTH entry points as CommonJS (esbuild owns .js).
  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: {
      "nodes/Solid/Solid.node": join(root, "nodes", "Solid", "Solid.node.ts"),
      "credentials/SolidApi.credentials": join(root, "credentials", "SolidApi.credentials.ts"),
      // The importable pure-logic library surface (scope guard + container parse),
      // independent of n8n — `src/index.js` is the package `main`.
      "src/index": join(root, "src", "index.ts"),
    },
    outdir: buildDir,
    bundle: true,
    // CommonJS — n8n require()s the dist files and the package is not ESM.
    format: "cjs",
    platform: "node",
    target: "node20",
    // Inline @jeswr/fetch-rdf + the ESM-only @solid/object & @rdfjs/wrapper;
    // keep the CJS-importable npm deps + the peer dep external.
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 3. Copy the node SVG icon next to the emitted node file (n8n loads it via the
  //    `icon: "file:solid.svg"` reference, resolved relative to the node module).
  cpSync(join(root, "nodes", "Solid", "solid.svg"), join(buildDir, "nodes", "Solid", "solid.svg"));

  // 4. Emit the .d.ts declarations (declaration-only — esbuild already wrote JS).
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
