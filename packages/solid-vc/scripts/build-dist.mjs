// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-vc` depends on the off-npm git packages `@jeswr/fetch-rdf` (which
 * ships no usable `dist/` — a git dep that needs its own build) and
 * `@jeswr/rdf-serialize` (the shared n3.Writer serialiser; ships a committed
 * `dist/` but is still off-npm). A consumer running
 * `npm install github:jeswr/solid-vc#main` under the suite's `ignore-scripts=true`
 * invariant will NOT run our `build:deps`/`prepare`, so `@jeswr/fetch-rdf` would
 * never get built. The fix is to make the committed artifact self-contained re:
 * those off-npm deps by INLINING their compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm git deps `@jeswr/fetch-rdf` and
 *       `@jeswr/rdf-serialize` ONLY — so the committed artifact never depends on a
 *       consumer resolving/building an off-npm package under ignore-scripts.
 *   - EXTERNAL (resolved from npm by the consumer): EVERYTHING ELSE. We compute the
 *       external set as `package.json` {dependencies ∪ devDependencies} MINUS the
 *       inlined set, plus the known transitive deps that `@jeswr/fetch-rdf`
 *       pulls in (`jsonld-streaming-parser`, `content-type`, the `@rdfjs/*` tree,
 *       …). All are npm-published, so a single shared copy + normal npm
 *       dedupe/audit is correct — bundling them would duplicate the whole `@rdfjs`
 *       tree into our dist. (`@jeswr/rdf-serialize`'s only runtime dep is `n3`,
 *       already external, so inlining it adds just its tiny wrapper, not n3.)
 *   esbuild treats a parent package name in `external` as covering its subpaths,
 *   so listing e.g. `@rdfjs/dataset` externalises `@rdfjs/dataset/...` too.
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** The off-npm git dependencies we INLINE; everything else stays external. */
const INLINE = ["@jeswr/fetch-rdf", "@jeswr/rdf-serialize"];

/**
 * Transitive deps that are NOT direct entries in our `package.json` but are
 * pulled in by `@jeswr/fetch-rdf` (and `@rdfjs/wrapper`/`@solid/object`). They
 * must stay EXTERNAL — they are all npm-published, and bundling them would copy
 * the whole `@rdfjs`/`jsonld` tree into our `dist`. esbuild externalises
 * subpaths of any listed parent automatically.
 */
const EXTERNAL_TRANSITIVE = [
  "@rdfjs/dataset",
  "@rdfjs/data-model",
  "@rdfjs/environment",
  "@rdfjs/namespace",
  "@rdfjs/term-map",
  "@rdfjs/term-set",
  "@rdfjs/to-ntriples",
  "rdf-data-factory",
  // node built-ins fetch-rdf / its deps may touch (defensive; node platform
  // already externalises these, but listed for clarity).
  "node:crypto",
];

/**
 * The full EXTERNAL set: every `package.json` dependency + devDependency EXCEPT
 * the inlined off-npm git deps (the `INLINE` set: `@jeswr/fetch-rdf` and
 * `@jeswr/rdf-serialize`), plus the known transitive externals. Computed from
 * `package.json` so adding a dep automatically keeps it external (the
 * inline-only-the-off-npm-deps contract holds without editing this list).
 */
function externals() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const inline = new Set(INLINE);
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].filter((name) => !inline.has(name));
  return [...new Set([...declared, ...EXTERNAL_TRANSITIVE])];
}

/**
 * esbuild embeds the on-disk location of every bundled module — as a `// <path>`
 * banner comment in `index.js` and as a `sources` entry in `index.js.map`. For the
 * INLINED off-npm deps that path is an ABSOLUTE, build-machine location (e.g.
 * `…/Users/<name>/…/node_modules/@jeswr/fetch-rdf/…`), which (a) leaks the builder's
 * home directory and (b) makes the committed artifact non-reproducible (it differs
 * per machine / per worktree). Rewrite every such path to a STABLE, repo-relative
 * form (`node_modules/…` in the code banner; `../node_modules/…` in the map, which is
 * relative to `dist/`). Deterministic + machine-independent, so a fresh build on any
 * box reproduces byte-identical `index.js` (what `check:dist` compares) and a clean
 * `index.js.map`. First-party `src/*` sources already emit as clean `../src/*`.
 */
function stripMachinePaths(buildDir) {
  const jsPath = join(buildDir, "index.js");
  if (existsSync(jsPath)) {
    const js = readFileSync(jsPath, "utf8")
      // `// <junk…>node_modules/<rest>` → `// node_modules/<rest>` (repo-relative).
      .replace(/^(\s*\/\/\s*).*?node_modules\//gm, "$1node_modules/")
      // `// <junk…>/src/<rest>` → `// src/<rest>` (a first-party module banner that
      // picked up a machine prefix when the outdir is distant from the sources).
      .replace(/^(\s*\/\/\s*).*?\/(src\/[^\n]*)$/gm, "$1$2");
    writeFileSync(jsPath, js);
    assertNoMachinePath(jsPath, js);
  }
  const mapPath = join(buildDir, "index.js.map");
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    if (Array.isArray(map.sources)) {
      map.sources = map.sources.map(normalizeSource);
    }
    // Never emit an absolute sourceRoot either.
    if (typeof map.sourceRoot === "string" && /\/(Users|home|private|root)\//.test(map.sourceRoot)) {
      map.sourceRoot = "";
    }
    const serialized = JSON.stringify(map);
    writeFileSync(mapPath, serialized);
    assertNoMachinePath(mapPath, serialized);
  }
}

/**
 * Normalise ONE sourcemap `sources` entry to a stable, machine-INDEPENDENT,
 * dist-relative path. Every source is either a first-party `src/*` module or an
 * inlined off-npm dep under `node_modules/*`; anchoring on those markers (and
 * re-rooting at `../`, since the map lives in `dist/`) yields the SAME value whether
 * the build ran into the repo's own `dist/` or into a distant scratch dir (what
 * `check:dist` uses) — so a fresh rebuild reproduces byte-identically and no build
 * machine's home path can leak. node_modules is checked first (its internal `/src/`
 * must not be mistaken for a first-party source).
 */
function normalizeSource(s) {
  if (typeof s !== "string") return s;
  const nm = s.lastIndexOf("node_modules/");
  if (nm !== -1) return `../${s.slice(nm)}`;
  const m = s.match(/(?:^|\/)(src\/.*)$/);
  return m ? `../${m[1]}` : s;
}

/** Fail the build if a build-machine absolute path survived the rewrite. */
function assertNoMachinePath(path, content) {
  const leak = content.match(/[^\s"']*\/(Users|home|private|root)\/[^\s"']*/);
  if (leak) {
    throw new Error(
      `build-dist: ${path} still contains a build-machine absolute path (${leak[0]}). ` +
        "The path-stripping post-process did not cover it — update stripMachinePaths().",
    );
  }
}

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install).
  //    @jeswr/rdf-serialize ships a committed dist/ already, so it needs no
  //    build step here — esbuild resolves + inlines it straight from node_modules.
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
    // Inline ONLY the off-npm git deps (@jeswr/fetch-rdf + @jeswr/rdf-serialize,
    // the INLINE set); keep the npm-published deps external.
    external: externals(),
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2b. Strip build-machine absolute paths esbuild embedded for the inlined off-npm
  //     deps (index.js banner comments + index.js.map `sources`) → repo-relative +
  //     reproducible. Fails closed if any /Users|/home|/private|/root path survives.
  stripMachinePaths(buildDir);

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
