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
  " cat ",
  "  cat  ",
  " cat",
  "cat ",
  " ",
  "   ",
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

it("round trips generated inline code with backtick runs, edge backticks and edge spaces", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      fc.boolean(),
      fc.constantFrom("", " ", "  "),
      fc.constantFrom("", " ", "  "),
      (runs, start, end, leading, trailing) => {
        const value = `${leading}${start ? "`" : "before"}${runs.map((length) => "`".repeat(length)).join("text")}after${end ? "`" : ""}${trailing}`;
        const original = paragraphs([value]);
        const node = original.content?.[0]?.content?.[0] as JSONContent;
        node.marks = [{ type: "code" }];
        const exported = exportMarkdown(original);
        const delimiter = "`".repeat(
          Math.max(...(value.match(/`+/g) as string[]).map((run) => run.length)) + 1,
        );
        const padding =
          value.startsWith("`") || value.endsWith("`") || (leading && trailing) ? " " : "";
        expect(exported).toBe(`${delimiter}${padding}${value}${padding}${delimiter}`);
        expect(importMarkdown(exported, "inline.md").json).toEqual(original);
      },
    ),
    { seed: 1417, numRuns: 500 },
  );
});

it("round trips generated links and images with Markdown punctuation in labels, titles and URLs", () => {
  const value = fc
    .array(fc.constantFrom(..."abc []\\\"'()|<>*`&\n\r"), { minLength: 1, maxLength: 30 })
    .map((chars) => chars.join(""));
  const url = fc
    .array(
      fc.constantFrom(
        "path",
        " ",
        "(",
        ")",
        "[",
        "]",
        "\\",
        "&amp;",
        "|",
        "<",
        ">",
        "\n",
        "\r",
        "\t",
        '"',
        "'",
      ),
      {
        maxLength: 12,
      },
    )
    .map((chars) => `https://pod.test/${chars.join("")}end`);
  fc.assert(
    fc.property(value, fc.option(value, { nil: null }), url, (label, title, rawDestination) => {
      // Angle brackets and line controls have canonical percent-encoded URL
      // spellings; ordinary spaces and parentheses remain in the document URL.
      const destination = rawDestination.replace(/[<>\r\n\t]/g, encodeURIComponent);
      const original = importMarkdown(
        "[link](https://pod.test/)\n\n![alt](https://pod.test/)",
        "links.md",
      ).json;
      const link = original.content?.[0]?.content?.[0] as JSONContent;
      link.text = label;
      const attrs = link.marks?.[0]?.attrs as Record<string, unknown>;
      attrs.href = destination;
      attrs.title = title;
      const image = original.content?.[1] as JSONContent;
      image.attrs = { ...image.attrs, src: destination, alt: label, title };
      expect(importMarkdown(exportMarkdown(original), "generated.md").json).toEqual(original);
      const unencoded = structuredClone(original);
      const unencodedLink = unencoded.content?.[0]?.content?.[0]?.marks?.[0]?.attrs as Record<
        string,
        unknown
      >;
      unencodedLink.href = rawDestination;
      const unencodedImage = unencoded.content?.[1] as JSONContent;
      unencodedImage.attrs = { ...unencodedImage.attrs, src: rawDestination };
      expect(importMarkdown(exportMarkdown(unencoded), "generated.md").json).toEqual(original);
    }),
    { seed: 1507, numRuns: 500 },
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
