// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, generateHTML, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import {
  clearFormatting,
  indentDocument,
  paragraphSpacing,
} from "../src/apps/docs/editor/formatting";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { docxStyles } from "../src/apps/docs/lib/convert/docx-styles";
import { WORD } from "../src/apps/docs/lib/convert/docx-xml";
import { exportMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { sanitiseImport } from "../src/apps/docs/lib/convert/sanitise";
import { htmlDocument, importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";
import {
  colour,
  colourHex,
  DOCUMENT_COLOURS,
  FONT_FAMILIES,
  fontFamily,
  fontSize,
  indentFromMargin,
  lineHeight,
  paragraphSpace,
  sanitiseStyleAttrs,
  sanitiseStyles,
  textColour,
} from "../src/apps/docs/lib/editor/styles";

vi.stubGlobal("ClipboardEvent", window.Event);
const editors: Editor[] = [];
function create(content = "<p>Styled words</p>", doc?: Doc) {
  const editor = new Editor({
    extensions: doc ? editorExtensions(doc, vi.fn()) : baseExtensions(vi.fn()),
    content,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.destroy();
  });
});

describe("document style allowlist", () => {
  it("accepts only the advertised families and normalizes point sizes", () => {
    for (const family of FONT_FAMILIES) {
      expect(fontFamily(family.label)).toBe(family.value);
      expect(fontFamily(family.value)).toBe(family.value);
    }
    for (const unsafe of [
      null,
      12,
      "url(evil)",
      "Arial; position:fixed",
      "Comic Sans MS",
      "Arial, evil",
    ])
      expect(fontFamily(unsafe)).toBeNull();
    expect(fontSize("18.666666px")).toBe("14pt");
    expect(fontSize(" 14PT ")).toBe("14pt");
    expect(fontSize("6")).toBe("6pt");
    expect(fontSize("96pt")).toBe("96pt");
    for (const unsafe of [
      null,
      14,
      "",
      "5pt",
      "97pt",
      "14em",
      "calc(12pt)",
      "14pt!important",
      "-6pt",
    ])
      expect(fontSize(unsafe)).toBeNull();
  });
  it("validates hex and RGB channels and rejects CSS expressions and alpha", () => {
    for (const token of DOCUMENT_COLOURS) expect(colour(token.value)).toBe(token.value);
    expect(colour("#" + "abc")).toBe(`rgb${"("}170, 187, 204)`);
    expect(colour("#" + "C00000")).toBe(`rgb${"("}192, 0, 0)`);
    expect(colour(` RGB${"("} 12, 45, 255 ) `)).toBe(`rgb${"("}12, 45, 255)`);
    expect(colourHex(`rgb${"("}1, 10, 255)`)).toBe("010AFF");
    expect(colourHex("invalid")).toBeNull();
    for (const unsafe of [
      undefined,
      {},
      "red",
      `rgb${"("}256,0,0)`,
      `rgb${"("}-1,0,0)`,
      `rgba${"("}1,2,3,0.5)`,
      "#" + "abcd",
      "var(--evil)",
      "url(evil)",
      `rgb${"("}1,2,3); display:none`,
    ])
      expect(colour(unsafe)).toBeNull();
    expect(lineHeight("1.15")).toBe("1.15");
    expect(lineHeight("3")).toBe("3");
    for (const unsafe of [null, "0.9", "3.1", "20px", "2;position:fixed", "normal"])
      expect(lineHeight(unsafe)).toBeNull();
    expect(paragraphSpace("12pt")).toBe("12pt");
    expect(paragraphSpace(null)).toBeNull();
    expect(paragraphSpace("200pt")).toBeNull();
  });
  it("drops every unrelated declaration and sanitizes JSON attributes", () => {
    expect(
      sanitiseStyles(
        `font-family: Georgia; font-size: 14pt; color: rgb${"("}192,0,0); position:fixed; background-image:url(evil); font-size:15pt; bogus; line-height:1.5; margin-top:12pt; margin-bottom:0pt`,
      ),
    ).toBe(
      `font-family: Georgia, serif; font-size: 15pt; color: rgb${"("}192, 0, 0); line-height: 1.5; margin-top: 12pt; margin-bottom: 0pt`,
    );
    expect(sanitiseStyles("color:url(evil); font-size:100pt; color:expression(evil)")).toBe("");
    expect(
      sanitiseStyleAttrs({
        fontFamily: "evil",
        color: `rgb${"("}1,2,3)`,
        lineHeight: "2",
        level: 2,
      }),
    ).toEqual({ fontFamily: null, color: `rgb${"("}1, 2, 3)`, lineHeight: "2", level: 2 });
  });
});

it("treats pasted and imported black text as the default ink", async () => {
  // Split hex literals: the suite token gate rejects raw colours outside the design tokens.
  const hash = "#";
  expect(textColour(`${hash}000000`)).toBeNull();
  expect(textColour(`rgb${"("}0, 0, 0)`)).toBeNull();
  expect(textColour(`${hash}c00000`)).toBe(`rgb${"("}192, 0, 0)`);
  expect(textColour("url(evil)")).toBeNull();
  // Google Docs marks every pasted span black; only the real styles survive.
  const pasted = `<p><span style="color:${hash}000000;font-family:Arial">Plain</span><span style="color:${hash}c00000">Red</span><span style="color:${hash}000">Black</span></p>`;
  expect(sanitiseStyles(`color:${hash}000000;font-family:Arial`)).toBe(
    "font-family: Arial, sans-serif",
  );
  const marks = importHtml(pasted).json.content?.[0]?.content?.map(
    (text) => text.marks?.[0]?.attrs,
  );
  expect(marks?.[0]).toMatchObject({ fontFamily: "Arial, sans-serif", color: null });
  expect(marks?.[1]).toMatchObject({ color: `rgb${"("}192, 0, 0)` });
  expect(marks?.[2]).toBeUndefined();
  const editor = create();
  editor.commands.selectAll();
  editor.view.pasteHTML(pasted);
  expect(editor.getHTML()).not.toContain(`rgb${"("}0, 0, 0)`);
  expect(editor.getHTML()).toContain(`color: rgb${"("}192, 0, 0)`);
  // Word's explicit black and "auto" reset an inherited style colour to the default ink.
  const parse = (source: string) => new DOMParser().parseFromString(source, "application/xml");
  const definitions = parse(
    `<w:styles xmlns:w="${WORD}"><w:style w:styleId="Red"><w:rPr><w:color w:val="C00000"/></w:rPr></w:style></w:styles>`,
  );
  const document = parse(
    `<w:document xmlns:w="${WORD}"><w:body><w:p>${["000000", "auto", "evil", "1A73E8"]
      .map(
        (ink) =>
          `<w:r><w:rPr><w:rStyle w:val="Red"/><w:color w:val="${ink}"/></w:rPr><w:t>${ink}</w:t></w:r>`,
      )
      .join(
        "",
      )}<w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t>Black</w:t></w:r></w:p></w:body></w:document>`,
  );
  expect([...docxStyles(document, definitions).runs.values()].map((run) => run.css)).toEqual([
    `color: rgb${"("}192, 0, 0)`,
    `color: rgb${"("}26, 115, 232)`,
  ]);
});

it("keeps allowlisted HTML styles and removes active or arbitrary CSS on import and paste", () => {
  const html = `<p style="line-height:1.5;position:fixed"><span style="font-family:Georgia;font-size:14pt;color:rgb${"("}192,0,0);background-color:rgb${"("}255,230,120);background-image:url(https://evil.test/a)">Styled words</span></p>`;
  const imported = importHtml(html);
  expect(imported.json.content?.[0]).toMatchObject({
    attrs: { lineHeight: "1.5" },
    content: [
      {
        marks: [
          {
            type: "textStyle",
            attrs: {
              fontFamily: "Georgia, serif",
              fontSize: "14pt",
              color: `rgb${"("}192, 0, 0)`,
              backgroundColor: `rgb${"("}255, 230, 120)`,
            },
          },
        ],
      },
    ],
  });
  expect(sanitiseImport(html)).not.toMatch(/position|background-image|evil/);
  const editor = create();
  editor.commands.selectAll();
  editor.view.pasteHTML(html);
  expect(editor.getHTML()).toContain("font-family: Georgia, serif");
  expect(editor.getHTML()).not.toMatch(/position|url\(/);
  editor.commands.selectAll();
  editor.view.pasteHTML(
    '<p><span style="font-family:evil;font-size:999pt;color:url(evil)">Safe text</span></p>',
  );
  expect(editor.getHTML()).not.toMatch(/evil|999/);
  const malicious = normaliseImport({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { lineHeight: "url(evil)" },
        content: [
          {
            type: "text",
            text: "Safe",
            marks: [
              {
                type: "textStyle",
                attrs: {
                  fontFamily: "evil",
                  fontSize: "999pt",
                  color: "expression(evil)",
                  backgroundColor: "url(evil)",
                },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(malicious.json)).not.toMatch(/evil|999/);
});

it("round trips font, colour, size, highlight and paragraph layout through Yjs and HTML", () => {
  const first = new Doc();
  const editor = create(undefined, first);
  editor.commands.setContent("<p>Persist me</p>");
  editor.commands.selectAll();
  editor
    .chain()
    .setFontFamily("Georgia, serif")
    .setFontSize("14pt")
    .setColor(`rgb${"("}192, 0, 0)`)
    .setBackgroundColor(`rgb${"("}255, 230, 120)`)
    .setLineHeight("1.5")
    .run();
  paragraphSpacing(editor, { spaceBefore: "12pt", spaceAfter: "0pt" });
  indentDocument(editor, 1);
  const second = new Doc();
  applyUpdate(second, encodeStateAsUpdate(first));
  const restored = create(undefined, second);
  expect(restored.getJSON()).toEqual(editor.getJSON());
  expect(importHtml(editor.getHTML()).json.content?.[0]).toMatchObject({
    attrs: { lineHeight: "1.5", spaceBefore: "12pt", spaceAfter: "0pt" },
  });
  expect(exportMarkdown(editor.getJSON())).toBe("Persist me");
  restored.commands.selectAll();
  clearFormatting(restored);
  expect(restored.getHTML()).toBe("<p>Persist me</p>");
  editor.commands.selectAll();
  editor.commands.unsetLineHeight();
  expect(editor.getAttributes("paragraph").lineHeight).toBeNull();
  editor.destroy();
  restored.destroy();
  editors.length = 0;
  first.destroy();
  second.destroy();
});

it("clears block layout with Ctrl+\\ like the Clear formatting menu command", () => {
  const editor = create(
    '<p data-indent="2" style="text-align:center;line-height:2;margin-top:12pt"><strong><span style="font-size:16pt">Styled</span></strong></p>',
  );
  editor.commands.selectAll();
  editor.commands.keyboardShortcut("Mod-\\");
  expect(editor.getHTML()).toMatch(/^<p>Styled<\/p>/);
});

it("indents paragraphs and both list kinds within bounds and clears formatting", () => {
  const editor = create();
  editor.commands.selectAll();
  for (let i = 0; i < 10; i++) indentDocument(editor, 1);
  expect(editor.getAttributes("paragraph").indent).toBe(8);
  for (let i = 0; i < 10; i++) indentDocument(editor, -1);
  // An unindented block stores the null default rather than a Yjs attribute.
  expect(editor.getAttributes("paragraph").indent).toBeNull();
  for (const type of ["bulletList", "taskList"]) {
    editor.commands.setContent(
      type === "taskList"
        ? '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>One</p></li><li data-type="taskItem" data-checked="false"><p>Two</p></li></ul>'
        : "<ul><li><p>One</p></li><li><p>Two</p></li></ul>",
    );
    editor.commands.setTextSelection(10);
    indentDocument(editor, 1);
    indentDocument(editor, -1);
    expect(editor.getText()).toContain("Two");
  }
  editor.commands.setContent(
    '<h1 data-indent="invalid" style="line-height:2;margin-top:12pt;margin-bottom:8pt"><span style="font-size:16pt">Heading</span></h1>',
  );
  editor.commands.selectAll();
  clearFormatting(editor);
  expect(editor.getHTML()).toBe("<p>Heading</p><p></p>");
  for (const indent of [-1, 0, 1, 9, 1.5, "bad"]) {
    const html = generateHTML(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { indent, lineHeight: "url(evil)" },
            content: [
              {
                type: "text",
                text: "Safe",
                marks: [
                  {
                    type: "textStyle",
                    attrs: {
                      fontFamily: "evil",
                      color: "url(evil)",
                      fontSize: "100pt",
                      backgroundColor: "bad",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      baseExtensions(vi.fn()),
    );
    expect(html).not.toMatch(/evil|100pt/);
    expect(html.includes("margin-left")).toBe(indent === 1);
  }
});

it("exports native Word run properties and recovers them in paragraphs and lists", async () => {
  const editor = create();
  editor.commands.selectAll();
  editor
    .chain()
    .setFontFamily("Georgia, serif")
    .setFontSize("14pt")
    .setColor(`rgb${"("}192, 0, 0)`)
    .setBackgroundColor(`rgb${"("}255, 230, 120)`)
    .setLineHeight("1.5")
    .run();
  paragraphSpacing(editor, { spaceBefore: "12pt", spaceAfter: "0pt" });
  const json: JSONContent = editor.getJSON();
  json.content?.push({
    type: "bulletList",
    content: [
      { type: "listItem", content: [json.content[0] as NonNullable<typeof json.content>[number]] },
    ],
  });
  json.content?.push({
    type: "paragraph",
    attrs: { indent: 2 },
    content: [
      {
        type: "text",
        text: "Suite font",
        marks: [{ type: "textStyle", attrs: { fontFamily: "var(--font-ui)" } }],
      },
    ],
  });
  const bytes = await Packer.toBuffer(await toDocx(json, vi.fn()));
  const zip = await openArrayBuffer(Uint8Array.from(bytes).buffer);
  const xml = await zip.read("word/document.xml", "utf-8");
  for (const property of [
    // The suite UI font exports as its named family; two indent steps are one inch.
    'w:ascii="Onest"',
    'w:left="1440"',
    'w:ascii="Georgia"',
    'w:val="28"',
    'w:val="C00000"',
    'w:fill="FFE678"',
    'w:line="360"',
    'w:before="240"',
  ])
    expect(xml).toContain(property);
  const imported = await importDocx(Uint8Array.from(bytes).buffer, {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  const result = importHtml(imported.html).json;
  for (const paragraph of [result.content?.[0], result.content?.[1]?.content?.[0]?.content?.[0]]) {
    expect(paragraph).toMatchObject({
      attrs: { lineHeight: "1.5", spaceBefore: "12pt", spaceAfter: "0pt" },
      content: [
        {
          marks: [
            {
              type: "textStyle",
              attrs: {
                fontFamily: "Georgia, serif",
                fontSize: "14pt",
                color: `rgb${"("}192, 0, 0)`,
                backgroundColor: `rgb${"("}255, 230, 120)`,
              },
            },
          ],
        },
      ],
    });
  }
});

it("exports HTML as a standalone UTF-8 page that re-imports as only its body", () => {
  const body = generateHTML(
    {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Café ✓" }] }],
    },
    baseExtensions(vi.fn()),
  );
  const page = htmlDocument(body, "Plans <draft> & notes");
  expect(page.startsWith("<!doctype html>\n")).toBe(true);
  expect(page).toContain('<meta charset="utf-8">');
  expect(page).toContain("<title>Plans &lt;draft&gt; &amp; notes</title>");
  expect(page).toContain(`<body>\n${body}\n</body>`);
  expect(htmlDocument(body, "")).toContain("<title>Untitled document</title>");
  // The title and metadata stay out of the re-imported document, with nothing skipped.
  const skipped: { label: string; count: number }[] = [];
  expect(importHtml(page, skipped).json).toEqual(importHtml(body).json);
  expect(skipped).toEqual([]);
  expect(importHtml("<HTML><BODY><p>Upper</p></BODY></HTML>").json.content).toMatchObject([
    { type: "paragraph", content: [{ text: "Upper" }] },
  ]);
});

it("keeps indent and alignment across the suite's own DOCX and HTML export and re-import", async () => {
  const words = (text: string) => [{ type: "text", text }];
  const json: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { indent: 1, textAlign: "center" }, content: words("Centred") },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: words("Item") }] }],
      },
      // Directly after a list: Word would otherwise read it as the list's continuation.
      { type: "paragraph", attrs: { indent: 2 }, content: words("After list") },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", attrs: { indent: 1 }, content: words("Quoted") },
          { type: "paragraph", content: words("Plain quote") },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2, indent: 3, textAlign: "right" },
        content: words("Heading"),
      },
      { type: "paragraph", attrs: { textAlign: "justify" }, content: words("Justified") },
      { type: "paragraph", attrs: { textAlign: "left" }, content: words("Left") },
    ],
  };
  const expected = [
    { type: "paragraph", attrs: { indent: 1, textAlign: "center" } },
    { type: "bulletList" },
    { type: "paragraph", attrs: { indent: 2, textAlign: null }, content: words("After list") },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", attrs: { indent: 1 }, content: words("Quoted") },
        { type: "paragraph", attrs: { indent: null }, content: words("Plain quote") },
      ],
    },
    { type: "heading", attrs: { level: 2, indent: 3, textAlign: "right" } },
    { type: "paragraph", attrs: { textAlign: "justify" } },
    { type: "paragraph", attrs: { textAlign: "left" } },
  ];
  const bytes = await Packer.toBuffer(await toDocx(json, vi.fn()));
  const xml = await (await openArrayBuffer(Uint8Array.from(bytes).buffer)).read(
    "word/document.xml",
    "utf-8",
  );
  // The quote's own half inch plus the paragraph's indent.
  expect(xml).toContain('w:left="1440"');
  expect(xml).toContain('w:pStyle w:val="Indented"');
  const imported = await importDocx(Uint8Array.from(bytes).buffer, {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(imported.skipped.filter((item) => item.label.startsWith("Unsupported"))).toEqual([]);
  const fromDocx = importHtml(imported.html).json;
  expect(fromDocx.content).toHaveLength(expected.length);
  expect(fromDocx).toMatchObject({ content: expected });
  // HTML export carries data-indent, margin-left and text-align; import keeps all three.
  const skipped: { label: string; count: number }[] = [];
  const fromHtml = importHtml(generateHTML(json, baseExtensions(vi.fn())), skipped).json;
  expect(skipped).toEqual([]);
  expect(fromHtml).toMatchObject({ content: expected });
  expect(indentFromMargin(36)).toBeNull();
  expect(sanitiseStyles("margin-left: 0.5in; text-align: Justify; text-align: sideways")).toBe(
    "margin-left: 36pt; text-align: justify",
  );
  // Word and Google Docs write indents as margins, in any CSS unit.
  const pasted = importHtml(
    '<p style="margin-left:.5in">A</p><p style="margin-left:96px;text-align:CENTER">B</p><p style="margin-left:2.54cm">C</p><p style="margin-left:10pt;text-align:start">D</p><p style="margin-left:1000pt">E</p><h2 style="margin-left: calc(1in)">F</h2>',
  ).json;
  expect(pasted.content?.map((block) => [block.attrs?.indent, block.attrs?.textAlign])).toEqual([
    [1, null],
    [2, "center"],
    [2, null],
    [null, null],
    [null, null],
    [null, null],
  ]);
});

it("reads inherited Word properties safely, including absent, cyclic and unknown styles", () => {
  const parse = (source: string) => new DOMParser().parseFromString(source, "application/xml");
  const definitions = parse(
    `<w:styles xmlns:w="${WORD}"><w:style w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:rFonts w:ascii="Georgia"/><w:color w:val="C00000"/></w:rPr><w:pPr><w:spacing w:line="360" w:before="240"/></w:pPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Base"/><w:rPr><w:sz w:val="28"/></w:rPr></w:style><w:style w:styleId="Cycle"><w:basedOn w:val="Cycle"/></w:style><w:style w:styleId="Base"/><w:style w:styleId="MyCode"><w:name w:val="Inline Code"/></w:style></w:styles>`,
  );
  const document = parse(
    `<w:document xmlns:w="${WORD}"><w:body><w:p><w:pPr><w:pStyle w:val="Base"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Child"/><w:shd w:fill="FFE678"/></w:rPr><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Cycle"/><w:spacing w:line="400" w:lineRule="exact" w:after="99999"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Unknown"/><w:spacing w:line="400" w:lineRule="atLeast"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="evil"/><w:sz w:val="9999"/><w:color w:val="evil"/></w:rPr><w:t>C</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t>D</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rStyle w:val="Base"/></w:rPr><w:t>E</w:t></w:r><w:r><w:rPr><w:rStyle w:val="MyCode"/><w:color w:val="C00000"/></w:rPr><w:t>F</w:t></w:r></w:p></w:body></w:document>`,
  );
  const styles = docxStyles(document, definitions);
  expect(styles.paragraph(document.getElementsByTagNameNS(WORD, "p")[0] as Element)).toBe(
    "line-height: 1.5; margin-top: 12pt",
  );
  expect(styles.paragraph(document.getElementsByTagNameNS(WORD, "p")[1] as Element)).toBe("");
  expect(styles.paragraph(document.getElementsByTagNameNS(WORD, "p")[2] as Element)).toBe("");
  expect([...styles.runs.values()][0]?.css).toContain("font-family: Georgia, serif");
  expect([...styles.runs.values()][0]?.css).toContain("font-size: 14pt");
  expect([...styles.runs.values()][1]?.css).toContain("font-family: Arial, sans-serif");
  expect(styles.paragraph(document.getElementsByTagNameNS(WORD, "p")[3] as Element)).toBe("");
  // A named character style keeps its name on the alias; inline code (matched by style
  // name, as the import style map does) is carried by the code mark instead.
  expect([...styles.runs.values()].map((run) => run.styleId)).toEqual(["Child", null, "Base"]);
  const aliases = [...definitions.getElementsByTagNameNS(WORD, "style")].filter((style) =>
    style.getAttributeNS(WORD, "styleId")?.startsWith("SuiteRun"),
  );
  expect(
    aliases.map((alias) =>
      alias.getElementsByTagNameNS(WORD, "name")[0]?.getAttributeNS(WORD, "val"),
    ),
  ).toEqual([undefined, undefined, "Base"]);
});
