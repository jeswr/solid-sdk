// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// BROWSER-BUNDLE SMOKE TEST — proves the root barrel (`.`) is browser-safe: no
// `node:fs` / `node:url` (or any other Node builtin) is reachable in its static
// import graph, so a browser bundler (Vite/Turbopack/webpack/esbuild itself) can
// bundle a client component that imports from `@jeswr/solid-task-model` at all.
//
// REGRESSION THIS GUARDS: the root barrel used to re-export the `node:fs`/
// `node:url`-using shape helpers (`taskShapeTtl` et al., from `./shape.ts`).
// Because a bundler must resolve a module's ENTIRE static import graph to parse
// it — not just the symbols a consumer actually uses — that ONE re-export broke
// EVERY consumer of the root entry in a browser build, including one that only
// wanted a pure vocab const (`TASK_CLASS` / `WF_OPEN` / `WF_CLOSED` / `wf`).
// This bit the `elk` fork transitively: it imports `@jeswr/solid-chat-interop`,
// whose `vocab.ts` re-exports those consts from THIS package's root, and its
// Nuxt/Vite PWA build failed with "Could not resolve node:fs" — worked around
// there with a `nuxt.config.ts` alias. That workaround is no longer needed once
// this test (and the `src/index.ts` fix it pins) lands.
//
// MECHANISM: run esbuild with `platform: "browser"` (so a Node builtin is NOT
// auto-resolved — esbuild has no browser shim for `node:fs`/`node:url` and, un-
// marked, treats them as an ordinary unresolvable path) over `src/index.ts`,
// externalising only the legitimate npm runtime deps (so we don't need a full
// bundle of `n3`/`@rdfjs/wrapper`, and so THEIR internals — which may be Node-
// targeted in places — don't produce unrelated resolve failures). A clean build
// proves no `node:*` specifier is reachable; metafile.inputs is asserted empty
// of any `node:`-prefixed entry as a second, independent check on the same
// build. `src/shape.test.browser-control` (below) is the negative control that
// proves this mechanism actually would have caught the original bug: bundling
// `./shape.ts` (the Node-only subpath) the SAME way must fail.
//
// esbuild runs fine here because `vitest.config.ts` sets `environment: "node"`
// (esbuild cannot run under vitest's jsdom environment — a documented conflict
// elsewhere in the suite — but this package never opts into jsdom).

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/** Legitimate npm runtime deps — externalised so only OUR graph is checked. */
const EXTERNAL_RUNTIME_DEPS = ["n3", "@rdfjs/wrapper", "@jeswr/fetch-rdf"];

async function bundleForBrowser(entryPoint: string) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    external: EXTERNAL_RUNTIME_DEPS,
    metafile: true,
    logLevel: "silent",
  });
}

describe("root barrel (`.`) is browser-safe (esbuild --platform=browser smoke test)", () => {
  it("bundles src/index.ts for a browser target with no resolve errors", async () => {
    const result = await bundleForBrowser("src/index.ts");
    expect(result.outputFiles).toHaveLength(1);
    // Belt-and-braces: the resolved import graph must contain no Node builtin
    // (`node:fs`, `node:url`, or any other `node:`-prefixed core module) and no
    // reference to `./shape` (the Node-only subpath module).
    const inputPaths = Object.keys(result.metafile.inputs);
    const nodeBuiltins = inputPaths.filter((p) => p.startsWith("node:"));
    const shapeModule = inputPaths.filter((p) => p.endsWith("shape.ts"));
    expect(nodeBuiltins).toEqual([]);
    expect(shapeModule).toEqual([]);
  });

  it("the bundled output contains no `node:` import specifier", async () => {
    const result = await bundleForBrowser("src/index.ts");
    const text = result.outputFiles[0]?.text ?? "";
    expect(text).not.toMatch(/\bnode:fs\b/);
    expect(text).not.toMatch(/\bnode:url\b/);
  });

  it("NEGATIVE CONTROL: bundling ./shape.ts the same way FAILS on node:fs/node:url (proves the mechanism actually detects the regression)", async () => {
    await expect(bundleForBrowser("src/shape.ts")).rejects.toThrow(/node:fs|node:url/);
  });
});
