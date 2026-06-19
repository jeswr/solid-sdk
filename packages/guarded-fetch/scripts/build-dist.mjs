// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch installs
 * under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * The default `.` entry depends on `ipaddr.js` (the IP-literal classifier). To keep the
 * published artifact SELF-CONTAINED under the suite's `ignore-scripts=true` invariant — so a
 * consumer can `npm install github:jeswr/guarded-fetch#main` and import it with no build step
 * and no need to resolve a transitive dep — we INLINE `ipaddr.js` into `dist/index.js`.
 * (`ipaddr.js` is a devDependency, not a runtime dependency, precisely because it is bundled
 * in, not resolved by the consumer.)
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist/index.js + dist/node.js): `ipaddr.js` — by virtue of being
 *     ABSENT from the EXTERNAL lists below.
 *   - EXTERNAL (resolved from npm by the consumer): `undici` — an npm-published runtime
 *     `dependency` used ONLY by the `./node` entry, kept external so it is not inlined into the
 *     browser-safe `.` entry and so a single shared copy + normal npm dedupe/audit apply. The
 *     `.` entry never references undici, so the browser bundle never sees it.
 *   - `./index.js` is kept EXTERNAL for the `./node` bundle so `dist/node.js` references the
 *     SAME runtime `SsrfError` class + guard as `dist/index.js` — an error thrown by
 *     `@jeswr/guarded-fetch/node` therefore satisfies `instanceof SsrfError` imported from
 *     `@jeswr/guarded-fetch` (a single shared SsrfError class, not two inlined copies).
 *   - Node builtins (`node:dns`, `node:net`) — external on `platform:"node"` by default; named
 *     for clarity.
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

/** Everything that must stay EXTERNAL for the default `.` entry. `ipaddr.js` is INLINED. */
const EXTERNAL = ["undici"];

/** The `./node` entry additionally keeps `./index.js` + node: builtins external. */
const NODE_EXTERNAL = [...EXTERNAL, "./index.js", "node:dns", "node:net"];

async function main(buildDir = outdir) {
  rmSync(buildDir, { recursive: true, force: true });

  // 1. Bundle the browser-safe `.` entry (esbuild owns dist/index.js). ipaddr.js inlined.
  await build({
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(buildDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "module", "default"],
    target: "es2022",
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2. Bundle the SEPARATE Node entry (dist/node.js). undici + node: builtins + ./index.js
  //    stay external; ipaddr.js (reached only transitively via ./index.js, which is external)
  //    is therefore NOT re-inlined here.
  await build({
    entryPoints: [join(root, "src", "node.ts")],
    outfile: join(buildDir, "node.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: NODE_EXTERNAL,
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
