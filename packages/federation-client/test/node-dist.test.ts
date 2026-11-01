// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6.1-Sol
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
  // Build dist (esbuild bundles + tsc declarations). This is the same
  // pipeline `npm run build` runs; we always rebuild so the test reflects current src.
  execFileSync("node", ["scripts/build-dist.mjs"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
}, 120_000);

describe("dist artifacts — SsrfError identity is shared across entries", () => {
  it("loads the Node entry in native ESM without guard helpers on the public root", () => {
    // A fresh Node process exercises real ESM linking without Vitest's module transforms.
    // Both guarded calls refuse before any network request; DNS is injected for the second.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import assert from "node:assert/strict";
          import * as root from "./dist/index.js";
          import { createNodeGuardedFetch, nodeGuardedFetch } from "./dist/node.js";

          for (const name of [
            "createGuardedFetch", "guardedFetch", "isLoopbackAddress",
            "isPublicAddress", "classifyIpLiteral", "refuseRedirects",
          ]) {
            assert.equal(Object.hasOwn(root, name), false, name);
          }
          assert.equal(typeof root.SsrfError, "function");
          assert.equal(typeof root.RedirectRefusedError, "function");
          await assert.rejects(
            nodeGuardedFetch("https://169.254.169.254/"), root.SsrfError,
          );

          const lookups = [];
          const guarded = createNodeGuardedFetch({
            resolveAll: async (hostname) => {
              lookups.push(hostname);
              return [
                { address: "93.184.216.34", family: 4 },
                { address: "10.0.0.1", family: 4 },
              ];
            },
          });
          await assert.rejects(guarded("https://registry.example/"), root.SsrfError);
          assert.deepEqual(lookups, ["registry.example"]);
        `,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
  });

  it("an error from dist/node.js is instanceof SsrfError from dist/index.js", async () => {
    expect(existsSync(new URL("../dist/index.js", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../dist/node.js", import.meta.url))).toBe(true);

    // Import the BUILT bundles (not the source) so we observe the published runtime.
    // Use the modules' own emitted types via `typeof import(...)` so the assertion is
    // checked against the real published shapes (no hand-written casts).
    const rootMod = (await import("../dist/index.js")) as typeof import("../src/index.js");
    const nodeMod = (await import("../dist/node.js")) as typeof import("../src/node.js");

    const fetchImpl = nodeMod.createNodeGuardedFetch();
    // A metadata-IP literal is rejected by the shared guard; the error must be the
    // same SsrfError class that the root entry exports.
    const err = await fetchImpl("https://169.254.169.254/").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(rootMod.SsrfError);
  });
});
