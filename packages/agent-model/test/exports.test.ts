// AUTHORED-BY Codex GPT-6.1-Sol

import * as model from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { existsSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { fileURLToPath } from "url";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const entries = Object.entries(manifest.exports) as [
  string,
  { types: string; import: string; default: string },
][];

it("declares the root and testing entry points on Node >=24", () => {
  expect(manifest.exports).toHaveProperty(".");
  expect(manifest.exports).toHaveProperty("./testing");
  expect(manifest.type).toBe("module");
  expect(manifest.engines.node).toBe(">=24");
});

it.each(entries)("resolves %s to built ESM and declarations", (subpath, target) => {
  expect(existsSync(fileURLToPath(new URL(`../${target.types}`, import.meta.url)))).toBe(true);
  const entry = new URL(`../${target.default}`, import.meta.url);
  const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
  expect(target.import).toBe(target.default);
  expect(import.meta.resolve(specifier)).toBe(entry.href);
  expect(existsSync(fileURLToPath(entry))).toBe(true);
});

it("exposes model conversion and synthetic fixtures through the public entry points", () => {
  const record = exampleRecords.account;
  expect(model.fromRdf(model.toRdf(record), record.id)).toEqual(record);
  expect(model.digestOf({ b: 2, a: 1 })).toBe(model.digestOf({ a: 1, b: 2 }));
  expect(Object.keys(exampleRecords)).toHaveLength(10);
});
