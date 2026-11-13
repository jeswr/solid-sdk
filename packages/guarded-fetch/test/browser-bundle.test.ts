// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the root for browsers and workers without undici or Node polyfills", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
  });
  expect(result.outputFiles).toHaveLength(1);
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  expect(inputs.some((path) => path.endsWith("src/guard.ts"))).toBe(true);
  expect(inputs.some((path) => path.includes("undici") || path.startsWith("node:"))).toBe(false);
  expect(Object.values(result.metafile?.outputs ?? {}).flatMap((output) => output.imports)).toEqual(
    [],
  );
});
