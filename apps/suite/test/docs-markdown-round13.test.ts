// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import fc from "fast-check";
import { expect, it } from "vitest";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const paragraphs = (values: string[]): JSONContent => ({
  type: "doc",
  content: values.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

it("round trips an imported escaped heading as a literal paragraph", () => {
  const original = importMarkdown("\\# Notes", "notes.md").json;
  expect(original).toEqual(paragraphs(["# Notes"]));
  expect(importMarkdown(exportMarkdown(original), "notes.md").json).toEqual(original);
});

it.each([
  "# Notes",
  "> quote",
  "- item",
  "+ item",
  "* item",
  "1. item",
  "12) item",
  "```js",
  "~~~",
  "---",
  "***",
  "___",
  "===",
  "text\n---",
  "text\n===",
  " leading",
  "    indented",
  "trailing  ",
  " ",
  "*bold* _italic_ `code`",
  "[link](https://example.org) ![image](https://example.org/a.png)",
  "<b>literal</b>",
  "back\\slash",
  "a | b\n--- | ---",
  "==literal==",
  "&copy;",
  "DOCSLITERAL0END DOCSLITERALX0END",
  "\t\r\n ",
])("preserves literal Markdown paragraph text %j", (text) => {
  const original = paragraphs([text]);
  expect(importMarkdown(exportMarkdown(original), "literal.md").json).toEqual(original);
});

it("round trips generated paragraphs containing Markdown block and inline syntax", () => {
  const character = fc.constantFrom(..."abc XYZ0123#>-+*._`[]<>()\\!~=|&\n");
  const paragraph = fc
    .array(character, { minLength: 1, maxLength: 60 })
    .map((chars) => chars.join(""));
  fc.assert(
    fc.property(fc.array(paragraph, { minLength: 1, maxLength: 6 }), (values) => {
      const original = paragraphs(values);
      expect(importMarkdown(exportMarkdown(original), "generated.md").json).toEqual(original);
    }),
    { seed: 1307, numRuns: 500 },
  );
});

it("escapes text around block images and exports image-only list items", () => {
  const image: JSONContent = {
    type: "image",
    attrs: { src: "https://pod.test/image.png", alt: "Photo" },
  };
  const original: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "# before" }, image, { type: "text", text: "+ after" }],
      },
    ],
  };
  const result = importMarkdown(exportMarkdown(original), "images.md").json;
  expect(result.content?.map((node) => node.type)).toEqual(["paragraph", "image", "paragraph"]);
  expect(result.content?.[0]?.content?.[0]?.text).toBe("# before");
  expect(result.content?.[2]?.content?.[0]?.text).toBe("+ after");
  expect(
    exportMarkdown({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [image] }] }],
    }),
  ).toContain("![Photo](https://pod.test/image.png)");
});
