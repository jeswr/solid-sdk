// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("resolves every published scaffold entry without exposing runtime capabilities", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.exports).toHaveProperty(".");
  expect(manifest.exports).toHaveProperty("./testing");
  expect(manifest.engines.node).toBe(">=24");
  for (const [subpath, target] of Object.entries(manifest.exports) as [
    string,
    { types: string; default: string },
  ][]) {
    expect(existsSync(fileURLToPath(new URL(`../${target.types}`, import.meta.url)))).toBe(true);
    const entry = new URL(`../${target.default}`, import.meta.url);
    const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
    expect(import.meta.resolve(specifier)).toBe(entry.href);
    expect(Object.keys(await import(specifier))).toEqual([]);
  }
});
