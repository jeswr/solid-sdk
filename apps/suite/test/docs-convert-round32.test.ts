// @vitest-environment jsdom
// AUTHORED-BY Codex
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { normaliseImport } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
const text = (json: JSONContent) => schema.nodeFromJSON(json).textContent;

it.each([
  "strong",
  "b",
  "em",
  "i",
  "s",
  "strike",
  "del",
  "mark",
  "u",
  "sub",
  "sup",
  'a href="https://pod.test/report"',
])("round32 marked HTML blocks retain surrounding paragraphs through %s wrappers", (opening) => {
  const tag = opening.split(" ")[0];
  const result = importMarkdown(
    `Before.\n\n<${opening}>See <img src="https://pod.test/chart.png" alt="Chart"> below.</${tag}>\n\nAfter.`,
    "chart.md",
  );
  expect(text(result.json)).toBe("Before.See  below.After.");
  expect(result.json.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "paragraph",
    "image",
    "paragraph",
    "paragraph",
  ]);
  expect(result.json.content?.[2]?.marks).toBeUndefined();
  expect(result.json.content?.[1]?.content?.[0]?.marks).not.toHaveLength(0);
  expect(result.skipped).toEqual([]);
  expect(generateHTML(result.json, extensions)).toContain("After.");
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  '**See <img src="https://pod.test/chart.png"> below.**',
  "*See <hr> below.*",
  '[See <img src="https://pod.test/chart.png"> below.](https://pod.test/report)',
  "<strong>See <span><em><hr></em></span> below.</strong>",
  '# <strong>See <img src="https://pod.test/chart.png"> below.</strong>',
  '- <strong>See <img src="https://pod.test/chart.png"> below.</strong>',
  '> <strong>See <img src="https://pod.test/chart.png"> below.</strong>',
])("round32 every Markdown mark producer obeys the block mark invariant: %s", (source) => {
  const result = importMarkdown(`Before.\n\n${source}\n\nAfter.`, "blocks.md");
  expect(text(result.json)).toBe("Before.See  below.After.");
  expect(result.skipped).toEqual([]);
  schema.nodeFromJSON(result.json).check();
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  "image",
  "horizontalRule",
  "paragraph",
  "heading",
  "blockquote",
])("round32 the common import boundary removes inline marks from %s blocks", (type) => {
  const result = normaliseImport({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      {
        type,
        marks: [{ type: "bold" }],
        ...(type === "image" ? { attrs: { src: "https://pod.test/chart.png" } } : {}),
        ...(type === "blockquote" ? { content: [{ type: "paragraph" }] } : {}),
      },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ],
  });
  expect(result.json.content).toHaveLength(3);
  expect(result.json.content?.[1]?.marks).toBeUndefined();
  expect(result.skipped).toEqual([]);
});

it.each([
  ["<span>Type `</span>` to close.</span>", "Type </span> to close."],
  ["<strong>Type `</strong>` to close.</strong>", "Type </strong> to close."],
  ["<span>Type `` `</span>` `` to close.</span>", "Type `</span>` to close."],
  ["<span>Type ` <span> ` to open.</span>", "Type <span> to open."],
  ["<span><span>Type `</span>` to close.</span> done.</span>", "Type </span> to close. done."],
  ["<span>Type `</span>\ntext` to close.</span>", "Type </span> text to close."],
  ["<span>Type \\</span> to close.</span>", "Type </span> to close."],
  ["<span>Unmatched ` tick.</span>", "Unmatched ` tick."],
])("round32 HTML boundaries ignore CommonMark literal tags: %s", (source, expected) => {
  const result = importMarkdown(source, "literal.md");
  expect(text(result.json)).toBe(expected);
  expect(result.skipped).toEqual(
    source.includes("\n") ? [{ label: "Code span line breaks converted to spaces", count: 1 }] : [],
  );
  expect(generateHTML(result.json, extensions)).toContain(
    expected.includes("<") ? "&lt;" : expected,
  );
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it("round32 DOCX runs inherit paragraph styles unless a mark is present", async () => {
  const json = importMarkdown(
    "# Heading\n\n> Quote\n\nPlain **bold** *italic* ~~strike~~",
    "styles.md",
  ).json;
  const zip = await openArrayBuffer(await Packer.toArrayBuffer(await toDocx(json, vi.fn())));
  const xml = new DOMParser().parseFromString(
    await zip.read("word/document.xml", "utf-8"),
    "application/xml",
  );
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(xml.getElementsByTagNameNS(ns, "p"));
  for (const [index, style] of ["Heading1", "Quote"].entries()) {
    const p = paragraphs[index] as Element;
    expect(p.getElementsByTagNameNS(ns, "pStyle")[0]?.getAttributeNS(ns, "val")).toBe(style);
    expect(p.getElementsByTagNameNS(ns, "b")).toHaveLength(0);
    expect(p.getElementsByTagNameNS(ns, "i")).toHaveLength(0);
  }
  const runs = Array.from(xml.getElementsByTagNameNS(ns, "r"));
  for (const [label, property] of [
    ["bold", "b"],
    ["italic", "i"],
    ["strike", "strike"],
  ]) {
    const run = runs.find((node) => node.textContent === label) as Element;
    expect(run.getElementsByTagNameNS(ns, property as string)).toHaveLength(1);
  }
  expect(await zip.read("word/document.xml", "utf-8")).not.toMatch(
    /<w:(?:b|i|strike) w:val="false"/,
  );
});
