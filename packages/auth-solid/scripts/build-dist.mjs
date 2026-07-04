// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch installs
 * under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/auth-solid` depends on the OFF-NPM git dep `@jeswr/solid-dpop` (whose only runtime dep
 * is the npm-published `jose`). A consumer running `npm install github:jeswr/auth-solid#main` under
 * the suite's `ignore-scripts=true` invariant will NOT run our `prepare`/`build`, nor solid-dpop's.
 * solid-dpop DOES commit a self-contained `dist/`, but to make OUR install artifact robust
 * regardless of how that dep was resolved we INLINE `@jeswr/solid-dpop` into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist/index.js): the off-npm `@jeswr/*` git deps only —
 *       `@jeswr/solid-dpop` and `@jeswr/guarded-fetch` (its browser-safe default entry, for the
 *       `refuseRedirects` credentialed-fetch guard — no `undici`/`node:*` is pulled in).
 *   - EXTERNAL (resolved from npm by the consumer):
 *       - `jose` — solid-dpop's only runtime dep (npm-published; kept external so a single shared
 *         copy + normal dedupe/audit apply).
 *       - `@auth/core` — a PEER dependency the consumer installs and de-dupes. We import ONLY its
 *         `customFetch` symbol + types from it; bundling a peer would defeat the point (the whole
 *         package exists to plug into the consumer's audited Auth.js, not ship our own).
 *       - node: builtins.
 *   Computed from `package.json` so adding an npm dep automatically keeps it external (the
 *   inline-only-@jeswr contract holds without editing a list).
 *
 * `tsc` still emits the `.d.ts` declarations; esbuild owns the JS. The committed `dist/` is kept
 * in sync with `src/` by `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * The off-npm `@jeswr/*` packages we INLINE (everything else stays external). Both are git deps with
 * a committed self-contained `dist/` and no runtime npm dep beyond `jose` — inlining them makes OUR
 * install artifact robust regardless of how the consumer resolved the transitive git dep. We import
 * ONLY the browser-safe `@jeswr/guarded-fetch` default entry (`refuseRedirects` — no `undici` / no
 * `node:*`), so bundling it does not pull the node-only DNS-pinning fetch in.
 */
const INLINE = new Set(["@jeswr/solid-dpop", "@jeswr/guarded-fetch"]);

/**
 * Known transitive externals the inlined `@jeswr/*` code pulls in but that are not direct
 * `package.json` deps — kept external (all npm-published / node builtins).
 */
const EXTERNAL_TRANSITIVE = ["jose", "node:crypto"];

/**
 * The full EXTERNAL set: every `package.json` dependency + peerDependency + devDependency
 * EXCEPT the inlined `@jeswr/*` packages, plus the known transitive externals. Computed from
 * `package.json` so adding an npm dep automatically keeps it external.
 */
function externals() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].filter((name) => !INLINE.has(name));
  return [...new Set([...declared, ...EXTERNAL_TRANSITIVE])];
}

async function main(buildDir = outdir) {
  rmSync(buildDir, { recursive: true, force: true });

  // 1. Bundle the runtime JS (esbuild owns dist/index.js). @jeswr/solid-dpop inlined;
  //    jose + @auth/core + node builtins external.
  await build({
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(buildDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: externals(),
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2. Emit the .d.ts declarations (declaration-only — esbuild already wrote JS).
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
