// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkExamples } from "../scripts/check-sdk-skill-examples.mjs";
import { runCommand } from "./helpers/run-command.mjs";

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(markdown) {
  const directory = mkdtempSync(join(tmpdir(), "sdk-skill-test-"));
  temporary.push(directory);
  const file = join(directory, "SKILL.md");
  writeFileSync(file, markdown);
  return file;
}

it("checks independent fences, including types and top-level await, without executing them", () => {
  const file = fixture(
    [
      "```ts",
      "const value: string = await Promise.resolve('example');",
      "throw new Error('This code must never execute');",
      "```",
      "```typescript",
      "const value: URL = new URL('https://pod.example/');",
      "```",
    ].join("\r\n"),
  );
  expect(checkExamples([file])).toEqual({ examples: 2, diagnostics: [] });
});

it("rejects semantic errors and reports the Markdown line instead of a generated filename", () => {
  const file = fixture("# Example\n\n```ts\nconst count: number = 'wrong';\n```\n");
  const result = checkExamples([file]);
  expect(result.examples).toBe(1);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toContain(`${file}:4:`);
  expect(result.diagnostics[0]).toContain("not assignable to type 'number'");
});

it("does not supply undeclared app globals or accept unexported package APIs", () => {
  const file = fixture("```ts\nconst response = await authenticatedFetch('/');\n```\n");
  expect(checkExamples([file]).diagnostics.join("\n")).toContain(
    "Cannot find name 'authenticatedFetch'",
  );
  // pod-access deliberately exports no runtime API, even before its declarations are built.
  const missing = fixture("```ts\nimport { share } from '@jeswr/pod-access';\n```\n");
  expect(checkExamples([missing]).diagnostics).not.toEqual([]);
});

it("exits unsuccessfully for a bad example or an empty selection", () => {
  for (const file of [
    fixture("```ts\nconst value: number = false;\n```\n"),
    fixture("# No examples\n"),
  ]) {
    const result = runCommand(process.execPath, ["scripts/check-sdk-skill-examples.mjs", file]);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe("");
  }
});
