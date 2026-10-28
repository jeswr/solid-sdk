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

it("round trips a four-backtick code block containing a three-backtick line and literal heading", () => {
  const original = importMarkdown(
    "````markdown\nbefore\n```\n# literal heading\n````",
    "code.md",
  ).json;
  expect(original.content).toHaveLength(1);
  expect(original.content?.[0]?.type).toBe("codeBlock");
  expect(importMarkdown(exportMarkdown(original), "code.md").json).toEqual(original);
});

it.each([
  "a`b",
  "`",
  "````",
  "`before",
  "after`",
  "plain",
])("round trips inline code %j with a delimiter longer than every content run", (value) => {
  const original: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: value, marks: [{ type: "code" }] }],
      },
    ],
  };
  expect(importMarkdown(exportMarkdown(original), "inline.md").json).toEqual(original);
});

it("exports empty code blocks with and without language attributes", () => {
  for (const node of [
    { type: "codeBlock" },
    { type: "codeBlock", attrs: { language: "js" } },
    { type: "codeBlock", attrs: {}, content: [] },
  ]) {
    const original: JSONContent = { type: "doc", content: [node] };
    const exported = exportMarkdown(original);
    expect(exported).toBe(`\`\`\`${node.attrs?.language ?? ""}\n\n\`\`\``);
    expect(importMarkdown(exported, "empty.md").json.content?.[0]?.type).toBe("codeBlock");
  }
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

it("round trips generated code blocks containing backtick and tilde fence-like lines", () => {
  const fenceLine = fc
    .tuple(
      fc.constantFrom("`", "~"),
      fc.integer({ min: 1, max: 12 }),
      fc.constantFrom("", " ", "  ", "   ", "    "),
      fc.constantFrom("", " trailing", "js"),
    )
    .map(([char, length, indent, suffix]) => `${indent}${char.repeat(length)}${suffix}`);
  fc.assert(
    fc.property(
      fc.array(fenceLine, { minLength: 1, maxLength: 8 }),
      fc.constantFrom("", "js", "markdown linenums=1"),
      (lines, info) => {
        const body = ["before", ...lines, "# literal heading", "after"].join("\n");
        const fence = "`".repeat(15);
        const original = importMarkdown(`${fence}${info}\n${body}\n${fence}`, "code.md").json;
        expect(original.content).toHaveLength(1);
        expect(importMarkdown(exportMarkdown(original), "code.md").json).toEqual(original);
      },
    ),
    { seed: 1407, numRuns: 500 },
  );
});

it("round trips generated inline code with backtick runs and edge backticks", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      fc.boolean(),
      (runs, start, end) => {
        const value = `${start ? "`" : "before"}${runs.map((length) => "`".repeat(length)).join("text")}after${end ? "`" : ""}`;
        const original = importMarkdown(
          `Use ${"`".repeat(80)} ${value} ${"`".repeat(80)} here.`,
          "inline.md",
        ).json;
        const exported = exportMarkdown(original);
        const delimiter = "`".repeat(
          Math.max(...(value.match(/`+/g) as string[]).map((run) => run.length)) + 1,
        );
        expect(exported).toContain(
          `${delimiter}${start || end ? " " : ""}${value}${start || end ? " " : ""}${delimiter}`,
        );
        expect(importMarkdown(exported, "inline.md").json).toEqual(original);
      },
    ),
    { seed: 1417, numRuns: 500 },
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
