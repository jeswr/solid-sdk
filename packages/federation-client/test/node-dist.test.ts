// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DIST-LEVEL regression for the published-artifact `SsrfError` identity (roborev Medium).
// The source-level tests in `node.test.ts` import everything from `../src/*`, so the root
// guard module and the node module share ONE `SsrfError` class — they cannot catch a
// build that splits the class across the two emitted bundles. This test imports the BUILT
// artifacts (`dist/index.js` + `dist/node.js`) and asserts that an error thrown by the
// `./node` entry is `instanceof` the `SsrfError` exported from the ROOT entry — the
// property a consumer relies on (`import { SsrfError } from "@jeswr/federation-client"`
// catching an error from `@jeswr/federation-client/node`). It builds `dist/` once up front
// so it runs standalone.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

beforeAll(() => {
  // Build the committed-style dist (esbuild bundles + tsc declarations). This is the same
  // pipeline `npm run build` runs; we always rebuild so the test reflects current src.
  execFileSync("node", ["scripts/build-dist.mjs"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
}, 120_000);

describe("dist artifacts — SsrfError identity is shared across entries", () => {
  it("an error from dist/node.js is instanceof SsrfError from dist/index.js", async () => {
    expect(existsSync(new URL("../dist/index.js", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../dist/node.js", import.meta.url))).toBe(true);

    // Import the BUILT bundles (not the source) so we observe the published runtime.
    // Use the modules' own emitted types via `typeof import(...)` so the assertion is
    // checked against the real published shapes (no hand-written casts).
    const rootMod = (await import("../dist/index.js")) as typeof import("../src/index.js");
    const nodeMod = (await import("../dist/node.js")) as typeof import("../src/node.js");

    const fetchImpl = nodeMod.createNodeGuardedFetch();
    // A metadata-IP literal is rejected by the guard (which lives in the root bundle);
    // the error must be the ROOT bundle's SsrfError class.
    const err = await fetchImpl("https://169.254.169.254/").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(rootMod.SsrfError);
  });
});
