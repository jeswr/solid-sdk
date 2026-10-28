// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { expect, it } from "vitest";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

function linkedImage(label: string, title: string | null, url: string): JSONContent {
  const original = importMarkdown(
    "[link](https://pod.test/)\n\n![alt](https://pod.test/)",
    "links.md",
  ).json;
  const link = original.content?.[0]?.content?.[0] as JSONContent;
  link.text = label;
  const attrs = link.marks?.[0]?.attrs as Record<string, unknown>;
  attrs.href = url;
  attrs.title = title;
  const image = original.content?.[1] as JSONContent;
  image.attrs = { ...image.attrs, src: url, alt: label, title };
  return original;
}

it("exports an image with omitted alt and title as an empty label without undefined attributes", () => {
  const exported = exportMarkdown({
    type: "doc",
    content: [{ type: "image", attrs: { src: "https://pod.test/image.png" } }],
  });
  expect(exported).toBe("![](https://pod.test/image.png)");
  expect(importMarkdown(exported, "image.md").json.content?.[0]?.attrs).toMatchObject({
    src: "https://pod.test/image.png",
    alt: "",
    title: null,
  });
});

it.each([
  ["Right bracket ]", null],
  ["Left bracket [ and backslash \\[]", 'A "double-quoted" title'],
  ["line one\n\nline two\r\t", "A 'single-quoted' title"],
  ["&copy; &amp; &#93;", "Both ' and \" plus \\ &copy;\r\nnext"],
  ['<div onclick="bad()">\n<script>literal</script>\n</div>', "<html> & title"],
])("round trips link text and image alt %j with a quoted title", (label, title) => {
  const original = linkedImage(label as string, title ?? null, "https://pod.test/image.png");
  expect(importMarkdown(exportMarkdown(original), "labels.md").json).toEqual(original);
});

it.each([
  "https://pod.test/a b.png",
  "https://pod.test/a  b).png",
  "https://pod.test/(unbalanced.png",
  "https://pod.test/unbalanced).png",
])("uses an angle destination for link and image URLs containing spaces or parentheses: %j", (url) => {
  const original = linkedImage("label", "title", url);
  const exported = exportMarkdown(original);
  expect(exported.match(/\(<https:\/\/pod.test\//g)).toHaveLength(2);
  expect(importMarkdown(exported, "destinations.md").json).toEqual(original);
});

it("percent-encodes angle brackets and line controls in destinations without losing links or images", () => {
  const original = linkedImage("label", null, "https://pod.test/a<b>\r\n\t.png");
  const exported = exportMarkdown(original);
  expect(exported).toContain("https://pod.test/a%3Cb%3E%0D%0A%09.png");
  expect(importMarkdown(exported, "encoded.md").json).toEqual(
    linkedImage("label", null, "https://pod.test/a%3Cb%3E%0D%0A%09.png"),
  );
});

it("round trips table cells with literal pipes, newlines, HTML, padded code and link/image attributes", () => {
  const original = importMarkdown(
    "| Header | Image |\n| --- | --- |\n| Body | Image |",
    "table.md",
  ).json;
  const table = original.content?.[0] as JSONContent;
  const header = table.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0] as JSONContent;
  header.text = "Header | slash\\|\n<div>literal</div>  spaced";
  const row = table.content?.[1] as JSONContent;
  const cells = row.content as JSONContent[];
  const linked = linkedImage(
    "Link | []\\\ntext",
    'Title | "quotes"  &copy;\nnext',
    "https://pod.test/a | b).png",
  );
  const paragraph = linked.content?.[0] as JSONContent;
  paragraph.content?.push({ type: "text", text: " code | ", marks: [{ type: "code" }] });
  (cells[0] as JSONContent).content = [paragraph];
  (cells[1] as JSONContent).content = [linked.content?.[1] as JSONContent];
  expect(importMarkdown(exportMarkdown(original), "table.md").json).toEqual(original);
});

it.each([
  "<div>\nLiteral HTML block\n</div>",
  "<!-- comment -->\n<script>literal()</script>",
  "<!DOCTYPE html>\n<?processing instruction?>",
])("exports literal HTML blocks as inert paragraph text: %j", (text) => {
  const original: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  const exported = exportMarkdown(original);
  expect(exported).not.toMatch(/(^|[^\\])</);
  expect(importMarkdown(exported, "html.md").json).toEqual(original);
});

it("keeps a code-block info string from injecting a fence or an HTML block", () => {
  const exported = exportMarkdown({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: "js`\n```\r<div>" },
        content: [{ type: "text", text: "code" }],
      },
    ],
  });
  expect(exported.split("\n")).toHaveLength(3);
  expect(importMarkdown(exported, "code.md").json.content?.map((node) => node.type)).toEqual([
    "codeBlock",
  ]);
});
