// @vitest-environment jsdom
// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { Document, Packer, Paragraph } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { readNumbering } from "../src/apps/docs/lib/convert/docx-numbering";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
const text = (json: JSONContent) => schema.nodeFromJSON(json).textContent;
function roundTrip(json: JSONContent) {
  const dom = new DOMParser().parseFromString(generateHTML(json, extensions), "text/html");
  expect(
    SchemaDOMParser.fromSchema(schema).parse(dom.body, { preserveWhitespace: "full" }).toJSON(),
  ).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}
const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

it("round36 DOCX direct numbering remains available without a styles part", async () => {
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph("Seed")] }] })),
  );
  zip.write(
    "word/document.xml",
    `<w:document ${ns}><w:body><w:p><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>Step</w:t></w:r></w:p></w:body></w:document>`,
  );
  zip.write(
    "word/numbering.xml",
    `<w:numbering ${ns}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="7"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  );
  const zipLibrary = createRequire(import.meta.resolve("mammoth"))("jszip") as {
    loadAsync: (data: ArrayBuffer) => Promise<{
      remove: (name: string) => void;
      generateAsync: (options: { type: "arraybuffer" }) => Promise<ArrayBuffer>;
    }>;
  };
  const withoutStyles = await zipLibrary.loadAsync(await zip.toArrayBuffer());
  withoutStyles.remove("word/styles.xml");
  const result = importHtml(
    (
      await importDocx(await withoutStyles.generateAsync({ type: "arraybuffer" }), {
        uploadImage: vi.fn(),
        progress: vi.fn(),
      })
    ).html,
  );
  expect(result.json.content?.[0]).toMatchObject({ type: "orderedList", attrs: { start: 7 } });
  expect(text(result.json)).toBe("Step");
  roundTrip(result.json);
});

it.each([
  "level style",
  "style properties",
  "based on",
])("round36 style-based Word numbering retains start and continuation through %s", async (kind) => {
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph("Seed")] }] })),
  );
  const numPr = '<w:numPr><w:numId w:val="5"/></w:numPr>';
  zip.write(
    "word/styles.xml",
    `<w:styles ${ns}>
      <w:style w:type="paragraph" w:styleId="Step"><w:name w:val="Step"/>${kind === "level style" ? "" : `<w:pPr>${numPr}</w:pPr>`}</w:style>
      <w:style w:type="paragraph" w:styleId="Derived"><w:name w:val="Derived"/><w:basedOn w:val="Step"/></w:style>
    </w:styles>`,
  );
  const style = kind === "based on" ? "Derived" : "Step";
  const p = (value: string, numbered: boolean) =>
    `<w:p>${numbered ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${value}</w:t></w:r></w:p>`;
  zip.write(
    "word/document.xml",
    `<w:document ${ns}><w:body>${p("Open settings", true)}${p("Note", false)}${p("Save changes", true)}</w:body></w:document>`,
  );
  zip.write(
    "word/numbering.xml",
    `<w:numbering ${ns}>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>${kind === "level style" ? '<w:pStyle w:val="Step"/>' : ""}</w:lvl></w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
    </w:numbering>`,
  );
  const imported = await importDocx(await zip.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  const result = importHtml(imported.html);
  expect(result.json.content?.map((node) => [node.type, node.attrs?.start])).toEqual([
    ["orderedList", 7],
    ["paragraph", undefined],
    ["orderedList", 8],
  ]);
  expect(text(result.json)).toBe("Open settingsNoteSave changes");
  roundTrip(result.json);
});

it.each([
  "ol",
  "ul",
  "task",
])("round36 HTML %s items retain leading blocks at every depth", (kind) => {
  const opening =
    kind === "ol" ? 'ol start="4"' : kind === "task" ? 'ul data-type="taskList"' : "ul";
  const closing = kind === "ol" ? "ol" : "ul";
  const item = kind === "task" ? 'li data-type="taskItem" data-checked="true"' : "li";
  const html = `<${opening}><${item}><h3>Open settings</h3><p>Details</p><${opening}><${item}><blockquote><p>Nested</p></blockquote></li></${closing}></li><${item}><p>Save changes</p></li></${closing}>`;
  for (const result of [importMarkdown(html, "steps.md"), importHtml(html)]) {
    const type = kind === "ol" ? "orderedList" : kind === "task" ? "taskList" : "bulletList";
    expect(result.json.content?.map((node) => node.type)).toEqual([type]);
    const list = result.json.content?.[0];
    if (kind === "ol") expect(list?.attrs?.start).toBe(4);
    expect(list?.content).toHaveLength(2);
    const content = list?.content?.[0]?.content;
    expect(content?.map((node) => node.type)).toEqual(["paragraph", "heading", "paragraph", type]);
    expect(content?.[3]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "blockquote",
    ]);
    expect(text(result.json)).toBe("Open settingsDetailsNestedSave changes");
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
  }
});

it.each([
  "- Report\n===",
  "4. Report\n===",
  "- [ ] Report\n===",
  "1234. Report\n\t===",
  "- Report\n===\t",
  "> Report\n===",
  "> Report\n===\t",
  "> - Report\n> ===",
  "- Parent\n  - Report\n  ===",
])("round36 lazy list continuation cannot become a setext heading: %s", (source) => {
  const result = importMarkdown(source, "report.md");
  expect(text(result.json)).toContain("Report\n===");
  const headings: string[] = [];
  schema.nodeFromJSON(result.json).descendants((node) => {
    if (node.type.name === "heading") headings.push(node.textContent);
  });
  expect(headings).toEqual([]);
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it("round36 effective Word numbering merges direct properties, default styles and style chains", () => {
  const numbering = `<w:numbering ${ns}>
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="7"/><w:pStyle w:val="Step"/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="11"/><w:numFmt w:val="bullet"/><w:pStyle w:val="Sub"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`;
  const styles = `<w:styles ${ns}>
    <w:style w:type="paragraph" w:default="1" w:styleId="Default"><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Derived"><w:basedOn w:val="Default"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Sub"><w:pPr><w:numPr><w:numId w:val="6"/><w:ilvl w:val="0"/></w:numPr></w:pPr></w:style>
    <w:style w:styleId="Cycle"><w:basedOn w:val="Cycle"/></w:style>
  </w:styles>`;
  const paragraph = (properties: string) => `<w:p><w:pPr>${properties}</w:pPr></w:p>`;
  const result = readNumbering(
    `<w:document ${ns}><w:body>
    <w:p/>
    ${paragraph('<w:pStyle w:val="Derived"/>')}
    ${paragraph('<w:pStyle w:val="Derived"/><w:numPr><w:ilvl w:val="0"/></w:numPr>')}
    ${paragraph('<w:pStyle w:val="Sub"/>')}
    ${paragraph('<w:pStyle w:val="Step"/><w:numPr><w:numId w:val="6"/></w:numPr>')}
    ${paragraph('<w:numPr><w:numId w:val="0"/></w:numPr>')}
    <w:p/>
    ${paragraph('<w:pStyle w:val="Unknown"/>')}
    ${paragraph('<w:pStyle w:val="Cycle"/>')}
  </w:body></w:document>`,
    numbering,
    styles,
  );
  expect(
    result.map(({ id, start, numbering }) => [id, start, numbering?.level, numbering?.isOrdered]),
  ).toEqual([
    ["5", 7, "0", true],
    ["5", 11, "1", false],
    ["5", 8, "0", true],
    ["6", 11, "1", false],
    ["6", 7, "0", true],
    ["0", 1, undefined, undefined],
    ["5", 9, "0", true],
    [undefined, 1, undefined, undefined],
    [undefined, 1, undefined, undefined],
  ]);
});

it("round36 Word list mapping shares default, bullet and removed numbering with its counters", async () => {
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph("Seed")] }] })),
  );
  zip.write(
    "word/styles.xml",
    `<w:styles ${ns}>
    <w:style w:type="paragraph" w:default="true" w:styleId="Step"><w:name w:val="Step"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Sub"/><w:basedOn w:val="Step"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
  </w:styles>`,
  );
  zip.write(
    "word/numbering.xml",
    `<w:numbering ${ns}>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="7"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
    <w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`,
  );
  const p = (value: string, properties = "") =>
    `<w:p><w:pPr>${properties}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
  zip.write(
    "word/document.xml",
    `<w:document ${ns}><w:body>
    ${p("First")}${p("Note", '<w:numPr><w:numId w:val="0"/></w:numPr>')}
    ${p("Bullet", '<w:pStyle w:val="Sub"/>')}${p("Second", '<w:pStyle w:val="Sub"/><w:numPr><w:ilvl w:val="0"/></w:numPr>')}
  </w:body></w:document>`,
  );
  const imported = await importDocx(await zip.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  const result = importHtml(imported.html);
  expect(result.json.content?.map((node) => [node.type, node.attrs?.start])).toEqual([
    ["orderedList", 7],
    ["paragraph", undefined],
    ["bulletList", undefined],
    ["orderedList", 8],
  ]);
  expect(text(result.json)).toBe("FirstNoteBulletSecond");
  roundTrip(result.json);
});

it("round36 numbering style links retain target overrides and tolerate broken and cyclic links", () => {
  const numbering = `<w:numbering ${ns}>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="3"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="2"><w:numStyleLink w:val="NumberStyle"/></w:abstractNum>
    <w:abstractNum w:abstractNumId="3"><w:numStyleLink w:val="Cycle"/></w:abstractNum>
    <w:abstractNum w:abstractNumId="4"><w:numStyleLink w:val="Missing"/></w:abstractNum>
    <w:num w:numId="5"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
    <w:num w:numId="6"><w:abstractNumId w:val="2"/></w:num>
    <w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num>
    <w:num w:numId="8"><w:abstractNumId w:val="4"/></w:num>
    <w:num w:numId="9"><w:lvlOverride><w:startOverride w:val="13"/></w:lvlOverride><w:lvlOverride w:ilvl="2"/></w:num>
    <w:abstractNum w:abstractNumId="5"><w:numStyleLink w:val="MissingTarget"/></w:abstractNum>
    <w:num w:numId="10"><w:abstractNumId w:val="5"/></w:num>
  </w:numbering>`;
  const styles = `<w:styles ${ns}>
    <w:style w:styleId="NumberStyle"><w:basedOn w:val="NumberBase"/></w:style>
    <w:style w:styleId="NumberBase"><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
    <w:style w:styleId="Cycle"><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
    <w:style w:styleId="MissingTarget"><w:pPr><w:numPr><w:numId w:val="404"/></w:numPr></w:pPr></w:style>
  </w:styles>`;
  const body = `<w:document ${ns}>${["6", "6", "7", "8", "9", "10"].map((id) => `<w:p><w:pPr><w:numPr><w:numId w:val="${id}"/></w:numPr></w:pPr></w:p>`).join("")}</w:document>`;
  expect(readNumbering(body, numbering, styles).map((item) => item.start)).toEqual([
    7, 8, 1, 1, 13, 1,
  ]);
});

it.each([
  "- Report\n  ===",
  "4. Report\n   ===",
  "- Report\n  --",
])("round36 explicitly indented list underlines still form headings: %s", (source) => {
  const result = importMarkdown(source, "heading.md");
  expect(result.json.content?.[0]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "heading",
  ]);
  expect(text(result.json)).toBe("Report");
  roundTrip(result.json);
});

it("round36 HTML list normalization leaves empty and inline-led items intact", () => {
  const source =
    "<ul><li></li><li>Inline <strong>text</strong></li><li><!-- comment --><p>Paragraph</p></li><li> \n <pre>Code</pre></li></ul>";
  for (const result of [importHtml(source), importMarkdown(source, "lists.md")]) {
    const items = result.json.content?.[0]?.content;
    expect(items).toHaveLength(4);
    expect(items?.map((item) => item.content?.map((node) => node.type))).toEqual([
      ["paragraph"],
      ["paragraph"],
      ["paragraph"],
      ["paragraph", "codeBlock"],
    ]);
    expect(text(result.json)).toBe("Inline textParagraphCode");
    roundTrip(result.json);
  }
});

it.each([
  ["<pre>Code</pre>", "codeBlock"],
  ["<hr>", "horizontalRule"],
  ['<img src="https://pod.test/image.png">', "image"],
  ['<p><a href="https://example.org"><img src="https://pod.test/image.png"></a></p>', "image"],
  ["<table><tr><td><p>Cell</p></td></tr></table>", "table"],
  ["<ul><li><p>Nested</p></li></ul>", "bulletList"],
  ["<ol><li><p>Nested</p></li></ol>", "orderedList"],
  ['<!-- comment --><a href="https://example.org"><h3>Heading</h3></a>', "heading"],
])("round36 all leading HTML blocks retain their list ancestry: %s", (block, type) => {
  const source = `<ol start="4"><li>${block}<p>Details</p></li><li><p>Save changes</p></li></ol>`;
  for (const result of [importHtml(source), importMarkdown(source, "steps.md")]) {
    expect(result.json.content?.map((node) => node.type)).toEqual(["orderedList"]);
    expect(result.json.content?.[0]?.attrs?.start).toBe(4);
    expect(result.json.content?.[0]?.content).toHaveLength(2);
    expect(result.json.content?.[0]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
      "paragraph",
      type,
      "paragraph",
    ]);
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
  }
});
