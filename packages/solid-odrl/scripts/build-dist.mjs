// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-odrl` depends on `@jeswr/fetch-rdf`, which is NOT on npm and ships
 * no usable `dist/` (a git dep that needs its own build). A consumer running
 * `npm install github:jeswr/solid-odrl#main` under the suite's `ignore-scripts=true`
 * invariant will NOT run our `build:deps`/`prepare`, so `@jeswr/fetch-rdf` would
 * never get built and the import would fail. The fix is to make the committed
 * artifact self-contained re: that off-npm dep by INLINING `@jeswr/fetch-rdf`'s
 * compiled code into our `dist/index.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): `@jeswr/fetch-rdf` ONLY — the one off-npm dep.
 *   - EXTERNAL (resolved from npm by the consumer): EVERYTHING ELSE. We compute the
 *       external set as `package.json` {dependencies ∪ devDependencies} MINUS
 *       `@jeswr/fetch-rdf`, plus the known transitive deps that `@jeswr/fetch-rdf`
 *       pulls in (`jsonld-streaming-parser`, `content-type`, the `@rdfjs/*` tree,
 *       …). All are npm-published, so a single shared copy + normal npm
 *       dedupe/audit is correct — bundling them would duplicate the whole `@rdfjs`
 *       tree into our dist.
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
import { readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** The ONE off-npm dependency we INLINE; everything else stays external. */
const INLINE = "@jeswr/fetch-rdf";

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
 * the inlined `@jeswr/fetch-rdf`, plus the known transitive externals. Computed
 * from `package.json` so adding a dep automatically keeps it external (the
 * inline-only-fetch-rdf contract holds without editing this list).
 */
function externals() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].filter((name) => name !== INLINE);
  return [...new Set([...declared, ...EXTERNAL_TRANSITIVE])];
}

/** `realpathSync` that never throws (a missing/odd path just yields the input). */
function safeReal(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Reduce a (possibly absolute, possibly `../../…`-relative, possibly
 * symlink-resolved) module path to a LOCATION-INDEPENDENT package-relative form by
 * MARKER, not by prefix: everything up to and including the last `node_modules/`
 * segment collapses to `node_modules/…`, otherwise the path is taken from its last
 * `/src/` segment (→ `src/…`). This strips the maintainer's local
 * `/Users/jesght/…` (or the build box's `/private/tmp/…` worktree) prefix that
 * esbuild embeds (following the `node_modules` symlink out of cwd) and that tsc
 * embeds in the `.d.ts.map` `sources[]` — and it produces the SAME result whether
 * the build runs in `<root>/dist` or the check-dist scratch dir.
 */
function toPackageRelative(p) {
  if (typeof p !== "string") return p;
  const nm = p.lastIndexOf("node_modules/");
  if (nm !== -1) {
    return p.slice(nm);
  }
  const srcIdx = p.lastIndexOf("/src/");
  if (srcIdx !== -1) {
    return p.slice(srcIdx + 1); // → "src/…"
  }
  // Already a bare relative like "src/…" (or has no recognised marker): leave it.
  return p.replace(/^\.\//, "");
}

/**
 * Post-process the emitted `dist/` so NO absolute local filesystem path is
 * committed: rewrite the `.js` bundle's module-boundary path comments and every
 * source-map `sources[]` entry to package-relative. Then a build-FAIL guard scans
 * the committed `.js` + `.map` for any absolute path and throws — the committed
 * artifact must be reproducible + leak-free regardless of who/where built it.
 */
function normalizeAndGuardPaths(buildDir) {
  const rootPrefixes = [...new Set([root, safeReal(root)])].map((r) =>
    r.endsWith(sep) ? r : r + sep,
  );
  const nmRealPrefixes = [
    ...new Set([join(root, "node_modules"), safeReal(join(root, "node_modules"))]),
  ].map((r) => (r.endsWith(sep) ? r : r + sep));

  const files = readdirSync(buildDir).filter((f) => f.endsWith(".js") || f.endsWith(".map"));
  for (const f of files) {
    const fp = join(buildDir, f);
    if (f.endsWith(".map")) {
      const map = JSON.parse(readFileSync(fp, "utf8"));
      if (Array.isArray(map.sources)) {
        map.sources = map.sources.map(toPackageRelative);
      }
      writeFileSync(fp, `${JSON.stringify(map)}\n`);
    } else {
      let txt = readFileSync(fp, "utf8");
      // Collapse any absolute `…/node_modules/` prefix in module-boundary comments.
      txt = txt.replace(/\/[^\s"'`]*?\/node_modules\//g, "node_modules/");
      // Strip a bare `node_modules` real-path prefix (symlink target) if present.
      for (const r of nmRealPrefixes) {
        txt = txt.split(r).join("node_modules/");
      }
      // Strip a package-root prefix (worktree or its realpath) → root-relative.
      for (const r of rootPrefixes) {
        txt = txt.split(r).join("");
      }
      writeFileSync(fp, txt);
    }
  }

  // Build-fail guard: no local absolute path may survive in the committed artifact.
  // For `.map` files scan BOTH `sources[]` AND `sourcesContent[]` (an embedded source
  // body could itself carry a build-box path), not just the source names.
  const ABSOLUTE = /(?:\/Users\/|\/home\/|\/root\/|\/private\/|\/var\/)/;
  const offenders = [];
  for (const f of readdirSync(buildDir).filter((x) => x.endsWith(".js") || x.endsWith(".map"))) {
    const txt = readFileSync(join(buildDir, f), "utf8");
    if (f.endsWith(".map")) {
      const map = JSON.parse(txt);
      for (const s of map.sources ?? []) {
        if (typeof s === "string" && ABSOLUTE.test(s)) offenders.push(`${f} sources[]: ${s}`);
      }
      for (const sc of map.sourcesContent ?? []) {
        if (typeof sc === "string" && ABSOLUTE.test(sc)) {
          const line = sc.split("\n").find((l) => ABSOLUTE.test(l)) ?? "";
          offenders.push(`${f} sourcesContent: ${line.trim().slice(0, 120)}`);
        }
      }
    } else if (ABSOLUTE.test(txt)) {
      const line = txt.split("\n").find((l) => ABSOLUTE.test(l)) ?? "";
      offenders.push(`${f}: ${line.trim().slice(0, 120)}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `build-dist: refusing to emit — absolute local path(s) leaked into dist/:\n  ${offenders.join(
        "\n  ",
      )}`,
    );
  }
}

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
    target: "node24",
    // Inline ONLY @jeswr/fetch-rdf; keep the npm-published deps external.
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

  // 4. Strip absolute local paths from the JS + source maps, then fail-guard.
  normalizeAndGuardPaths(buildDir);
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
