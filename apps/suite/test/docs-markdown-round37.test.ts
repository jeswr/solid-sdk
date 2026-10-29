// @vitest-environment jsdom
// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
function roundTrip(json: JSONContent) {
  const dom = new DOMParser().parseFromString(generateHTML(json, extensions), "text/html");
  expect(
    SchemaDOMParser.fromSchema(schema).parse(dom.body, { preserveWhitespace: "full" }).toJSON(),
  ).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it.each([
  "> - Report\n===",
  "- - Report\n===",
  "> > - Report\n===",
  "- > - Report\n===",
  "4. - [ ] Report\n===",
  "- - - Report\n===\t",
  "> - - Report\n> ===",
  "- > Report\n  ===",
])("round37 lazy underlines remain prose through every nested container: %s", (source) => {
  const result = importMarkdown(source, "report.md");
  const headings: string[] = [];
  const node = schema.nodeFromJSON(result.json);
  node.descendants((child) => {
    if (child.type.name === "heading") headings.push(child.textContent);
  });
  expect(headings).toEqual([]);
  expect(node.textContent).toContain("Report\n===");
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it.each([
  "- Report\n  ===",
  "4. Report\n   ===",
  "- [ ] Report\n  ===",
  "- Parent\n  - Report\n    ===",
  "- > Report\n  > ===",
  "- Report\n  --",
  "- | A | B |\n  | - | - |",
  "- First\n- Report\n  ===",
  "- [ ] > Report\n  > ===",
  "> - Report\n>   ===",
  "- > # Heading",
  "- ```\n  code\n  ```",
  "-     code",
  "- <p>HTML</p>",
])("round37 lazy list continuation requires an open paragraph after %s", (prefix) => {
  const result = importMarkdown(`${prefix}\nSummary outside the list`, "report.md");
  expect(result.json.content).toHaveLength(2);
  expect(result.json.content?.[1]).toMatchObject({
    type: "paragraph",
    content: [{ type: "text", text: "Summary outside the list" }],
  });
  expect(schema.nodeFromJSON(result.json.content?.[0] as JSONContent).textContent).not.toContain(
    "Summary",
  );
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it.each([
  "- Report\n  more detail",
  "- - Report\n===",
  "- [ ] Report",
  "- > Report",
  "> - [ ] Report",
  "> - Report\n===",
  "> - - Report\n===",
  "- > - Report\n===",
])("round37 an open nested paragraph still permits lazy continuation after %s", (prefix) => {
  const result = importMarkdown(`${prefix}\nLazy prose`, "report.md");
  expect(result.json.content).toHaveLength(1);
  expect(schema.nodeFromJSON(result.json).textContent).toContain("Lazy prose");
  if (prefix.endsWith("==="))
    expect(schema.nodeFromJSON(result.json).textContent).toContain("===\nLazy prose");
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});
