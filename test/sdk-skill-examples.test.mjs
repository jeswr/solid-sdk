// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

it.each([
  ["list", "- Example\n\n  ```ts\n  const count: number = 'wrong';\n  ```", 8],
  ["blockquote", "> Example\n>\n> ```typescript\n> const count: number = 'wrong';\n> ```", 8],
  ["tilde", "~~~ts\nconst count: number = 'wrong';\n~~~", 6],
  ["nested list and quote", "- Example\n  > ```ts\n  > const count: number = 'wrong';\n  > ```", 7],
])("checks %s fences and reports their original Markdown lines", (_kind, invalid, line) => {
  const file = fixture(["```ts", "const count: number = 1;", "```", "", invalid].join("\r\n"));
  const result = checkExamples([file]);
  expect(result.examples).toBe(2);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toContain(`${file}:${line}:`);
  expect(result.diagnostics[0]).toContain("not assignable to type 'number'");
});

it("preserves lines across reference definitions, task lists and repeated nested fences", () => {
  const file = fixture(
    [
      "[link]: https://example.org/",
      "",
      "- [x] Checked",
      "",
      "  [nested]: https://example.org/",
      "",
      "  ```ts",
      "  const count: number = 'wrong';",
      "  ```",
      "- Second item",
      "  ```ts",
      "  const count: number = 'wrong';",
      "  ```",
      "",
      "> - Quoted",
      ">   ~~~typescript",
      ">   const count: number = 'wrong';",
      ">   ~~~",
    ].join("\n"),
  );
  const result = checkExamples([file]);
  expect(result.examples).toBe(3);
  expect(result.diagnostics).toEqual(
    [8, 12, 17].map((line) => expect.stringContaining(`${file}:${line}:`)),
  );
});

it("checks only ts/typescript fences, leaving tsx and other languages unchecked", () => {
  const file = fixture(
    [
      "```tsx",
      "const bad: number = 'wrong';",
      "```",
      "",
      "~~~typescript",
      "const good: number = 1;",
      "~~~",
    ].join("\n"),
  );
  expect(checkExamples([file])).toEqual({ examples: 1, diagnostics: [] });
});

it("runs guide example tests from the root gate even for documentation-only changes", () => {
  const config = JSON.parse(readFileSync(new URL("../turbo.json", import.meta.url), "utf8"));
  expect(config.tasks["//#test:root"].dependsOn).toContain("@jeswr/guide-examples#test");
});

it("checks the new bookmark and RDF packages while skipping raw Turtle exports", () => {
  const file = fixture(
    [
      "```ts",
      "import { serializeBookmark, parseBookmarkTtl, type BookmarkData } from '@jeswr/solid-bookmark';",
      "import { BOOKMARK_CLASS } from '@jeswr/solid-bookmark/vocab';",
      "import { parseRdf } from '@jeswr/fetch-rdf';",
      "import { serialize } from '@jeswr/rdf-serialize';",
      "import { NS } from '@jeswr/suite-vocab';",
      "const url = 'https://pod.example/bookmark';",
      "const data: BookmarkData = { url: 'https://example.org/', tags: ['solid'] };",
      "const turtle: string = await serializeBookmark(url, data);",
      "const bookmark = await parseBookmarkTtl(url, turtle);",
      "const graph = await parseRdf(turtle, 'text/turtle', { baseIRI: url });",
      "const serialized: string = await serialize([...graph]);",
      "const iri: string = BOOKMARK_CLASS + NS.BOOKMARK;",
      "```",
    ].join("\n"),
  );
  expect(checkExamples([file])).toEqual({ examples: 1, diagnostics: [] });
});

it("resolves public external RDF declarations from installed workspace dependencies", () => {
  const file = fixture(
    [
      "```ts",
      "import { Container } from '@solid/object';",
      "import { TermWrapper } from '@rdfjs/wrapper';",
      "import { DataFactory, Store } from 'n3';",
      "const graph = new Store();",
      "const term = DataFactory.namedNode('https://pod.example/container/');",
      "const container = new Container(term, graph, DataFactory);",
      "const wrapper: TermWrapper = container;",
      "```",
    ].join("\n"),
  );
  expect(checkExamples([file])).toEqual({ examples: 1, diagnostics: [] });
});

it("does not supply undeclared app globals or accept unexported package APIs", () => {
  const file = fixture("```ts\nconst response = await authenticatedFetch('/');\n```\n");
  expect(checkExamples([file]).diagnostics.join("\n")).toContain(
    "Cannot find name 'authenticatedFetch'",
  );
  // pod-access exports the translation core, but its planned sharing API remains unimplemented.
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
  // Two type-checking CLI runs; CI runners take just over vitest's 5 s default.
}, 30000);
