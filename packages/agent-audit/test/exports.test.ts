// AUTHORED-BY Codex GPT-6.1-Sol

import * as entry0 from "@jeswr/agent-audit";
import * as entry1 from "@jeswr/agent-audit/testing";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { existsSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { fileURLToPath } from "url";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const modules: Record<string, object> = {
  ".": entry0,
  "./testing": entry1,
};
const entries = Object.entries(manifest.exports) as [string, { types: string; default: string }][];

it("declares the root and testing entry points on Node >=24", () => {
  expect(Object.keys(modules)).toEqual(Object.keys(manifest.exports));
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
  expect(Object.getOwnPropertyNames(modules[subpath])).toEqual([]);
});
