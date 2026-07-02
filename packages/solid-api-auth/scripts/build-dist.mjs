// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch installs
 * under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * The default WebID bidirectional check dereferences the WebID profile through
 * `@jeswr/guarded-fetch` (the SSRF / DNS-rebinding guard), which is an OFF-NPM `@jeswr`
 * dependency (installed from GitHub). To keep the published artifact SELF-CONTAINED under the
 * suite's `ignore-scripts=true` invariant — so a consumer can
 * `npm install github:jeswr/solid-api-auth#main` and import it with no build step and no need
 * to resolve a transitive git dependency — we INLINE `@jeswr/guarded-fetch` into `dist/`.
 * (`@jeswr/guarded-fetch` is a devDependency, not a runtime dependency, precisely because it
 * is bundled in, not resolved by the consumer.)
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): `@jeswr/guarded-fetch` (+ its already-bundled ipaddr.js) —
 *     by virtue of being ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved from npm by the consumer):
 *       · `jose`            — the JWS/JWK verification engine (a large, audited npm package).
 *       · `oauth4webapi`    — issuer-agnostic OIDC discovery.
 *       · `@jeswr/fetch-rdf`— PUBLISHED on npm (^0.1.0); RDF parse for the WebID profile.
 *       · `undici`          — the DNS-pinning transport `@jeswr/guarded-fetch/node` uses; kept
 *                             external so a single shared copy + normal npm dedupe/audit apply
 *                             (it is a pinned runtime `dependency` of THIS package, 8.5.0, to
 *                             match `@jeswr/guarded-fetch`).
 *   - Node builtins (`node:crypto`, …) — external on `platform:"node"` by default.
 *
 * `jose` stays external per the extraction brief; only the off-npm `@jeswr` dep is inlined.
 *
 * `tsc` still emits the `.d.ts` declarations (declaration-only — esbuild owns the JS).
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
 * Everything that must stay EXTERNAL. `@jeswr/guarded-fetch` is INLINED (absent from this
 * list). `@jeswr/fetch-rdf` is external because it is published on npm; `undici` is external
 * (a pinned runtime dependency); `jose` + `oauth4webapi` are external per the brief.
 */
const EXTERNAL = ["jose", "oauth4webapi", "@jeswr/fetch-rdf", "undici"];

/**
 * The `./next` entry additionally keeps `./index.js` external so `dist/next.js` references the
 * SAME core runtime as `dist/index.js` — one shared `ApiAuthError` class, so an error thrown by
 * the core `verifyRequest` still satisfies `instanceof ApiAuthError` inside `./next`
 * (`apiAuthErrorToResponse`), rather than two inlined copies that fail cross-bundle instanceof.
 */
const NEXT_EXTERNAL = [...EXTERNAL, "./index.js"];

/** One esbuild pass for an entry point (esm, node platform). */
async function bundleEntry(entry, outfile, buildDir, external) {
  await build({
    entryPoints: [join(root, "src", entry)],
    outfile: join(buildDir, outfile),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });
}

async function main(buildDir = outdir) {
  rmSync(buildDir, { recursive: true, force: true });

  // 1. Bundle the core `.` entry (dist/index.js). @jeswr/guarded-fetch inlined.
  await bundleEntry("index.ts", "index.js", buildDir, EXTERNAL);

  // 2. Bundle the Next route-handler `./next` entry (dist/next.js). `./index.js` is external so
  //    the two entries share ONE core runtime (see NEXT_EXTERNAL).
  await bundleEntry("next.ts", "next.js", buildDir, NEXT_EXTERNAL);

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
