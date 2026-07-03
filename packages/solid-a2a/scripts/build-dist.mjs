// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-a2a` depends on TWO off-npm `@jeswr` git packages — `@jeswr/fetch-rdf`
 * and `@jeswr/rdf-serialize` — that are NOT on npm. A consumer running
 * `npm install github:jeswr/solid-a2a#main` under the suite's `ignore-scripts=true`
 * invariant will NOT run our `build:deps`/`prepare`. `@jeswr/fetch-rdf` additionally
 * ships no usable `dist/` (a git dep that needs its own build), so its import would
 * fail outright; `@jeswr/rdf-serialize` DOES ship a committed `dist/`, but it is still
 * an off-npm git dep whose presence we should not assume in the consumer's tree. The
 * fix is to make the committed artifact self-contained re: BOTH off-npm `@jeswr` deps
 * by INLINING their compiled code into our `dist/index.js`. Their only runtime
 * sub-dependency (`n3`) is itself an external npm-published package shared with this
 * package, so inlining the @jeswr glue without inlining `n3` keeps the bundle small.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr` deps `@jeswr/fetch-rdf` and
 *       `@jeswr/rdf-serialize` ONLY.
 *   - EXTERNAL (resolved from npm by the consumer): EVERYTHING ELSE. We compute the
 *       external set as `package.json` {dependencies ∪ devDependencies} MINUS
 *       `@jeswr/fetch-rdf`, plus the known transitive deps that `rdf-validate-shacl`
 *       and `@jeswr/fetch-rdf` pull in (`clownface`, `@rdfjs/*`, `@vocabulary/sh`,
 *       `rdf-dataset-ext`, `rdf-literal`, `rdf-validate-datatype`,
 *       `jsonld-streaming-parser`, `content-type`, …). All are npm-published, so a
 *       single shared copy + normal npm dedupe/audit is correct — bundling them
 *       would duplicate the whole rdf-validate-shacl / @rdfjs tree into our dist.
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

/**
 * Host/home path prefixes that must NEVER survive in a COMMITTED artifact. esbuild
 * embeds machine-absolute paths in two places — bundle banner comments in `index.js`
 * and `sources[]` in `index.js.map` — which would otherwise leak the builder's home
 * directory (`/Users/<name>/…`) AND make the committed bytes non-deterministic across
 * machines / worktrees. `sanitizeDist` rewrites them to package-relative; this guard
 * fails the build if any survive. (Mirrors federation-client / solid-agent-card.)
 */
const FORBIDDEN_PATH_PREFIXES = ["/Users/", "/home/", "/root/", "/private/", "/var/"];

/**
 * Rewrite a single sourcemap `sources[]` entry to a package-relative label. The map
 * lives in `dist/`, so the package root is `..`. An inlined dep resolves to a
 * `…/node_modules/…` path and our own code to a `…/src/…` path — anchor on the
 * package-internal segment and drop the machine-absolute (or dot-dot) prefix, so the
 * label is identical whether the build ran in the main checkout, a worktree, or a
 * scratch dir (check-dist rebuilds into `os.tmpdir()`).
 */
function pkgRelativeSource(source) {
  const nm = source.indexOf("/node_modules/");
  if (nm !== -1) {
    return `..${source.slice(nm)}`;
  }
  const sc = source.lastIndexOf("/src/");
  if (sc !== -1) {
    return `..${source.slice(sc)}`;
  }
  return source;
}

/**
 * Strip machine-absolute paths esbuild embeds, then FAIL the build if any host/home
 * path prefix survives in the emitted `index.js` / `index.js.map`. Keeps the committed
 * dist deterministic + free of the builder's home path.
 */
function sanitizeDist(buildDir) {
  const artifacts = [];

  // 1. index.js — banner comments carry `<abs>/node_modules/<pkg>/…`; reduce the
  //    absolute prefix before any `/node_modules/` to a package-relative `node_modules/`.
  const jsPath = join(buildDir, "index.js");
  const js = readFileSync(jsPath, "utf8").replace(
    /\/[^\s"'`\n]*?\/node_modules\//g,
    "node_modules/",
  );
  writeFileSync(jsPath, js);
  artifacts.push(["index.js", js]);

  // 2. index.js.map — relativise every `sources[]` entry (structured, so no regex on
  //    JSON). check-dist ignores `*.map`, but the committed map must still not leak.
  const mapPath = join(buildDir, "index.js.map");
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    if (Array.isArray(map.sources)) {
      map.sources = map.sources.map(pkgRelativeSource);
    }
    if (typeof map.sourceRoot === "string" && map.sourceRoot.length > 0) {
      map.sourceRoot = "";
    }
    const mapText = JSON.stringify(map);
    writeFileSync(mapPath, mapText);
    artifacts.push(["index.js.map", mapText]);
  }

  // 3. Guard: no host/home path may survive in EITHER artifact.
  for (const [name, content] of artifacts) {
    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      const at = content.indexOf(prefix);
      if (at !== -1) {
        throw new Error(
          `build-dist: committed dist/${name} still contains a host path (${prefix}…): ` +
            `${JSON.stringify(content.slice(at, at + 100))}. The sanitiser must reduce ` +
            "every absolute path to a package-relative one before commit.",
        );
      }
    }
  }
}

/** The off-npm `@jeswr` dependencies we INLINE; everything else stays external. */
const INLINE = ["@jeswr/fetch-rdf", "@jeswr/rdf-serialize"];

/**
 * Transitive deps that are NOT direct entries in our `package.json` but are
 * pulled in by `rdf-validate-shacl` (and `@jeswr/fetch-rdf`'s runtime deps). They
 * must stay EXTERNAL — they are all npm-published, and bundling them would copy
 * the whole `@rdfjs`/`clownface` tree into our `dist`. esbuild externalises
 * subpaths of any listed parent automatically.
 */
const EXTERNAL_TRANSITIVE = [
  "clownface",
  "@vocabulary/sh",
  "rdf-dataset-ext",
  "rdf-literal",
  "rdf-validate-datatype",
  "@rdfjs/dataset",
  "@rdfjs/data-model",
  "@rdfjs/environment",
  "@rdfjs/namespace",
  "@rdfjs/term-map",
  "@rdfjs/term-set",
  "@rdfjs/to-ntriples",
  // node built-ins fetch-rdf / its deps may touch (defensive; node platform
  // already externalises these, but listed for clarity).
  "node:crypto",
];

/**
 * The full EXTERNAL set: every `package.json` dependency + devDependency EXCEPT
 * the inlined `@jeswr/fetch-rdf`, plus the known transitive externals. Computed
 * from `package.json` so adding a dep automatically keeps it external (the
 * inline-only-fetch-rdf contract holds without editing this list).
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

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install). The
  //    other inlined @jeswr dep, @jeswr/rdf-serialize, already ships a committed
  //    dist (its `prepare` is not needed), so it is resolvable as-is.
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
    // Inline ONLY the off-npm @jeswr deps (@jeswr/fetch-rdf + @jeswr/rdf-serialize,
    // the INLINE set); keep every npm-published dep external.
    external: externals(),
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
