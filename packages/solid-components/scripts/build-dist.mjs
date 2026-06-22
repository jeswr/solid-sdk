// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true` (§8 of the package spec).
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * @ulb-darmstadt/shacl-form's published `dist` EXTERNALISES its peer
 * dependencies — its bundle statically `import`s `n3`, `shacl-engine`,
 * `@ro-kit/ui-widgets`, `uuid`, AND the optional widget deps `jsonld` +
 * `rdfxml-streaming-parser`. A consumer running
 * `npm install github:jeswr/solid-components#main` under the suite's
 * `ignore-scripts=true` invariant must NOT have to install those peers by hand.
 * The suite contract is a BUILDLESS install: `import "@jeswr/solid-components"`
 * just works. So we make the committed artifact self-contained by INLINING the
 * REQUIRED peers and STUBBING the optional widget ones.
 *
 * The externalisation contract (the load-bearing part):
 *
 *   INLINED (bundled into dist/, by being ABSENT from EXTERNAL):
 *     - @ulb-darmstadt/shacl-form (+ its required peers n3, shacl-engine,
 *       @ro-kit/ui-widgets, uuid — and shacl-engine's own deps comunica/lodash/…)
 *     - @jeswr/fetch-rdf (the canonical parser; ships a usable npm dist now, but
 *       inlining keeps dist/ self-contained regardless) + its runtime deps
 *       (jsonld-streaming-parser, content-type)
 *     - lit (so the element renders with no lit peer install)
 *
 *   STUBBED (aliased to a tiny throwing no-op — keeps the heavy OPTIONAL widget
 *   deps OUT of the base; <jeswr-shacl-view> never reaches their code paths
 *   because it always hands shacl-form INLINE TURTLE — §8 "do NOT pull
 *   leaflet/jsonld/rdfxml-streaming-parser into the base"):
 *     - jsonld, rdfxml-streaming-parser, leaflet (+ leaflet plugins)
 *
 *   EXTERNAL (resolved by the consumer / loaded lazily):
 *     - @jeswr/guarded-fetch — loaded by DYNAMIC import only for a user-configured
 *       REMOTE source, so it (and undici on Node) never enters the base bundle.
 *       Declared an OPTIONAL peer.
 *     - react, react-dom, @lit/react — optional peers for the /react subexport.
 *
 * platform:"browser" is REQUIRED, not optional: these are browser Web Components.
 * A `platform:"node"` build pulls Node builtins into the committed artifact (e.g.
 * `node:crypto` via uuid's Node entry, `buffer` via readable-stream), which a
 * browser bundler cannot load — a hard browser-load failure for every consumer.
 * The browser platform resolves uuid's `crypto.getRandomValues` path and the
 * browser shims of shacl-engine's stream deps, so the ONLY external left is the
 * intentionally-dynamic `@jeswr/guarded-fetch`. The bundle still loads under Node
 * (the vitest/jsdom smoke test): `crypto.getRandomValues` is a Node global and the
 * DOM globals come from jsdom. esbuild `splitting:true` shares the inlined RDF
 * stack between the `.` and `./react` entries via a chunk, committed once.
 *
 * `tsc` emits the `.d.ts` declarations (declaration-only — esbuild owns the JS).
 * `scripts/check-dist-fresh.mjs` guards the committed dist/ against drift.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Bare side-effect imports of INLINED packages that must be STRIPPED from the
 * emitted `.d.ts`. In the JS these register a custom element (inlined into the
 * bundle); in a DECLARATION file they carry no type meaning, but leave a module
 * specifier a TS consumer would have to resolve — and the package is bundled, not
 * installed. So `import "@ulb-darmstadt/shacl-form";` in a `.d.ts` would force a
 * consumer to install shacl-form just for `tsc`, defeating the self-contained
 * artifact. Removing the line is safe: it has no declaration-level effect.
 */
const STRIP_DTS_SIDE_EFFECT_IMPORTS = ["@ulb-darmstadt/shacl-form"];
const stubsDir = join(root, "scripts", "stubs");
const outdir = join(root, "dist");
const require = createRequire(import.meta.url);

/** Optional widget deps STUBBED out of the base (kept lean per §8). */
const STUB_ALIAS = {
  jsonld: join(stubsDir, "jsonld.mjs"),
  "rdfxml-streaming-parser": join(stubsDir, "rdfxml-streaming-parser.mjs"),
  leaflet: join(stubsDir, "leaflet.mjs"),
  "leaflet-editable": join(stubsDir, "leaflet.mjs"),
  "leaflet.fullscreen": join(stubsDir, "leaflet.mjs"),
};

/**
 * EXTERNAL — resolved by the consumer, NOT inlined.
 *   - @jeswr/guarded-fetch: dynamic-import-only (optional); never in the base.
 *   - react / react-dom / @lit/react: optional peers for the /react subexport.
 */
const EXTERNAL = ["@jeswr/guarded-fetch", "react", "react-dom", "react/jsx-runtime", "@lit/react"];

/**
 * BROWSER-SAFE re-route of the `@jeswr/solid-task-model` BARE-ROOT specifier to its
 * `vocab` module.
 *
 * `@jeswr/solid-chat-interop`'s `vocab.js` re-exports ONLY the four stable `wf:Task`
 * vocabulary consts (`TASK_CLASS` / `WF_OPEN` / `WF_CLOSED` / `wf`) from the
 * task-model's BARE ROOT (`@jeswr/solid-task-model`). That root index, however,
 * also re-exports the task-model's `./shape` module, which reads its `.ttl` shape
 * files off disk via `node:fs` / `node:url` at module load — Node-only code that a
 * `platform:"browser"` bundle cannot resolve (the build fails on `node:fs`). None of
 * those four consts touch the shape module, so we alias the bare root to the
 * task-model's own browser-safe `vocab.js`, which exports all four. This is an
 * EXACT-specifier alias: it matches ONLY the bare `@jeswr/solid-task-model` import
 * (chat-interop's), NOT the `@jeswr/solid-task-model/contacts` / `/task` SUBPATH
 * imports our own components use (those are already browser-safe and stay as-is).
 * `src/` never imports the bare root, so this affects only the inlined chat-interop.
 */
// Resolve the task-model's `dist/vocab.js`. Its `exports` map intentionally does
// not expose `./dist/*` (nor `./package.json`), and the `.` entry defines only the
// ESM `import` condition (no CJS `require`), so we resolve the exported `.` entry
// via `import.meta.resolve` (which honours the exports map + `import` condition) and
// swap the filename for the sibling, browser-safe `vocab.js` in the same `dist/`.
const taskModelRoot = fileURLToPath(import.meta.resolve("@jeswr/solid-task-model"));
const taskModelVocab = join(dirname(taskModelRoot), "vocab.js");

/**
 * esbuild's `alias` option is a PREFIX match (it rewrites `<pkg>/sub` too), so it
 * cannot express "alias ONLY the bare root, leave the subpaths". We need exactly
 * that: re-route the bare `@jeswr/solid-task-model` (chat-interop's vocab import)
 * to the browser-safe `vocab.js`, while letting `@jeswr/solid-task-model/contacts`
 * and `/task` (our components' imports) resolve normally. A resolve plugin with an
 * EXACT-specifier filter does it.
 */
const taskModelRootOnlyPlugin = {
  name: "task-model-root-to-vocab",
  setup(pluginBuild) {
    // Anchored regex → matches the bare package specifier ONLY, never a subpath.
    pluginBuild.onResolve({ filter: /^@jeswr\/solid-task-model$/ }, () => ({
      path: taskModelVocab,
    }));
  },
};

async function main(buildDir = outdir) {
  rmSync(buildDir, { recursive: true, force: true });

  // Bundle both entries with code-splitting so the inlined RDF stack is committed
  // ONCE in a shared chunk, not duplicated across `.` and `./react`.
  await build({
    entryPoints: {
      index: join(root, "src", "index.ts"),
      "react/index": join(root, "src", "react", "index.ts"),
    },
    outdir: buildDir,
    bundle: true,
    splitting: true,
    format: "esm",
    // Browser Web Components — browser platform + conditions so no Node builtin
    // (node:crypto / buffer / …) enters the committed artifact. See the header.
    platform: "browser",
    target: "es2022",
    conditions: ["browser", "import", "module", "default"],
    external: EXTERNAL,
    alias: STUB_ALIAS,
    plugins: [taskModelRootOnlyPlugin],
    // No sourcemaps in the committed artifact: they would embed machine-specific
    // ABSOLUTE source paths (non-deterministic across machines → check-dist churn,
    // and a minor info leak) and add weight a consumer never needs. The src/ is in
    // `files` for anyone who wants to debug against source.
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    // Chunk names: `[name]-[hash]`. The bundled graph now produces MORE THAN ONE
    // shared chunk (the inlined RDF stack + the @jeswr data models), and a bare
    // `[name]` collides ("Two output files share the same path"). esbuild's `[hash]`
    // is CONTENT-derived, so it is still DETERMINISTIC across rebuilds for identical
    // input — check-dist-fresh stays meaningful (a changed chunk changes its hash →
    // a new committed filename → drift is caught), while distinct chunks no longer
    // collide.
    chunkNames: "chunks/[name]-[hash]",
  });

  // Emit the .d.ts declarations (declaration-only — esbuild already wrote the JS).
  const tscBin = require.resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.build.json", "--outDir", buildDir], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    shell: false,
  });

  // Strip bare side-effect imports of inlined packages from every emitted .d.ts so
  // the published declarations only reference DECLARED runtime/type deps (the
  // self-contained-types contract). See STRIP_DTS_SIDE_EFFECT_IMPORTS.
  stripDtsSideEffectImports(buildDir);
}

/** Remove `import "<pkg>";` side-effect lines for inlined pkgs from all *.d.ts. */
function stripDtsSideEffectImports(dir) {
  const patterns = STRIP_DTS_SIDE_EFFECT_IMPORTS.map(
    (pkg) =>
      new RegExp(`^\\s*import\\s+["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];?\\s*$`),
  );
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (p.endsWith(".d.ts")) {
        const lines = readFileSync(p, "utf8").split("\n");
        const kept = lines.filter((line) => !patterns.some((re) => re.test(line)));
        if (kept.length !== lines.length) writeFileSync(p, kept.join("\n"));
      }
    }
  };
  walk(dir);
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
