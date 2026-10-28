// @vitest-environment jsdom
// AUTHORED-BY Codex
import { readFile } from "node:fs/promises";
import type { JSONContent } from "@tiptap/react";
import { Document, ImageRun, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { describe, expect, it, vi } from "vitest";
import { PAGE_WIDTH, toDocx } from "../src/apps/docs/lib/convert/docx-export";
import {
  DOCX_STYLE_MAP,
  importDocx,
  MAX_IMPORT_BYTES,
  stripUnsupported,
} from "../src/apps/docs/lib/convert/docx-import";
import {
  exportMarkdown,
  importMarkdown,
  MARKDOWN_NOTES,
} from "../src/apps/docs/lib/convert/markdown";
import { sanitiseImport } from "../src/apps/docs/lib/convert/sanitise";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const p = (value: string): JSONContent => ({ type: "paragraph", content: [text(value)] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const noImage = vi.fn(async () => {
  throw new Error("offline");
});
async function xml(json: JSONContent, image = noImage) {
  const file = await toDocx(json, image);
  const zip = await openArrayBuffer(await Packer.toArrayBuffer(file));
  return {
    body: await zip.read("word/document.xml", "utf-8"),
    styles: await zip.read("word/styles.xml", "utf-8"),
    numbering: await zip.read("word/numbering.xml", "utf-8"),
    zip,
  };
}
describe("DOCX mapping rows", () => {
  it("emits one A4 section, 1in margins, serif defaults and three heading styles", async () => {
    const { body, styles, zip } = await xml(
      doc(
        ...[1, 2, 3, 6].map((level) => ({
          type: "heading",
          attrs: { level },
          content: [text(`H${level}`)],
        })),
      ),
    );
    expect(body.match(/<w:sectPr>/g)).toHaveLength(1);
    expect(body).toContain('w:w="11906" w:h="16838"');
    expect(body).toContain('w:top="1440"');
    for (const n of [1, 2, 3]) expect(body).toContain(`w:val="Heading${n}"`);
    for (const value of [
      "Source Serif 4",
      "Onest",
      'w:val="22"',
      'w:val="48"',
      'w:val="36"',
      'w:val="28"',
    ])
      expect(styles).toContain(value);
    const fonts = await zip.read("word/fontTable.xml", "utf-8");
    for (const fallback of ["Georgia", "Arial", "Courier New"])
      expect(fonts).toContain(`w:val="${fallback}"`);
  });
  it("preserves ordered list starts independently at each nesting level", async () => {
    const list = (start: number | undefined, ...content: JSONContent[]): JSONContent => ({
      type: "orderedList",
      ...(start === undefined ? {} : { attrs: { start } }),
      content: content.map((node) => ({ type: "listItem", content: [node] })),
    });
    const { numbering } = await xml(
      doc(list(7, p("Seven"), list(3, p("Nested three"))), list(undefined, p("One"))),
    );
    expect(numbering).toContain('<w:start w:val="7"/>');
    expect(numbering).toContain('<w:start w:val="3"/>');
    expect(numbering).toContain('<w:start w:val="1"/>');
  });
  it("maps alignment, each inline mark, hyperlinks, hard breaks and ignored comments", async () => {
    const marks = [
      "bold",
      "italic",
      "underline",
      "strike",
      "subscript",
      "superscript",
      "highlight",
      "code",
      "comment",
    ];
    const { body, zip } = await xml(
      doc(
        ...["left", "center", "right", "justify", "unknown"].map((textAlign) => ({
          ...p("align"),
          attrs: { textAlign },
        })),
        {
          type: "paragraph",
          content: [
            ...marks.map((type) => ({ ...text(type), marks: [{ type }] })),
            { ...text("link"), marks: [{ type: "link", attrs: { href: "https://example.org/" } }] },
            {
              ...text("unsafe"),
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
            { type: "hardBreak" },
            { type: "unknownInline", content: [text("child")] },
            { type: "text" },
          ],
        },
      ),
    );
    for (const value of [
      'w:val="left"',
      'w:val="center"',
      'w:val="right"',
      'w:val="both"',
      "<w:b/>",
      "<w:i/>",
      "<w:u",
      "<w:strike/>",
      'w:val="subscript"',
      'w:val="superscript"',
      'w:val="yellow"',
      "Source Code Pro",
      "F2F2F2",
      "Hyperlink",
      "<w:br/>",
    ])
      expect(body).toContain(value);
    expect(body).not.toContain("commentRange");
    const rels = await zip.read("word/_rels/document.xml.rels", "utf-8");
    expect(rels).toContain("https://example.org/");
    expect(rels).not.toContain("javascript:");
  });
  it("uses numbering definitions through level 8, with separate lists and task glyphs", async () => {
    const nested = (type: string, depth: number): JSONContent => ({
      type,
      content: [
        {
          type: type === "taskList" ? "taskItem" : "listItem",
          attrs: { checked: depth % 2 === 0 },
          content: [
            p(`level ${depth}`),
            p("continuation"),
            ...(depth ? [nested(type, depth - 1)] : []),
          ],
        },
      ],
    });
    const { body, numbering } = await xml(
      doc(nested("bulletList", 10), nested("orderedList", 2), nested("taskList", 2)),
    );
    for (const n of [0, 1, 2, 8]) expect(body).toContain(`<w:ilvl w:val="${n}"`);
    expect(body).not.toContain('<w:ilvl w:val="9"');
    expect(body).toContain("☑ ");
    expect(body).toContain("☐ ");
    expect(numbering).toContain('w:val="bullet"');
    expect(numbering).toContain('w:val="decimal"');
    expect(numbering).toContain('w:val="%9."');
  });
  it("maps quotes, multiline/empty code and a horizontal rule", async () => {
    const { body } = await xml(
      doc(
        { type: "blockquote", content: [p("quote")] },
        { type: "codeBlock", content: [text("a\nb"), { type: "text" }] },
        { type: "codeBlock" },
        { type: "horizontalRule" },
        { type: "unknownBlock", content: [p("kept")] },
      ),
    );
    for (const value of [
      'w:left="720"',
      'w:sz="24"',
      'w:val="Quote"',
      'w:fill="F2F2F2"',
      'w:val="20"',
      "<w:keepLines/>",
      'w:sz="48"',
      ">kept<",
    ])
      expect(body).toContain(value);
    expect((await xml({ type: "doc" })).body).toContain("w:sectPr");
  });
  it("embeds images with aspect ratio/alt text and emits an unavailable fallback", async () => {
    const fixture = await readFile("e2e/fixtures/docs-import.docx");
    const zip = await openArrayBuffer(Uint8Array.from(fixture).buffer);
    expect(zip.exists("word/document.xml")).toBe(true);
    const image = vi.fn(async () => ({
      data: new Uint8Array([1, 2]),
      width: 200,
      height: 100,
      type: "png" as const,
    }));
    const file = await toDocx(
      doc(
        ...["50%", 120, undefined].map((width) => ({
          type: "image",
          attrs: {
            src: "https://pod.test/image.png",
            alt: "Chart",
            ...(width === undefined ? {} : { width }),
          },
        })),
      ),
      image,
    );
    const archive = await openArrayBuffer(await Packer.toArrayBuffer(file));
    const body = await archive.read("word/document.xml", "utf-8");
    expect(body).toContain(`cx="${Math.round(PAGE_WIDTH * 0.5 * 9525)}"`);
    expect(body).toContain('cy="1432878"');
    expect(body).toContain('descr="Chart"');
    expect(body).toContain("r:embed=");
    expect(
      (await xml(doc({ type: "image", attrs: { alt: "offline" } }, { type: "image" }))).body,
    ).toContain("[Image unavailable: offline]");
  });
  it("maps table width, header rows, cell borders, column and row spans", async () => {
    const { body } = await xml(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 2, rowspan: 2 }, content: [p("header")] },
            ],
          },
          { type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] },
        ],
      }),
    );
    for (const value of [
      "<w:tbl>",
      'w:type="pct"',
      "<w:tblHeader/>",
      '<w:gridSpan w:val="2"',
      'w:val="restart"',
      'w:sz="32"',
    ])
      expect(body).toContain(value);
  });
});

describe("imports and Markdown", () => {
  it("maps task numbering levels before indentation and handles missing indentation and orphan levels", async () => {
    const source = new Document({
      styles: {
        paragraphStyles: [
          { id: "TaskChecked", name: "task CHECKED" },
          { id: "TaskUnchecked", name: "Task Unchecked" },
        ],
      },
      numbering: {
        config: [
          {
            reference: "tasks",
            levels: [0, 1].map((level) => ({ level, format: LevelFormat.BULLET, text: "•" })),
          },
        ],
      },
      sections: [
        {
          children: [
            new Paragraph({ text: "Parent", style: "TaskUnchecked" }),
            new Paragraph({
              text: "Child",
              style: "TaskChecked",
              numbering: { reference: "tasks", level: 1 },
              indent: { left: 7200 },
            }),
            new Paragraph({
              text: "Sibling",
              style: "TaskUnchecked",
              numbering: { reference: "tasks", level: 0 },
              indent: { left: 2160 },
            }),
            new Paragraph("Gap"),
            new Paragraph({ text: "Orphan", style: "TaskChecked", indent: { left: 2160 } }),
          ],
        },
      ],
    });
    const result = await importDocx(await Packer.toArrayBuffer(source), {
      progress: vi.fn(),
      uploadImage: noImage,
    });
    const item = (value: string, checked: boolean, nested?: JSONContent): JSONContent => ({
      type: "taskItem",
      attrs: { checked },
      content: [p(value), ...(nested ? [nested] : [])],
    });
    expect(importHtml(result.html).json).toEqual(
      normaliseImport(
        doc(
          {
            type: "taskList",
            content: [
              item("Parent", false, { type: "taskList", content: [item("Child", true)] }),
              item("Sibling", false),
            ],
          },
          p("Gap"),
          { type: "taskList", content: [item("Orphan", true)] },
        ),
      ).json,
    );
    expect(result.skipped).toEqual([]);
  });

  it("preserves an explicitly empty paragraph with HTML", () => {
    expect(exportMarkdown(doc({ type: "paragraph", content: [] }))).toBe("<p></p>");
  });
  it("applies every style map and uploads multiple extracted images strictly in sequence", async () => {
    const names = [
      "Title",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Quote",
      "Intense Quote",
      "Code",
    ];
    const source = new Document({
      styles: { paragraphStyles: names.map((name, index) => ({ id: `Test${index}`, name })) },
      sections: [
        {
          children: [
            ...names.map(
              (name, index) =>
                new Paragraph({ style: `Test${index}`, children: [new TextRun(name)] }),
            ),
            ...[1, 2, 3].map(
              (id) =>
                new Paragraph({
                  children: [
                    new ImageRun({
                      type: "png",
                      data: new Uint8Array([id]),
                      transformation: { width: 1, height: 1 },
                    }),
                  ],
                }),
            ),
          ],
        },
      ],
    });
    let running = false;
    let completed = 0;
    const progress = vi.fn();
    const result = await importDocx(await Packer.toArrayBuffer(source), {
      progress,
      uploadImage: async () => {
        expect(running).toBe(false);
        running = true;
        await Promise.resolve();
        running = false;
        return `https://pod.test/assets/${++completed}.png`;
      },
    });
    for (const value of [
      "<h1>Title</h1>",
      "<h1>Heading 1</h1>",
      "<h2>Heading 2</h2>",
      ...[3, 4, 5, 6].map((level) => `<h3>Heading ${level}</h3>`),
      "<blockquote><p>Quote</p></blockquote>",
      "<blockquote><p>Intense Quote</p></blockquote>",
      "<pre>Code</pre>",
    ])
      expect(result.html).toContain(value);
    expect(completed).toBe(3);
    expect(progress.mock.calls.map(([value]) => value)).toEqual(
      [0, 1, 2, 3].map((completed) => ({ completed, total: 3 })),
    );
    expect(result.skipped).toEqual([]);
  });
  it("keeps all eleven DOCX image URLs distinct when placeholder indexes share prefixes", async () => {
    const source = new Document({
      sections: [
        {
          children: Array.from(
            { length: 11 },
            (_, index) =>
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data: new Uint8Array([index]),
                    transformation: { width: 1, height: 1 },
                  }),
                ],
              }),
          ),
        },
      ],
    });
    let uploaded = 0;
    const result = await importDocx(await Packer.toArrayBuffer(source), {
      progress: vi.fn(),
      uploadImage: async () => `https://pod.test/assets/image-${uploaded++}.png`,
    });
    expect([...result.html.matchAll(/src="([^"]+)"/g)].map((match) => match[1])).toEqual(
      Array.from({ length: 11 }, (_, index) => `https://pod.test/assets/image-${index}.png`),
    );
  });
  it("handles an image-free document, rejects unsafe upload URLs and propagates failed uploads", async () => {
    const progress = vi.fn();
    const empty = new Document({ sections: [{ children: [new Paragraph("Text only")] }] });
    const result = await importDocx(await Packer.toArrayBuffer(empty), {
      uploadImage: vi.fn(),
      progress,
    });
    expect(result.html).toBe("<p>Text only</p>");
    expect(progress).toHaveBeenCalledWith({ completed: 0, total: 0 });
    const file = Uint8Array.from(await readFile("e2e/fixtures/docs-import.docx")).buffer;
    await expect(
      importDocx(file, { uploadImage: async () => "javascript:alert(1)", progress }),
    ).rejects.toThrow("Invalid uploaded image URL");
    await expect(
      importDocx(file, {
        uploadImage: async () => {
          throw new Error("upload failed");
        },
        progress,
      }),
    ).rejects.toThrow("upload failed");
  });
  it("imports the real image/footnote fixture with sequential progress", async () => {
    const bytes = await readFile("e2e/fixtures/docs-import.docx");
    const progress = vi.fn();
    const uploadImage = vi.fn(async () => "https://pod.test/docs/plan/assets/image.png");
    const result = await importDocx(Uint8Array.from(bytes).buffer, { uploadImage, progress });
    expect(result.html).toContain("<h1>Plan</h1>");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<table>");
    expect(result.html).toContain('src="https://pod.test/docs/plan/assets/image.png"');
    expect(result.html).not.toContain("This footnote");
    expect(result.html).not.toContain("footnote-ref");
    expect(result.skipped).toEqual([{ label: "Footnotes", count: 1 }]);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { completed: 0, total: 1 },
      { completed: 1, total: 1 },
    ]);
    expect(uploadImage.mock.calls).toHaveLength(1);
    expect(DOCX_STYLE_MAP).toContain("p[style-name='Heading 6'] => h3:fresh");
  });
  it("counts and strips unsupported XML, including alternate namespace prefixes", () => {
    const source = `<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:z="other"><x:body><z:ins/><x:p><x:ins><x:r><x:t>unaccepted</x:t></x:r></x:ins><x:del/><x:moveFrom/><x:moveTo/><x:txbxContent><x:p/></x:txbxContent><x:footnoteReference x:id="1"/><x:footnoteReference x:id="2"/><x:endnoteReference/><x:commentReference/><x:commentRangeStart/><x:commentRangeEnd/><x:r><x:t>kept</x:t></x:r></x:p></x:body></x:document>`;
    const result = stripUnsupported(source);
    expect(result.skipped).toEqual([
      { label: "Tracked changes", count: 4 },
      { label: "Text boxes", count: 1 },
      { label: "Footnotes", count: 2 },
      { label: "Endnotes", count: 1 },
      { label: "Comments", count: 1 },
    ]);
    expect(result.xml).not.toContain("unaccepted");
    expect(result.xml).toContain("<z:ins/>");
    expect(result.xml).toContain(">kept<");
    expect(() => stripUnsupported("not XML")).toThrow();
  });
  it("sanitizes active content, external payloads and unsupported attributes", () => {
    expect(
      sanitiseImport(
        '<p onclick="evil()">Hi<script>evil()</script><a href="javascript:evil()">x</a><img src="data:image/png;base64,a" onerror="evil()"><iframe src="https://evil.test"></iframe></p>',
      ),
    ).toBe("<p>Hi<a>x</a><img /></p>");
  });
  it("round trips aligned headings, tasks, HTML marks and GFM images", () => {
    const json = doc(
      { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [text("Plan")] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p("Done")] }],
      },
      {
        type: "paragraph",
        content: [
          {
            ...text("marked"),
            marks: [{ type: "underline" }, { type: "highlight" }, { type: "comment" }],
          },
        ],
      },
      { type: "image", attrs: { src: "https://pod.test/photo.png", alt: "Photo" } },
    );
    const md = exportMarkdown(json);
    expect(md).toContain('<h1 style="text-align: center"');
    expect(md).toContain("- [x] Done");
    expect(md).toContain("<mark><u>marked</u></mark>");
    expect(md).toContain("![Photo](https://pod.test/photo.png)");
    expect(exportMarkdown(json, true)).not.toContain("<mark>");
    const parsed = importMarkdown(`---\ntitle: "Imported plan"\n---\n${md}`, "other.md");
    expect(parsed.title).toBe("Imported plan");
    expect(exportMarkdown(parsed.json)).toBe(md);
    expect(importMarkdown("---\r\nother: x\r\n---\r\n# Body", "File.MARKDOWN").title).toBe("File");
    expect(importMarkdown("\uFEFF# Body", "x.md").title).toBe("x");
    expect(MARKDOWN_NOTES).toContain("HTML for richer content");
  });
  it("drops unsafe links/images and preserves nested tables", () => {
    expect(exportMarkdown(doc({ type: "image", attrs: { src: "data:bad" } }))).toBe("<p></p>");
    expect(
      exportMarkdown(
        doc({ type: "image", attrs: { src: "https://user:pass@pod.test/photo.png" } }),
      ),
    ).toBe("<p></p>");
    const table: JSONContent = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                p("a"),
                {
                  type: "table",
                  content: [
                    {
                      type: "tableRow",
                      content: [
                        { type: "tableCell", content: [p("nested"), { type: "paragraph" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(exportMarkdown(doc(table))).toContain("nested");
    expect(
      exportMarkdown(
        doc({
          type: "paragraph",
          content: [
            { ...text("unsafe"), marks: [{ type: "link", attrs: { href: "javascript:bad" } }] },
          ],
        }),
      ),
    ).toBe("unsafe");
  });
  it("preserves literal HTML in fenced and inline code and CommonMark autolinks", () => {
    const source =
      "```html\n<script>example()</script>\n```\n\nUse `<b>` and <https://example.org/>.";
    const result = importMarkdown(source, "code.md");
    expect(result.json.content?.[0]?.content?.[0]?.text).toBe("<script>example()</script>");
    const exported = exportMarkdown(result.json);
    expect(exported).toContain("`<b>`");
    expect(exported).toContain("https://example.org/");
  });
  it("enforces 50 MB before conversion", async () => {
    await expect(
      importDocx(new ArrayBuffer(MAX_IMPORT_BYTES + 1), {
        uploadImage: vi.fn(),
        progress: vi.fn(),
      }),
    ).rejects.toThrow("50 MB");
    expect(() => importMarkdown("x".repeat(MAX_IMPORT_BYTES + 1), "x.md")).toThrow("50 MB");
  });
});
