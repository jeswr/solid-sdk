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
 * embeds machine paths in two places — module-boundary banner comments in `index.js`
 * and `sources[]` in `index.js.map` — which would otherwise leak the builder's home
 * directory (`/Users/<name>/…`) AND make the committed bytes non-deterministic across
 * machines / worktrees. `sanitizeDist` rewrites those path FIELDS to a package-relative
 * label; `assertNoHostPath` then fails the build if any host prefix survives in them.
 * (Mirrors federation-client / solid-agent-card.)
 */
const FORBIDDEN_PATH_PREFIXES = ["/Users/", "/home/", "/root/", "/private/", "/var/"];

/**
 * Matches an esbuild module-boundary banner line: `// <path>` where <path> has a
 * separator and ends in a source extension, and contains no `:` (so a URL like
 * `https://…/x.js` in a preserved source comment is NOT treated as a banner). Own
 * code and inlined deps are the only lines of this shape; ordinary prose comments
 * (no slash / no source extension) never match. Used both to REWRITE the banner
 * path and to COLLECT the path fields the guard scans.
 */
const JS_BANNER_RE = /^\/\/ ([^\s:]*\/[^\s:]*?\.(?:js|cjs|mjs|ts|tsx|jsx))$/gm;

/**
 * Reduce a build path to a stable, location-independent package-relative label:
 * an inlined dep collapses to `node_modules/…`, our own code to `src/…`. Anchoring
 * on the package-internal segment (not the machine prefix) makes the label identical
 * whether the build ran in the main checkout, a worktree, or a scratch tmpdir
 * (check-dist rebuilds into `os.tmpdir()`), drops the builder's home path, and — by
 * emitting the SAME plain form for the `.js` banner comments and the `.map`
 * `sources[]` — keeps the two consistent (no dangling `..`). Matches the a2a/vc
 * landed convention of a plain `node_modules/…` / `src/…` label.
 */
function pkgRelativePath(p) {
  const nm = p.indexOf("/node_modules/");
  if (nm !== -1) {
    return p.slice(nm + 1);
  }
  const sc = p.indexOf("/src/");
  if (sc !== -1) {
    return p.slice(sc + 1);
  }
  // Already relative (e.g. `src/index.ts`, `node_modules/…`): drop any leading
  // `./` / `../` segments so the label form is identical to the collapsed ones.
  return p.replace(/^(?:\.\.?\/)+/, "");
}

/**
 * Fail the build if any host/home absolute-path prefix survives in the given build
 * PATH fields. Scans ONLY the path fields passed in — the `.js` banner comment paths
 * and the sourcemap `sources[]` entries — NOT `sourcesContent` (inlined source
 * bodies) and NOT arbitrary `.js` string content, so a legitimate string / URL /
 * fixture / prose comment containing `/var/` or `/private/` cannot false-fail.
 */
function assertNoHostPath(name, paths) {
  for (const p of paths) {
    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      if (p.includes(prefix)) {
        throw new Error(
          `build-dist: committed dist/${name} still embeds a host path (${prefix}…): ` +
            `${JSON.stringify(p)}. The sanitiser must reduce every build path to a ` +
            "package-relative one before commit.",
        );
      }
    }
  }
}

/**
 * Rewrite the machine-dependent build paths esbuild embeds — the `index.js` banner
 * comments and the `index.js.map` `sources[]` — to a stable package-relative label,
 * then fail closed if any host path survives in those fields. Keeps the committed
 * dist deterministic + leak-free without touching code or inlined source bodies.
 */
function sanitizeDist(buildDir) {
  // 1. index.js — rewrite each module-boundary banner path to its package-relative
  //    label (`node_modules/…` or `src/…`), consistent with the sourcemap below.
  const jsPath = join(buildDir, "index.js");
  const jsBannerPaths = [];
  const js = readFileSync(jsPath, "utf8").replace(JS_BANNER_RE, (_m, p) => {
    const rel = pkgRelativePath(p);
    jsBannerPaths.push(rel);
    return `// ${rel}`;
  });
  writeFileSync(jsPath, js);
  assertNoHostPath("index.js", jsBannerPaths);

  // 2. index.js.map — relativise every `sources[]` entry to the SAME plain label form
  //    used for the `.js` banners. `sourcesContent` (inlined source bodies) is left
  //    untouched; check-dist ignores `*.map`, but the committed map must not leak.
  const mapPath = join(buildDir, "index.js.map");
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    const sources = Array.isArray(map.sources) ? map.sources.map(pkgRelativePath) : [];
    if (Array.isArray(map.sources)) {
      map.sources = sources;
    }
    if (typeof map.sourceRoot === "string" && map.sourceRoot.length > 0) {
      map.sourceRoot = "";
    }
    writeFileSync(mapPath, JSON.stringify(map));
    assertNoHostPath("index.js.map", sources);
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
