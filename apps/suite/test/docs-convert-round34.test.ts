// @vitest-environment jsdom
// AUTHORED-BY Codex
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
const text = (json: JSONContent) => schema.nodeFromJSON(json).textContent;
function roundTrip(json: JSONContent) {
  expect(generateJSON(generateHTML(json, extensions), extensions)).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it.each([
  "# Quoted heading",
  "Heading\n===",
  "---",
  "~~~\ncode\n~~~",
  "    indented code",
  "<p>HTML</p>",
  "- # List heading",
  "-",
  "- [ ]",
  "1. # Ordered heading",
  "- [ ] # Task heading",
  "- > # Nested list heading",
  "| Head |\n| --- |\n| Data |",
  "> # Nested heading",
  "Paragraph\n",
  "> Paragraph\n>",
])("round34 lazy quote continuation requires an open paragraph after %s", (quoted) => {
  const quote = quoted
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  for (const parent of ["root", "quote", "list"]) {
    const source = `${quote}\nMy reply`;
    const result = importMarkdown(
      parent === "root"
        ? source
        : parent === "quote"
          ? source
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")
          : `- Parent\n\n${source
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n")}`,
      "quote.md",
    );
    const children =
      parent === "root"
        ? result.json.content
        : parent === "quote"
          ? result.json.content?.[0]?.content
          : result.json.content?.[0]?.content?.[0]?.content?.slice(1);
    expect(children?.map((node) => node.type)).toEqual(["blockquote", "paragraph"]);
    expect(text(children?.[0] as JSONContent)).not.toContain("My reply");
    expect(text(children?.[1] as JSONContent)).toBe("My reply");
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
  }
});

it.each([
  "Paragraph",
  "- Paragraph",
  "> Paragraph",
  "# Heading\nParagraph",
])("round34 open quote paragraphs still accept lazy prose after %s", (quoted) => {
  const result = importMarkdown(
    `${quoted
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\ncontinued`,
    "quote.md",
  );
  expect(result.json.content).toHaveLength(1);
  expect(text(result.json)).toContain("Paragraph\ncontinued");
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
  expect(generateJSON(generateHTML(result.json, extensions), extensions).content).toHaveLength(1);
});

it.each([
  "[![Build status](https://pod.test/badge.png)](https://example.org/actions)",
  '<a href="https://example.org/actions"><img src="https://pod.test/badge.png" alt="Build status"></a>',
  "[![Build status][badge]][actions]\n\n[badge]: https://pod.test/badge.png\n[actions]: https://example.org/actions",
])("round34 linked block images preserve their destination: %s", (source) => {
  const result = importMarkdown(source, "badge.md");
  expect(result.json.content?.[0]).toMatchObject({
    type: "image",
    attrs: { alt: "Build status", link: { href: "https://example.org/actions" } },
  });
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it("round34 image links survive every block container and HTML import boundary", () => {
  const image: JSONContent = {
    type: "image",
    attrs: { src: "https://pod.test/badge.png", alt: "Build status" },
    marks: [{ type: "link", attrs: { href: "https://example.org/actions" } }, { type: "bold" }],
  };
  const containers: JSONContent[][] = [
    [image],
    [{ type: "blockquote", content: [image] }],
    ...["listItem", "taskItem"].map((type) => [
      {
        type: type === "listItem" ? "bulletList" : "taskList",
        content: [{ type, content: [{ type: "paragraph" }, image] }],
      },
    ]),
    ...["tableCell", "tableHeader"].map((type) => [
      { type: "table", content: [{ type: "tableRow", content: [{ type, content: [image] }] }] },
    ]),
  ];
  for (const content of containers) {
    const result = normaliseImport({ type: "doc", content });
    const parsed = schema.nodeFromJSON(result.json);
    const images: JSONContent[] = [];
    parsed.descendants((node) => {
      if (node.type.name === "image") images.push(node.toJSON());
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs?.link?.href).toBe("https://example.org/actions");
    expect(images[0]?.marks).toBeUndefined();
    roundTrip(result.json);
  }
  const html =
    '<a href="https://example.org/actions"><img src="https://pod.test/badge.png" alt="Build status"></a>';
  const imported = importHtml(html);
  expect(imported.json.content?.[0]?.attrs?.link?.href).toBe("https://example.org/actions");
  roundTrip(imported.json);
});

it.each([
  [
    "![Status: ![passed](https://pod.test/badge.png)](https://pod.test/chart.png)",
    "Status: passed",
  ],
  [
    "![Status: ![**passed** and ready](https://pod.test/badge.png)](https://pod.test/chart.png)",
    "Status: passed and ready",
  ],
  [
    "![Status: ![passed][badge]](https://pod.test/chart.png)\n\n[badge]: https://pod.test/badge.png",
    "Status: passed",
  ],
  [
    '![Status: <img src="https://pod.test/badge.png" alt="passed">](https://pod.test/chart.png)',
    "Status: passed",
  ],
  ['![Status: <img src="https://pod.test/badge.png">](https://pod.test/chart.png)', "Status: "],
])("round34 nested image descriptions retain all accessible text: %s", (source, alt) => {
  const result = importMarkdown(source, "chart.md");
  expect(result.json.content?.[0]?.attrs?.alt).toBe(alt);
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it("round34 embedded image links obey the shared destination policy", () => {
  for (const link of [
    { href: "javascript:alert(1)" },
    { href: "https://user:pass@pod.test/" },
    true,
  ]) {
    const result = normaliseImport({
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://pod.test/image.png", link } }],
    });
    expect(result.json.content?.[0]?.attrs?.link).toBeNull();
    expect(result.skipped).toContainEqual({ label: "Unsafe URLs", count: 1 });
  }
  const result = normaliseImport({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "https://pod.test/image.png",
          link: { href: "https://example.org/合同 signed.pdf" },
        },
      },
    ],
  });
  expect(result.json.content?.[0]?.attrs?.link?.href).toBe(
    "https://example.org/%E5%90%88%E5%90%8C%20signed.pdf",
  );
  roundTrip(result.json);
});
