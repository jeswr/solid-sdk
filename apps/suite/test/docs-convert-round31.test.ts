// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { getSchema, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { readNumbering } from "../src/apps/docs/lib/convert/docx-numbering";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { normaliseImport } from "../src/apps/docs/lib/convert/schema";
import type { PodSession } from "../src/lib/session/pod-session";

const schema = getSchema(baseExtensions(vi.fn()));
const text = (json: JSONContent) => schema.nodeFromJSON(json).textContent;

it("round31 nested equal Markdown marks preserve every word through export", () => {
  const result = importMarkdown("**Safety **critical** warning**", "safety.md");
  expect(text(result.json)).toBe("Safety critical warning");
  expect(result.skipped).toEqual([]);
  expect(text(importMarkdown(exportMarkdown(result.json), "again.md").json)).toBe(
    "Safety critical warning",
  );
});

it.each([
  "bold",
  "italic",
  "strike",
  "underline",
  "highlight",
  "code",
  "subscript",
  "superscript",
  "link",
])("round31 normalizes duplicate %s marks at the common import boundary without dropping text", (type) => {
  const mark = { type, ...(type === "link" ? { attrs: { href: "https://example.org/" } } : {}) };
  const result = normaliseImport({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Keep every word", marks: [mark, mark] }],
      },
    ],
  });
  expect(text(result.json)).toBe("Keep every word");
  expect(result.json.content?.[0]?.content?.[0]?.marks).toHaveLength(1);
  expect(result.skipped).toEqual([]);
});

it("round31 canonicalizes unsorted and mutually exclusive marks without dropping text", () => {
  const result = normaliseImport({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Retain",
            marks: [{ type: "superscript" }, { type: "bold" }, { type: "subscript" }],
          },
        ],
      },
    ],
  });
  expect(text(result.json)).toBe("Retain");
  expect(result.skipped).toEqual([]);
  schema.nodeFromJSON(result.json).check();
});

it("round31 inline HTML images survive between prose and round-trip as blocks", () => {
  const result = importMarkdown(
    'See <img src="https://pod.test/chart.png" alt="Chart"> below',
    "chart.md",
  );
  expect(result.json.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
  expect(result.json.content?.[1]?.attrs).toMatchObject({
    src: "https://pod.test/chart.png",
    alt: "Chart",
  });
  expect(text(result.json)).toBe("See  below");
  expect(result.skipped).toEqual([]);
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it("round31 inline HTML wrappers keep CommonMark links active", () => {
  const result = importMarkdown("<span>[report](https://example.org/report)</span>", "report.md");
  expect(result.json.content?.[0]?.content?.[0]).toMatchObject({
    text: "report",
    marks: [{ type: "link", attrs: { href: "https://example.org/report" } }],
  });
  expect(result.skipped).toEqual([]);
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it("round31 decorated neutral HTML wrappers preserve Markdown links and unmarked prose", () => {
  const result = importMarkdown(
    '<span class="report">[report](https://example.org/report) and plain</span>',
    "report.md",
  );
  expect(result.json.content?.[0]?.content).toMatchObject([
    { text: "report", marks: [{ type: "link", attrs: { href: "https://example.org/report" } }] },
    { text: " and plain" },
  ]);
  expect(result.skipped).toEqual([]);
});

it.each([
  "<strong>**Safety** <span>[report](https://example.org/report)</span></strong>",
  "<span><strong>**Safety**</strong> [report](https://example.org/report)</span>",
])("round31 nested HTML wrappers share Markdown parsing and mark normalization: %s", (source) => {
  const result = importMarkdown(source, "nested.md");
  expect(text(result.json)).toBe("Safety report");
  expect(result.skipped).toEqual([]);
  expect(result.json.content?.[0]?.content?.at(-1)?.marks).toContainEqual(
    expect.objectContaining({ type: "link" }),
  );
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  'See <img src="https://pod.test/chart.png" alt="Chart"/> below',
  'See <span><img src="https://pod.test/chart.png" alt="Chart"></span> below',
  '# See <img src="https://pod.test/chart.png" alt="Chart"> below',
  '- See <img src="https://pod.test/chart.png" alt="Chart"> below',
])("round31 recognizes inline HTML images in every prose container: %s", (source) => {
  const result = importMarkdown(source, "chart.md");
  expect(JSON.stringify(result.json)).toContain('"type":"image"');
  expect(JSON.stringify(result.json)).toContain('"alt":"Chart"');
  expect(result.skipped).toEqual([]);
});

it("round31 inline HTML breaks use the same void-element parser", () => {
  const result = importMarkdown("See<br>below", "break.md");
  expect(result.json.content?.[0]?.content?.map((node) => node.type)).toEqual([
    "text",
    "hardBreak",
    "text",
  ]);
});

it.each([
  "See <hr>below",
  "# See <hr>below",
  "- See <hr>below",
])("round31 all supported inline HTML void elements retain block boundaries: %s", (source) => {
  const result = importMarkdown(source, "rule.md");
  expect(JSON.stringify(result.json)).toContain('"type":"horizontalRule"');
  expect(text(result.json)).toBe("See below");
  expect(result.skipped).toEqual([]);
});

it.each([
  "javascript:alert(1)",
  "mailto:chart@example.org",
  "/relative.png",
  "",
])("round31 discarded inline HTML images report unsafe destinations: %s", (src) => {
  const result = importMarkdown(`See <img src="${src}" alt="Chart"> below`, "unsafe.md");
  expect(text(result.json)).toBe("See  below");
  expect(JSON.stringify(result.json)).not.toContain('"type":"image"');
  expect(result.skipped).toEqual([{ label: "Unsafe images", count: 1 }]);
});

it("round31 a lifted HTML rule at the start of a list item keeps its required paragraph", () => {
  const result = importMarkdown("- <span><hr></span>below", "rule.md");
  expect(result.json.content?.[0]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "horizontalRule",
    "paragraph",
  ]);
  expect(text(result.json)).toBe("below");
  expect(result.skipped).toEqual([]);
});

it("round31 an HTML image without a source stays visible as inert markup with a warning", () => {
  const result = importMarkdown('See <img alt="Chart"> below', "missing-src.md");
  expect(text(result.json)).toBe('See <img alt="Chart"> below');
  expect(result.skipped).toEqual([{ label: "Unsafe images", count: 1 }]);
});

it.each([
  ["<span>www.example.org</span>", "www.example.org", "http://www.example.org"],
  [
    "<span><https://example.org/report></span>",
    "https://example.org/report",
    "https://example.org/report",
  ],
])("round31 inline HTML wrappers also retain GFM and CommonMark autolinks: %s", (source, label, href) => {
  const result = importMarkdown(source, "autolink.md");
  expect(result.json.content?.[0]?.content?.[0]).toMatchObject({
    text: label,
    marks: [{ type: "link", attrs: { href } }],
  });
  expect(result.skipped).toEqual([]);
});

it("round31 normalizes valid HTML image destinations before the DOM schema can discard them", () => {
  const result = importMarkdown(
    'See <img src="HTTPS://pod.test/chart.png" alt="Chart"> below',
    "chart.md",
  );
  expect(result.json.content?.[1]?.attrs?.src).toBe("https://pod.test/chart.png");
  expect(result.skipped).toEqual([]);
});

it("round31 inline code keeps Markdown punctuation literal while other HTML parses it", () => {
  const result = importMarkdown(
    "<span><code>[literal](url) **code**</code> &amp;copy;</span>",
    "code.md",
  );
  expect(text(result.json)).toBe("[literal](url) **code** &copy;");
  expect(result.skipped).toEqual([]);
});

it("round31 a Word numbering instance continues across ordinary paragraphs", async () => {
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(await toDocx(importMarkdown("Start", "steps.md").json, vi.fn())),
  );
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (value: string, numbered: boolean) =>
    `<w:p>${numbered ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>' : ""}<w:r><w:t>${value}</w:t></w:r></w:p>`;
  zip.write(
    "word/document.xml",
    `<w:document ${ns}><w:body>${p("First", true)}${p("Explanation", false)}${p("Second", true)}${p("Third", true)}</w:body></w:document>`,
  );
  zip.write(
    "word/numbering.xml",
    `<w:numbering ${ns}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  );
  const result = await convertImport(
    new NodeFile([await zip.toArrayBuffer()], "steps.docx") as unknown as File,
    { fetch: vi.fn() } as unknown as PodSession,
    vi.fn(),
    vi.fn(),
  );
  expect(result.json.content?.map((node) => [node.type, node.attrs?.start])).toEqual([
    ["orderedList", 1],
    ["paragraph", undefined],
    ["orderedList", 2],
  ]);
  expect(result.json.content?.[2]?.content).toHaveLength(2);
  expect(exportMarkdown(result.json)).toContain("2. Second\n3. Third");
});

it("round31 Word counters are per instance and level, honoring default and disabled restarts", () => {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const numbering = `<w:numbering ${ns}>
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="3"/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="5"/></w:lvl>
      <w:lvl w:ilvl="2"><w:start w:val="8"/><w:lvlRestart w:val="0"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="9"/></w:lvlOverride></w:num>
    <w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="1"><w:lvl><w:start w:val="11"/><w:lvlRestart w:val="1"/></w:lvl></w:lvlOverride></w:num>
  </w:numbering>`;
  const p = (id: string, level: string) =>
    `<w:p><w:pPr><w:numPr><w:numId w:val="${id}"/><w:ilvl w:val="${level}"/></w:numPr></w:pPr></w:p>`;
  const sequence = [
    ["1", "0"],
    ["1", "1"],
    ["1", "1"],
    ["2", "0"],
    ["1", "0"],
    ["1", "1"],
    ["1", "2"],
    ["1", "0"],
    ["1", "2"],
    ["missing", "3"],
    ["3", "1"],
    ["3", "0"],
    ["3", "1"],
    ["missing", "0"],
    ["missing", "3"],
  ];
  expect(
    readNumbering(
      `<w:document ${ns}><w:body>${sequence.map(([id, level]) => p(id as string, level as string)).join("<w:p/>")}</w:body></w:document>`,
      numbering,
    )
      .filter((item) => item.id !== undefined)
      .map((item) => item.start),
  ).toEqual([3, 5, 6, 9, 4, 5, 8, 5, 9, 1, 11, 3, 11, 1, 1]);
});
