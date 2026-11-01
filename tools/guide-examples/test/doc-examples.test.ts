// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { checkExamples } from "../../../scripts/check-sdk-skill-examples.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = [
  ...globSync("docs/guide/*.md", { cwd: root }).map((file) => join(root, file)),
  join(root, "skills/build-solid-app/SKILL.md"),
].filter((file) => existsSync(file));

it.skipIf(files.length === 0)("typechecks every available guide TypeScript fence", () => {
  expect(checkExamples(files).diagnostics).toEqual([]);
});
