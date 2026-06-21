// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for a GitHub-branch
 * install under `ignore-scripts=true` AND for n8n's community-node loader.
 *
 * n8n loads the node + credential by the build paths in `package.json`'s `n8n`
 * field — `dist/nodes/Solid/Solid.node.js` and
 * `dist/credentials/SolidApi.credentials.js`. Because the node imports the off-npm
 * `@jeswr/fetch-rdf` (which a consumer running under `ignore-scripts=true` cannot
 * resolve/build), we INLINE fetch-rdf's compiled code into the emitted node file
 * so the committed artifact is self-contained.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/fetch-rdf` — by being
 *       ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved by the consumer): everything else —
 *       `n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, fetch-rdf's OWN
 *       npm runtime deps `jsonld-streaming-parser` + `content-type` (we add them
 *       to our `dependencies` so the consumer resolves them), PLUS `n8n-workflow`
 *       — which is a PEER dependency PROVIDED BY THE n8n RUNTIME and MUST NOT be
 *       bundled (bundling it would create a second copy of n8n's types/enums and
 *       break the node loader's instanceof / NodeConnectionType identity checks).
 *
 * The build emits BOTH entry points as ESM, copies the node SVG icon (n8n loads
 * the icon by the `icon: "file:solid.svg"` reference, relative to the node file),
 * and `tsc` emits the `.d.ts` declarations.
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Everything that must stay EXTERNAL (resolved by the consumer / provided by the
 * n8n runtime, not inlined). The ONLY package bundled in is `@jeswr/fetch-rdf` —
 * by virtue of being absent from this list.
 */
const EXTERNAL = [
  "n3",
  "@solid/object",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  // @jeswr/fetch-rdf's own runtime deps — npm-published, kept external:
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

  // 2. Clean target then bundle BOTH entry points (esbuild owns the .js).
  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: {
      "nodes/Solid/Solid.node": join(root, "nodes", "Solid", "Solid.node.ts"),
      "credentials/SolidApi.credentials": join(root, "credentials", "SolidApi.credentials.ts"),
    },
    outdir: buildDir,
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
