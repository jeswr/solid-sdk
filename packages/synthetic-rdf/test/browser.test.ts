// AUTHORED-BY GPT-5.6 Sol via codex

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

async function browserBundle(entryPoint: string) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
    external: ["@jeswr/rdf-serialize", "shacl-engine"],
  });
}

describe("browser-safe exports", () => {
  it.each([
    "src/index.ts",
    "src/validate.ts",
  ])("bundles %s with no Node built-ins", async (entryPoint) => {
    const result = await browserBundle(entryPoint);
    expect(result.outputFiles).toHaveLength(1);
    expect(
      Object.keys(result.metafile.inputs).filter((input) => input.startsWith("node:")),
    ).toEqual([]);
    expect(result.outputFiles[0]?.text).not.toMatch(/from ["']node:/);
  });
});
