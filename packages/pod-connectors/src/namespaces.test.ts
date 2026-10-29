// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("takes jeswr namespace bases from suite-vocab in every production source file", () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const violations: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const path = relative(root, `${entry.parentPath}/${entry.name}`);
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)(__tests__|__snapshots__)\//.test(path))
      continue;
    if (
      /jeswr\.org\/ns\/|w3id\.org\/jeswr\//.test(
        readFileSync(new URL(path, import.meta.url), "utf8"),
      )
    )
      violations.push(path);
  }
  expect(violations).toEqual([]);
});
