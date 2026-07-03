// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// BROWSER-BUNDLE SMOKE TEST — proves the root barrel (`.`) is browser-safe: no
// `node:fs` / `node:url` (or any other Node builtin) is reachable in its static
// import graph, so a browser bundler (Vite/Turbopack/webpack/esbuild) can bundle a
// client component that imports from `@jeswr/solid-health-diary`. The whole diary
// UI (coeliac-app, Brief 1C) is a browser client, so this is load-bearing.
//
// MECHANISM (mirrors @jeswr/solid-task-model): run esbuild with
// `platform: "browser"` over `src/index.ts`, externalising only the legitimate npm
// runtime deps. A clean build + a metafile with no `node:`-prefixed input proves no
// Node builtin is reachable. `src/shape.ts` (the Node-only subpath) is the negative
// control: bundling it the same way MUST fail on node:fs/node:url — proving the
// mechanism would actually catch a regression.

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
  it("bundles src/index.ts for a browser target with no resolve errors + no node builtin", async () => {
    const result = await bundleForBrowser("src/index.ts");
    expect(result.outputFiles).toHaveLength(1);
    const inputPaths = Object.keys(result.metafile.inputs);
    expect(inputPaths.filter((p) => p.startsWith("node:"))).toEqual([]);
    expect(inputPaths.filter((p) => p.endsWith("shape.ts"))).toEqual([]);
  });

  it("the bundled output contains no `node:` import specifier", async () => {
    const result = await bundleForBrowser("src/index.ts");
    const text = result.outputFiles[0]?.text ?? "";
    expect(text).not.toMatch(/\bnode:fs\b/);
    expect(text).not.toMatch(/\bnode:url\b/);
  });

  it("NEGATIVE CONTROL: bundling ./shape.ts the same way FAILS on node:fs/node:url", async () => {
    await expect(bundleForBrowser("src/shape.ts")).rejects.toThrow(/node:fs|node:url/);
  });

  it("bundles the FULL consumer graph (runtime deps INCLUDED) for the browser with no resolve error", async () => {
    // The externalised smoke test above only checks OUR code; a Node-only import
    // hiding inside a runtime dep (n3 / @rdfjs/wrapper / @jeswr/fetch-rdf) would slip
    // through. Bundle the REAL browser consumer path with NO externals — esbuild's
    // `platform: "browser"` resolves each dep's browser export condition, so an
    // unshimmable `node:` builtin reachable from the barrel would make this throw.
    const result = await build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      external: [],
      logLevel: "silent",
    });
    expect(result.outputFiles).toHaveLength(1);
  });
});
