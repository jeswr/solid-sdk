// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// §8 PACKAGED-DIST LOAD SMOKE TEST. Proves the COMMITTED, self-contained dist/
// loads + works with NO uninstalled optional peer — the buildless GitHub-branch
// install contract under ignore-scripts=true.
//
// The mechanism that makes this meaningful: the dist/ is built (build-dist.mjs)
// with @ulb-darmstadt/shacl-form + n3 + shacl-engine + @jeswr/fetch-rdf esbuild-
// INLINED, and jsonld + rdfxml-streaming-parser + leaflet STUBBED out. So importing
// dist/index.js must NOT reach for any of those packages. To PROVE that, this test:
//   1. (re)builds dist/ so we test the real committed pipeline,
//   2. asserts the built JS has NO bare import of an optional peer
//      (jsonld / rdfxml-streaming-parser / leaflet / n3 / shacl-form / lit) —
//      they must all be inlined, not externalised,
//   3. imports the built dist/index.js and dist/react/index.js and asserts the
//      public API loads + the custom element registers.
//
// This runs in vitest (Node + jsdom). testTimeout is bumped in vitest.config.ts
// because step 1 does a cold esbuild + tsc build.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// The vitest process runs from the package root (cwd). Resolve dist/ from there so
// we exercise the COMMITTED artifact rather than a transformed src/ path.
const root = process.cwd();
const distIndexPath = join(root, "dist", "index.js");
const distReactPath = join(root, "dist", "react", "index.js");
// Dynamic-import the built ESM by its file:// URL (a bare path import is not ESM-resolvable).
const distIndexUrl = pathToFileURL(distIndexPath).href;
const distReactUrl = pathToFileURL(distReactPath).href;

/** Packages that MUST be inlined (absent as bare imports) in the committed dist. */
const MUST_BE_INLINED = [
  "@ulb-darmstadt/shacl-form",
  "n3",
  "shacl-engine",
  "@jeswr/fetch-rdf",
  "lit",
  "jsonld",
  "rdfxml-streaming-parser",
  "leaflet",
  "@ro-kit/ui-widgets",
  "uuid",
  // The Phase-1 data-model bindings — off-npm @jeswr packages + @solid/object —
  // must ALSO be inlined so a `github:jeswr/solid-components#main` install loads with
  // NO data-model dep installed (they are devDeps, bundled into dist, not declared
  // runtime deps a consumer resolves).
  "@jeswr/solid-task-model",
  "@jeswr/solid-task-model/task",
  "@jeswr/solid-task-model/contacts",
  "@jeswr/solid-bookmark",
  "@solid/object",
  "@solid/object/webid",
  "@rdfjs/wrapper",
];

/**
 * The ONLY specifiers allowed to remain external in the committed (BROWSER) dist.
 * Deliberately strict: a Node builtin appearing here is a FAILURE — these are
 * browser Web Components, and a `node:crypto` / `buffer` import breaks browser
 * bundlers (this exact regression was caught by roborev when the build used
 * `platform:"node"`). So the allow-list contains NO node builtin.
 */
const ALLOWED_EXTERNAL = new Set([
  "@jeswr/guarded-fetch", // dynamic import, optional remote-source guard only
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@lit/react",
  "<runtime>", // esbuild's internal runtime-helpers sentinel (not a real module)
]);

/** Node builtin module names — their presence in the BROWSER dist is a failure. */
const NODE_BUILTIN_RE = /^node:/;

function isAllowedExternal(spec: string): boolean {
  return ALLOWED_EXTERNAL.has(spec);
}

let distExternals: Set<string>;

beforeAll(() => {
  // Build the real committed pipeline into the working-tree dist/ so the import +
  // e2e assertions below load the freshly built artifact (check-dist-fresh
  // separately guards committed-vs-fresh drift).
  execFileSync(process.execPath, ["scripts/build-dist.mjs"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // Compute the dist's REAL external import graph via esbuild — in a clean Node
  // SUBPROCESS, because esbuild refuses to run inside vitest's jsdom environment
  // (jsdom's TextEncoder trips esbuild's TextEncoder invariant).
  const json = execFileSync(process.execPath, ["scripts/dist-imports.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  distExternals = new Set(JSON.parse(json) as string[]);
}, 120_000);

describe("§8 packaged-dist load smoke test", () => {
  it("the committed dist inlines every required dep + externalises only allowed peers", () => {
    const all = distExternals;
    for (const pkg of MUST_BE_INLINED) {
      expect
        .soft(all.has(pkg), `${pkg} must be INLINED, but the dist imports it as a bare module`)
        .toBe(false);
    }
    // Whatever DOES remain external must be on the (strict) allow-list.
    for (const spec of all) {
      expect
        .soft(isAllowedExternal(spec), `unexpected external import in dist: "${spec}"`)
        .toBe(true);
    }
    // BROWSER-LOAD GUARD: no Node builtin may be external (it would break browser
    // bundlers). This catches a regression to platform:"node" (roborev's High).
    for (const spec of all) {
      expect
        .soft(NODE_BUILTIN_RE.test(spec), `Node builtin "${spec}" must not be in the browser dist`)
        .toBe(false);
    }
  });

  it("imports the committed dist/index.js with NO optional peer installed", async () => {
    // A bare `import` of the built ESM. If the dist tried to resolve jsonld /
    // rdfxml-streaming-parser / leaflet (none of which a consumer installs), this
    // import would throw ERR_MODULE_NOT_FOUND. It does not, because they're inlined.
    const mod = await import(distIndexUrl);
    expect(typeof mod.DataController).toBe("function");
    expect(typeof mod.serializeTurtle).toBe("function");
    expect(typeof mod.JeswrShaclView).toBe("function");
    expect(typeof mod.NotFoundError).toBe("function");
    expect(typeof mod.resolveGraphToTurtle).toBe("function");
    // The Phase-1 per-class elements + the composer + the resolver are all present.
    expect(typeof mod.JeswrTaskList).toBe("function");
    expect(typeof mod.JeswrContactList).toBe("function");
    expect(typeof mod.JeswrProfileCard).toBe("function");
    expect(typeof mod.JeswrBookmarkList).toBe("function");
    expect(typeof mod.JeswrCollection).toBe("function");
    expect(typeof mod.SolidView).toBe("function");
    expect(typeof mod.resolveComponent).toBe("function");
    expect(Array.isArray(mod.RESOLVER_ENTRIES)).toBe(true);
  });

  it("the dist registers EVERY custom element + DataController works end-to-end", async () => {
    await import(distIndexUrl);
    for (const tag of [
      "jeswr-shacl-view",
      "jeswr-task-list",
      "jeswr-contact-list",
      "jeswr-profile-card",
      "jeswr-bookmark-list",
      "jeswr-collection",
      "solid-view",
    ]) {
      expect(customElements.get(tag), `${tag} must be registered by the dist`).toBeDefined();
    }

    const { DataController } = await import(distIndexUrl);
    const fetchStub = async () =>
      new Response('<https://x.example/a> <https://x.example/p> "v" .', {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      });
    const dc = new DataController({ fetch: fetchStub });
    const result = await dc.read("https://x.example/a");
    expect(result.dataset).toBeDefined();
    expect(
      result.dataset
        .getObjects("https://x.example/a", "https://x.example/p", null)
        .map((o: { value: string }) => o.value),
    ).toContain("v");
  });

  it("the committed dist/react/index.js loads + re-exports the API", async () => {
    const mod = await import(distReactUrl);
    expect(typeof mod.DataController).toBe("function");
    expect(typeof mod.JeswrShaclView).toBe("function");
  });
});
