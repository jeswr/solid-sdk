// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { build } from "esbuild";
import { expect, it } from "vitest";

// The suite agent app signs approvals and control statements in the browser (A-016).
// Both entries must bundle for the browser with no Node builtins reachable.
for (const entry of ["approval", "control", "mandate", "issue", "verify"]) {
  it(`bundles the ${entry} entry for browsers without Node builtins`, async () => {
    const result = await build({
      entryPoints: [decodeURIComponent(new URL(`../src/${entry}.ts`, import.meta.url).pathname)],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    expect(result.errors).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs).not.toContainEqual(expect.stringMatching(/^node:/));
    // platform "browser" fails the build on any unresolvable builtin such as "crypto".
    expect(inputs).not.toContainEqual(expect.stringMatching(/(?:^|\/)(?:crypto|zlib)(?:\.js)?$/));
  });
}
