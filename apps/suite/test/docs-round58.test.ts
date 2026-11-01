// @vitest-environment jsdom
// AUTHORED-BY Codex
import { readFileSync } from "node:fs";
import { Editor, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { identifyDocxBlocks } from "../src/apps/docs/lib/convert/docx-metadata";
import { readNumbering } from "../src/apps/docs/lib/convert/docx-numbering";
import { WORD } from "../src/apps/docs/lib/convert/docx-xml";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";
import { insertionAnchor } from "../src/apps/docs/lib/editor/insertion-anchor";

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

it("round58 merged cells cannot shift subsequent numbering or number plain paragraphs", async () => {
  const original = importHtml(
    '<table><tr><td rowspan="2"><p>Merged</p></td><td><p>Top</p></td></tr><tr><td><p>Bottom</p></td></tr></table><ol type="a" start="3"><li>Prepare</li><li>Review</li></ol><p>Plain</p>',
  ).json;
  const result = await importDocx(await Packer.toArrayBuffer(await toDocx(original, vi.fn())), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(importHtml(result.html).json).toEqual(original);
});

it.each([
  "paste",
  "html",
  "markdown",
])("round58 %s preserves explicit item counters through editing and export", async (path) => {
  const source = '<ol><li value="3">Prepare</li><li>Review</li></ol>';
  const editor = new Editor({ extensions: baseExtensions(vi.fn()), content: "<p></p>" });
  try {
    let json: JSONContent;
    if (path === "paste") {
      editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent);
      json = editor.getJSON();
    } else
      json = path === "html" ? importHtml(source).json : importMarkdown(source, "list.md").json;
    expect(json.content?.slice(0, 1)).toMatchObject([
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ content: [p("Prepare")] }, { content: [p("Review")] }],
      },
    ]);
    expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
    const result = await importDocx(await Packer.toArrayBuffer(await toDocx(json, vi.fn())), {
      uploadImage: vi.fn(),
      progress: vi.fn(),
    });
    expect(importHtml(result.html).json).toEqual(json);
  } finally {
    editor.destroy();
  }
});

it.each([
  [null, "decimal"],
  ["1", "decimal"],
  ["a", "lower-alpha"],
  ["A", "upper-alpha"],
  ["i", "lower-roman"],
  ["I", "upper-roman"],
] as const)("round58 list type %s uses %s markers on screen and in print", (type, style) => {
  const css = document.createElement("style");
  css.textContent = readFileSync("src/apps/docs/components/docs.css", "utf8");
  document.head.append(css);
  const page = document.createElement("article");
  page.className = "docs-page";
  document.body.append(page);
  const editor = new Editor({
    element: page,
    extensions: baseExtensions(vi.fn()),
    content: `<ol${type ? ` type="${type}"` : ""} start="3"><li>Prepare</li><li>Review</li></ol>`,
  });
  try {
    const list = page.querySelector("ol") as HTMLOListElement;
    const computed = getComputedStyle(list);
    expect(computed.listStyleType || computed.listStyle).toBe(style);
    const imported = importHtml(editor.getHTML());
    expect(imported.skipped).toEqual([]);
    expect(imported.json.content?.[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3, type: type === "1" ? null : type },
      content: [{ content: [p("Prepare")] }, { content: [p("Review")] }],
    });
    // Print uses these same rules; no screen-only media query may own them.
    expect(
      Array.from(css.sheet?.cssRules ?? []).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          list.matches(rule.selectorText) &&
          (rule.style.listStyleType === style || rule.style.listStyle === style),
      ),
    ).toBe(true);
  } finally {
    editor.destroy();
    page.remove();
    css.remove();
  }
});

it.each([
  "merged continuation",
  "ignored wrapper",
])("round58 blocks dropped from a %s cannot shift table or paragraph metadata", async (dropped) => {
  const original = importHtml(
    '<table><tr><td rowspan="2"><p>Merged</p></td><td><p>Top</p></td></tr><tr><td><p>Bottom</p></td></tr></table><ol type="I" start="3"><li><p>Prepare</p><table><tr><td><p>Inner table</p></td></tr></table><p>Continue</p></li><li>Review</li></ol><p>Plain</p>',
  ).json;
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(await toDocx(original, vi.fn())),
  );
  const document = new DOMParser().parseFromString(
    await archive.read("word/document.xml", "utf-8"),
    "application/xml",
  );
  const table = document.getElementsByTagNameNS(WORD, "tbl")[1] as Element;
  const hidden = table.cloneNode(true) as Element;
  hidden.getElementsByTagNameNS(WORD, "tblInd")[0]?.setAttributeNS(WORD, "w:w", "0");
  if (dropped === "merged continuation") {
    const continuation = Array.from(document.getElementsByTagNameNS(WORD, "vMerge")).find(
      (merge) => merge.getAttributeNS(WORD, "val") !== "restart",
    ) as Element;
    continuation.parentElement?.parentElement?.append(hidden);
  } else {
    const wrapper = document.createElementNS(WORD, "w:unknown");
    wrapper.append(hidden);
    document.getElementsByTagNameNS(WORD, "body")[0]?.prepend(wrapper);
  }
  archive.write("word/document.xml", new XMLSerializer().serializeToString(document));
  const result = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(importHtml(result.html).json).toEqual(original);
  expect(result.html).not.toContain("SuiteImport");
});

it.each([
  "paste",
  "html",
  "markdown",
])("round58 %s splits counter resets across nested lists and task boundaries", (path) => {
  const source =
    '<ol type="a" start="2"><li>Two</li><li value="7">Seven<ol type="I"><li value="4">Four</li><li>Five</li></ol></li><li value="8">Eight</li><li value="-2"><input type="checkbox" checked>Done</li><li>Minus one</li><li value="0">Zero</li><li value="bad">One</li><li value="">Two again</li><li value="99999999999999999999">Three</li><li value="+6junk">Six</li></ol>';
  const editor = new Editor({ extensions: baseExtensions(vi.fn()), content: "<p></p>" });
  try {
    let json: JSONContent;
    if (path === "paste") {
      editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent);
      json = editor.getJSON();
    } else
      json = path === "html" ? importHtml(source).json : importMarkdown(source, "list.md").json;
    expect(json.content?.slice(0, 5)).toMatchObject([
      { type: "orderedList", attrs: { start: 2, type: "a" }, content: [{ content: [p("Two")] }] },
      {
        type: "orderedList",
        attrs: { start: 7, type: "a" },
        content: [
          {
            content: [
              p("Seven"),
              {
                type: "orderedList",
                attrs: { start: 4, type: "I" },
                content: [{ content: [p("Four")] }, { content: [p("Five")] }],
              },
            ],
          },
          { content: [p("Eight")] },
        ],
      },
      { type: "taskList", content: [{ attrs: { checked: true }, content: [p("Done")] }] },
      {
        type: "orderedList",
        attrs: { start: -1, type: "a" },
        content: ["Minus one", "Zero", "One", "Two again", "Three"].map((text) => ({
          content: [p(text)],
        })),
      },
      { type: "orderedList", attrs: { start: 6, type: "a" }, content: [{ content: [p("Six")] }] },
    ]);
  } finally {
    editor.destroy();
  }
});

it.each([
  "",
  ' start="7"',
])("round58 descending counters%s become preserved list starts", (start) => {
  const { json } = importHtml(
    `<ol reversed${start}><li>First</li><li value="4">Second</li><li>Third</li></ol>`,
  );
  expect(
    json.content?.flatMap((list) => list.content?.map((_, index) => list.attrs?.start + index)),
  ).toEqual([start ? 7 : 3, 4, 3]);
});

it("round58 metadata identities retain original styles with missing properties and foreign XML", () => {
  const body = `<w:document xmlns:w="${WORD}" xmlns:x="urn:other"><w:body><w:p/><w:tbl><w:tblPr><x:ignore/><w:tblStyle/><w:tblInd w:w="720"/></w:tblPr><w:tr><w:tc><w:p><w:pPr><x:ignore/><w:pStyle w:val="Nameless"/></w:pPr></w:p></w:tc></w:tr></w:tbl><w:tbl><w:tblPr><w:tblStyle w:val="Nameless"/></w:tblPr></w:tbl></w:body></w:document>`;
  const definitions = `<w:styles xmlns:w="${WORD}"><w:style w:type="paragraph"><w:name w:val="Heading 1"/></w:style><w:style w:styleId="null" w:type="paragraph"><w:name w:val="Heading 1"/></w:style><w:style w:styleId="Nameless" w:type="character"><w:name w:val="Character"/></w:style><w:style w:styleId="Nameless" w:type="table"/><w:style w:styleId="Nameless" w:type="paragraph"/><w:style w:styleId="Nameless" w:type="paragraph"><w:name w:val="Duplicate"/></w:style></w:styles>`;
  const metadata = identifyDocxBlocks(
    body,
    definitions,
    readNumbering(body, `<w:numbering xmlns:w="${WORD}"/>`),
  );
  expect([...metadata.blocks.values()]).toMatchObject([
    { type: "paragraph", styleId: null },
    { type: "table", styleId: null, indent: 720 },
    { type: "paragraph", styleId: "Nameless" },
    { type: "table", styleId: "Nameless", indent: 0 },
  ]);
  const aliases = Array.from(
    new DOMParser()
      .parseFromString(metadata.styles, "application/xml")
      .getElementsByTagNameNS(WORD, "style"),
  ).filter((style) => metadata.blocks.has(style.getAttributeNS(WORD, "styleId") as string));
  expect(aliases.every((style) => style.getElementsByTagNameNS(WORD, "name").length === 0)).toBe(
    true,
  );
  const empty = identifyDocxBlocks(
    `<w:document xmlns:w="${WORD}"><w:body><w:tbl/><w:tbl><w:tblPr><w:tblInd/></w:tblPr></w:tbl></w:body></w:document>`,
    "",
    [],
  );
  expect([...empty.blocks.values()]).toMatchObject([
    { type: "table", indent: 0 },
    { type: "table", indent: 0 },
  ]);
});

it("round58 reader-synthesized tables retain content without an XML metadata identity", async () => {
  const { default: mammoth } = await import("mammoth/mammoth.browser");
  const convert = mammoth.convertToHtml;
  const spy = vi.spyOn(mammoth, "convertToHtml").mockImplementation((input, options) =>
    convert(input, {
      ...options,
      transformDocument: (document) => {
        document.children.push({
          type: "table",
          children: [
            {
              type: "tableRow",
              children: [
                {
                  type: "tableCell",
                  colSpan: 1,
                  rowSpan: 1,
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        { type: "run", children: [{ type: "text", value: "Recovered table" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });
        return options?.transformDocument?.(document);
      },
    }),
  );
  try {
    const result = await importDocx(
      await Packer.toArrayBuffer(await toDocx({ type: "doc", content: [p("Plain")] }, vi.fn())),
      { uploadImage: vi.fn(), progress: vi.fn() },
    );
    expect(importHtml(result.html).json.content).toMatchObject([
      p("Plain"),
      { type: "table", content: [{ content: [{ content: [p("Recovered table")] }] }] },
    ]);
  } finally {
    spy.mockRestore();
  }
});

it("round58 anchored insertion restores the mapped live caret even if the insertion throws", () => {
  const editor = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p>First</p><p>Last</p>",
  });
  editor.commands.setTextSelection(2);
  const anchor = insertionAnchor(editor);
  try {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(() =>
      anchor.insert(() => {
        editor.commands.insertContent(" inserted");
        throw new Error("failed");
      }),
    ).toThrow("failed");
    expect(editor.state.selection.$from.parent.textContent).toBe("Last");
    editor.commands.insertContent(" continued");
    expect(editor.state.doc.lastChild?.textContent).toBe("Last continued");
  } finally {
    anchor.release();
    editor.destroy();
  }
});
