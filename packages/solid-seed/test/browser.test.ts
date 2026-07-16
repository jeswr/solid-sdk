// AUTHORED-BY GPT-5.6 Sol via codex

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the main entry for a browser without Node built-ins", async () => {
  const entryPoint = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
  });
  expect(result.outputFiles).toHaveLength(1);
  expect(Object.keys(result.metafile.inputs).some((value) => value.startsWith("node:"))).toBe(
    false,
  );

  const sources = await Promise.all(
    ["index.ts", "rdf.ts", "seed.ts", "types.ts"].map((name) =>
      readFile(new URL(`../src/${name}`, import.meta.url), "utf8"),
    ),
  );
  expect(sources.join("\n")).not.toMatch(/(?:from|import\s*\()["']node:/u);
});
