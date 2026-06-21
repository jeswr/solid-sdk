// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Packaged-dist load smoke test (requested in review): the committed `dist/` is
// what n8n actually loads (via require() of the CommonJS entries) and what a
// GitHub-branch consumer imports under ignore-scripts=true. A plain typecheck +
// vitest of the SOURCE would NOT catch a module-format mismatch (e.g. ESM `.js`
// emitted into a CommonJS package) — only loading the EMITTED artifact does.
//
// This test require()s the built CJS entries and asserts they load + instantiate
// AND that the inlined RDF path (the bundled @solid/object + @jeswr/fetch-rdf)
// actually runs. It builds the dist first if it is missing/stale so it is
// self-contained.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeJs = join(root, "dist", "nodes", "Solid", "Solid.node.js");
const credJs = join(root, "dist", "credentials", "SolidApi.credentials.js");
const libJs = join(root, "dist", "src", "index.js");
const require = createRequire(import.meta.url);

beforeAll(() => {
  // Ensure the dist exists (build it if a clean checkout hasn't yet). This is the
  // same bundle `npm run build` produces; check:dist guards committed freshness.
  if (!existsSync(nodeJs) || !existsSync(credJs) || !existsSync(libJs)) {
    execFileSync("node", [join(root, "scripts", "build-dist.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
  }
}, 120_000);

describe("packaged dist loads as CommonJS", () => {
  it("require()s the node entry and instantiates the INodeType", () => {
    // A successful require here is the actual assertion: an ESM `.js` in this
    // (CommonJS) package would throw 'Cannot use import statement outside a
    // module' on load.
    const mod = require(nodeJs) as { Solid: new () => { description: { name: string } } };
    const node = new mod.Solid();
    expect(node.description.name).toBe("solid");
  });

  it("require()s the credential entry and instantiates the ICredentialType", () => {
    const mod = require(credJs) as { SolidApi: new () => { name: string } };
    const cred = new mod.SolidApi();
    expect(cred.name).toBe("solidApi");
  });

  it("require()s the library entry with all exports present", () => {
    const lib = require(libJs) as Record<string, unknown>;
    expect(Object.keys(lib).sort()).toEqual([
      "assertWithinPod",
      "isContainerUrl",
      "normalizePodBase",
      "parseContainerListing",
      "resolveTarget",
    ]);
  });

  it("runs the INLINED RDF path (bundled @solid/object + @jeswr/fetch-rdf) from dist", async () => {
    const lib = require(libJs) as {
      parseContainerListing: (
        body: string,
        ct: string | null,
        container: string,
        base: string,
      ) => Promise<{ url: string }[]>;
    };
    const members = await lib.parseContainerListing(
      "@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<https://x.example/p/c/> ldp:contains <https://x.example/p/c/a.ttl> .",
      "text/turtle",
      "https://x.example/p/c/",
      "https://x.example/p/",
    );
    expect(members.map((m) => m.url)).toEqual(["https://x.example/p/c/a.ttl"]);
  });
});
