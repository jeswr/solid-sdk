// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const entries = Object.entries(manifest.exports) as [string, { types: string; default: string }][];

it("declares the root and testing entry points on Node >=24", () => {
  expect(manifest.exports).toHaveProperty(".");
  expect(manifest.exports).toHaveProperty("./testing");
  expect(manifest.type).toBe("module");
  expect(manifest.engines.node).toBe(">=24");
});

it.each(entries)("resolves %s without exposing runtime capabilities", (subpath, target) => {
  expect(existsSync(fileURLToPath(new URL(`../${target.types}`, import.meta.url)))).toBe(true);
  const entry = new URL(`../${target.default}`, import.meta.url);
  const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
  expect(import.meta.resolve(specifier)).toBe(entry.href);
  expect(Object.keys(require(specifier))).toEqual([]);
});
