// @vitest-environment jsdom
// AUTHORED-BY Codex
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { Document, ImageRun, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
const pixel = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const readImage = async () => ({ data: pixel, type: "png" as const, width: 1, height: 1 });
function roundTrip(json: JSONContent) {
  expect(generateJSON(generateHTML(json, extensions), extensions)).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it("round35 DOCX image-only numbered steps retain their item and following numbering", async () => {
  const document = new Document({
    numbering: {
      config: [
        { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1." }] },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({
            numbering: { reference: "steps", level: 0 },
            children: [new TextRun("Open settings")],
          }),
          new Paragraph({
            numbering: { reference: "steps", level: 0 },
            children: [
              new ImageRun({ data: pixel, type: "png", transformation: { width: 10, height: 10 } }),
            ],
          }),
          new Paragraph({
            numbering: { reference: "steps", level: 0 },
            children: [new TextRun("Save changes")],
          }),
        ],
      },
    ],
  });
  const imported = await importDocx(await Packer.toArrayBuffer(document), {
    uploadImage: async () => "https://pod.test/chart.png",
    progress: vi.fn(),
  });
  const result = importHtml(imported.html);
  expect(result.json.content?.map((node) => node.type)).toEqual(["orderedList"]);
  const items = result.json.content?.[0]?.content;
  expect(items).toHaveLength(3);
  expect(items?.[1]?.content?.map((node) => node.type)).toEqual(["paragraph", "image"]);
  expect(schema.nodeFromJSON(items?.[2]).textContent).toBe("Save changes");
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it.each([
  "ol",
  "ul",
  "task",
])("round35 image-only HTML paragraphs retain %s ancestry at every depth", (kind) => {
  const list = kind === "task" ? 'ul data-type="taskList"' : kind;
  const end = kind === "ol" ? "ol" : "ul";
  const item = kind === "task" ? 'li data-type="taskItem" data-checked="true"' : "li";
  const html = `<${list}><${item}><p>Parent</p><${list}><${item}><p><a href="https://example.org/"><img src="https://pod.test/chart.png" alt="Chart"></a></p></li><${item}><p>After</p></li></${end}></li></${end}>`;
  const result = importHtml(html);
  const type = kind === "ol" ? "orderedList" : kind === "ul" ? "bulletList" : "taskList";
  const nested = result.json.content?.[0]?.content?.[0]?.content?.[1];
  expect(nested?.type).toBe(type);
  expect(nested?.content).toHaveLength(2);
  expect(nested?.content?.[0]?.content?.map((node) => node.type)).toEqual(["paragraph", "image"]);
  expect(nested?.content?.[0]?.content?.[1]?.attrs?.link?.href).toBe("https://example.org/");
  roundTrip(result.json);
});

it.each([
  "root",
  "quote",
  "list",
  "table",
])("round35 DOCX linked images have a usable OOXML hyperlink in %s", async (parent) => {
  const image = importMarkdown(
    "[![Build status](https://pod.test/badge.png)](https://example.org/actions)",
    "badge.md",
  ).json.content?.[0] as JSONContent;
  const content =
    parent === "root"
      ? [image]
      : parent === "quote"
        ? [{ type: "blockquote", content: [image] }]
        : parent === "list"
          ? [
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [{ type: "paragraph" }, image] }],
              },
            ]
          : [
              {
                type: "table",
                content: [{ type: "tableRow", content: [{ type: "tableCell", content: [image] }] }],
              },
            ];
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(await toDocx({ type: "doc", content }, readImage)),
  );
  const xml = new DOMParser().parseFromString(
    await zip.read("word/document.xml", "utf-8"),
    "application/xml",
  );
  const link = xml.getElementsByTagName("w:hyperlink")[0];
  expect(link?.getElementsByTagName("w:drawing")).toHaveLength(1);
  const rels = new DOMParser().parseFromString(
    await zip.read("word/_rels/document.xml.rels", "utf-8"),
    "application/xml",
  );
  const relation = Array.from(rels.getElementsByTagName("Relationship")).find(
    (rel) => rel.getAttribute("Id") === link?.getAttribute("r:id"),
  );
  expect(relation?.getAttribute("Target")).toBe("https://example.org/actions");
  expect(relation?.getAttribute("TargetMode")).toBe("External");
  expect(relation?.getAttribute("Type")).toBe(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  );
});

it.each([
  "[source]: https://example.org",
  "[source]:\n  https://example.org",
  "- [source]: https://example.org",
  "> [source]: https://example.org",
  "- [ ] [source]: https://example.org",
])("round35 quote reference definitions retain lazy paragraph continuation after %s", (definition) => {
  const result = importMarkdown(
    `${definition
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\nQuoted [source]`,
    "quote.md",
  );
  expect(result.json.content?.map((node) => node.type)).toEqual(["blockquote"]);
  expect(schema.nodeFromJSON(result.json).textContent).toBe("Quoted source");
  expect(generateHTML(result.json, extensions)).toContain('href="https://example.org"');
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it.each([
  "  \n",
  "\\\n",
  "<br>",
  "<br />",
])("round35 image descriptions retain hard-break separation for %s", (separator) => {
  for (const label of [
    `First${separator}second`,
    `First ![inner${separator}description](https://pod.test/inner.png)`,
  ]) {
    const result = importMarkdown(`![${label}](https://pod.test/chart.png)`, "chart.md");
    expect(result.json.content?.[0]?.attrs?.alt).toBe(
      label.startsWith("First !") ? "First inner\ndescription" : "First\nsecond",
    );
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
  }
});

it("round35 lifting later image paragraphs preserves a list's existing leading paragraph", () => {
  const result = importHtml(
    '<ol><li><p>Open settings</p><p><img src="https://pod.test/chart.png"></p><p>Save changes</p></li></ol>',
  );
  expect(result.json.content?.[0]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
  roundTrip(result.json);
});

it.each([
  "",
  ">",
  "> # Heading",
  "> ---",
])("round35 closed reference-definition paragraphs still end lazy quotation before %s", (boundary) => {
  const result = importMarkdown(
    `> [source]: https://example.org\n${boundary}\nOutside [source]`,
    "quote.md",
  );
  expect(result.json.content?.at(-1)?.type).toBe("paragraph");
  expect(schema.nodeFromJSON(result.json.content?.at(-1)).textContent).toBe("Outside source");
  roundTrip(result.json);
});
