// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import {
  exportMarkdown,
  importMarkdown,
  MARKDOWN_MARK_RULES,
  MARKDOWN_NODE_RULES,
} from "../src/apps/docs/lib/convert/markdown";
import { markdownText } from "./helpers/docs-markdown-text";

const schema = getSchema(baseExtensions(vi.fn()));
const text = (value: string): JSONContent => ({ type: "text", text: value });
const p = (value = "Text"): JSONContent => ({ type: "paragraph", content: [text(value)] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
function roundTrip(json: JSONContent) {
  const original = schema.nodeFromJSON(json);
  original.check();
  const exported = exportMarkdown(original.toJSON());
  expect(importMarkdown(exported, "schema.md").json).toEqual(original.toJSON());
  return exported;
}

function replaceAndReopen(arrange: (editor: Editor) => void) {
  const doc = new Doc();
  const reopenedDoc = new Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(doc, vi.fn()),
  });
  const reopened = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(reopenedDoc, vi.fn()),
  });
  try {
    arrange(editor);
    const before = editor.getJSON();
    const downloaded = exportMarkdown(before);
    editor.commands.setContent(importMarkdown(downloaded, "round18.md").json);
    expect(editor.getJSON()).toEqual(before);
    applyUpdate(reopenedDoc, encodeStateAsUpdate(doc));
    expect(yDocToProsemirrorJSON(reopenedDoc, "prosemirror")).toEqual(
      yDocToProsemirrorJSON(doc, "prosemirror"),
    );
    expect(reopened.getJSON()).toEqual(before);
    return downloaded;
  } finally {
    editor.destroy();
    reopened.destroy();
    doc.destroy();
    reopenedDoc.destroy();
  }
}

it("round18 preserves subscript and superscript through Markdown replace and snapshot reopen", () => {
  const downloaded = replaceAndReopen((editor) => {
    editor.commands.setContent("<p>H2O and x2</p>");
    editor.chain().setTextSelection({ from: 2, to: 3 }).setSubscript().run();
    editor.chain().setTextSelection({ from: 10, to: 11 }).setSuperscript().run();
    expect(editor.getJSON().content?.[0]?.content).toMatchObject([
      { text: "H" },
      { text: "2", marks: [{ type: "subscript" }] },
      { text: "O and x" },
      { text: "2", marks: [{ type: "superscript" }] },
    ]);
  });
  expect(downloaded).toContain("<sub>");
  expect(downloaded).toContain("<sup>");
});

it("round18 preserves two bulleted items in a table cell through Markdown replace and snapshot reopen", () => {
  const downloaded = replaceAndReopen((editor) => {
    editor.commands.setContent(
      "<table><tr><th><p>Heading</p></th></tr><tr><td><ul><li><p>First item</p></li><li><p>Second item</p></li></ul></td></tr></table>",
    );
    const json: JSONContent = editor.getJSON();
    const list = json.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0];
    expect(list?.type).toBe("bulletList");
    expect(list?.content).toHaveLength(2);
  });
  expect(downloaded).toContain("<table>");
  expect(downloaded).toContain("<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>");
});

it("has an export rule for every live editor node, mark and attribute", () => {
  for (const [types, rules] of [
    [schema.nodes, MARKDOWN_NODE_RULES],
    [schema.marks, MARKDOWN_MARK_RULES],
  ] as const) {
    expect(Object.keys(rules).sort()).toEqual(Object.keys(types).sort());
    for (const [name, type] of Object.entries(types)) {
      expect(rules[name]?.attributes.toSorted(), name).toEqual(
        Object.keys(type.spec.attrs ?? {}).sort(),
      );
    }
  }
});

it("rejects missing export rules instead of silently dropping new schema types", () => {
  expect(() => exportMarkdown(doc({ type: "futureNode" }))).toThrow(
    "No Markdown export rule for node futureNode",
  );
  expect(() =>
    exportMarkdown(
      doc({ type: "paragraph", content: [{ ...text("future"), marks: [{ type: "futureMark" }] }] }),
    ),
  ).toThrow("No Markdown export rule for mark futureMark");
});

it("uses GFM for exactly representable marks, blocks, tasks and aligned tables", () => {
  const original = importMarkdown(
    "# Heading\n\n**bold** *italic* ~~strike~~ `code` [link](https://example.org/)\n\n> Quote\n\n- Item\n\n---\n\n7. Seven\n\nBetween\n\n- [x] Done\n\n| Left | Right |\n| :--- | ---: |\n| One | Two |\n\n![Photo](https://example.org/photo.png)",
    "gfm.md",
  ).json;
  const exported = roundTrip(original);
  for (const syntax of [
    "# Heading",
    "**bold**",
    "*italic*",
    "~~strike~~",
    "`code`",
    "[link]",
    "> Quote",
    "- Item",
    "7. Seven",
    "- [x] Done",
    "|",
    "![Photo]",
  ])
    expect(exported).toContain(syntax);
  expect(exported).not.toContain("<table");
});

it.each([
  "left",
  "center",
  "right",
  "justify",
])("preserves %s paragraph and heading alignment", (textAlign) => {
  roundTrip(
    doc(
      { ...p(), attrs: { textAlign } },
      { type: "heading", attrs: { level: 3, textAlign }, content: [text("Heading")] },
    ),
  );
});

it("accepts ordinary HTML for all fallback marks and block attributes", () => {
  const parsed = importMarkdown(
    '<h2 style="text-align: right">Title</h2><p><u>u</u><sub>sub</sub><sup>sup</sup><mark>mark</mark></p><ol start="7" type="a"><li><p>Item</p></li></ol><img src="https://example.org/image.png" width="120" height="60"><table><tr><td colspan="2" rowspan="2" colwidth="80,90" align="center"><p>A</p><p>B</p></td></tr></table>',
    "html.md",
  ).json;
  expect(parsed.content?.[0]?.attrs).toEqual({ level: 2, textAlign: "right" });
  expect(
    parsed.content?.[1]?.content?.flatMap((node) => node.marks?.map((mark) => mark.type)),
  ).toEqual(["underline", "subscript", "superscript", "highlight"]);
  expect(parsed.content?.[2]?.attrs).toEqual({ start: 7, type: "a" });
  expect(parsed.content?.[3]?.attrs).toMatchObject({ width: 120, height: 60 });
  expect(parsed.content?.[4]?.content?.[0]?.content?.[0]?.attrs).toEqual({
    colspan: 2,
    rowspan: 2,
    colwidth: [80, 90],
    align: "center",
  });
  roundTrip(parsed);
});

it("preserves punctuation touching an emphasis boundary and links with empty titles", () => {
  roundTrip(
    doc({
      type: "paragraph",
      content: [text("before"), { ...text("!word"), marks: [{ type: "bold" }] }, text("after")],
    }),
  );
  roundTrip(
    doc({
      type: "paragraph",
      content: [
        {
          ...text("link"),
          marks: [{ type: "link", attrs: { href: "https://example.org/", title: "" } }],
        },
      ],
    }),
  );
});

it("preserves unmarked hard breaks at paragraph and GFM table-cell boundaries", () => {
  for (const content of [
    [{ type: "hardBreak" }],
    [{ type: "hardBreak" }, text("after")],
    [text("before"), { type: "hardBreak" }],
    [text("before"), { type: "hardBreak" }, text("after")],
    [text("before"), { type: "hardBreak" }, { type: "hardBreak" }, text("after")],
  ]) {
    const paragraph = { type: "paragraph", content };
    roundTrip(doc(paragraph));
    roundTrip(doc({ ...paragraph, type: "heading", attrs: { level: 2 } }));
    roundTrip(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [paragraph] }] },
        ],
      }),
    );
  }
});

it.each([
  "\n",
  "\n\n",
  "before\n",
  " \n \n ",
  "\r\n",
  "a\n\nb",
  "DOCSCARRIAGERETURN\r\nDOCSCARRIAGERETURNX",
])("preserves code line boundaries: %j", (value) => {
  roundTrip(doc({ type: "codeBlock", content: [text(value)] }));
  roundTrip(doc({ type: "paragraph", content: [{ ...text(value), marks: [{ type: "code" }] }] }));
});

it("preserves GFM table links with pipes and empty cells", () => {
  const cell = (type: string, content?: JSONContent[]): JSONContent => ({
    type,
    content: [{ type: "paragraph", ...(content ? { content } : {}) }],
  });
  const exported = roundTrip(
    doc({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader")] },
        {
          type: "tableRow",
          content: [
            cell("tableCell", [
              {
                ...text("link | text"),
                marks: [
                  { type: "link", attrs: { href: "https://example.org/a%7Cb", title: "a|b" } },
                ],
              },
            ]),
          ],
        },
      ],
    }),
  );
  expect(exported).not.toContain("<table");
  expect(exported).toContain("&#x7C;");
});

it("uses schema defaults for omitted task attributes and empty HTML tables", () => {
  expect(
    roundTrip(
      doc({ type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph" }] }] }),
    ),
  ).toBe("- [ ] <p></p>");
  const task: JSONContent = {
    type: "taskList",
    content: [{ type: "taskItem", content: [p()] }],
  };
  const adjacent = doc(task, task);
  const exported = exportMarkdown(adjacent);
  expect(exported).toContain('data-checked="false"');
  expect(importMarkdown(exported, "tasks.md").json).toEqual(schema.nodeFromJSON(adjacent).toJSON());
  const ordered = doc({ type: "orderedList", content: [{ type: "listItem", content: [p()] }] });
  expect(exportMarkdown(ordered)).toBe("1. Text");
  expect(importMarkdown(exportMarkdown(ordered), "ordered.md").json).toEqual(
    schema.nodeFromJSON(ordered).toJSON(),
  );
  expect(exportMarkdown(doc({ type: "table" }))).toBe("<table></table>");
});

it.each([
  "bad JSON",
  "null",
  "17",
  '{"onclick":"evil()","textAlign":"center"}',
])("ignores malformed or undeclared HTML metadata: %s", (metadata) => {
  const parsed = importMarkdown(
    `<p data-docs-attrs='${metadata}'>Text</p><br data-docs-attrs='${metadata}'>`,
    "metadata.md",
  ).json;
  const paragraph = parsed.content?.[0];
  expect(paragraph?.attrs).toEqual({ textAlign: metadata.includes("center") ? "center" : null });
  expect(JSON.stringify(parsed)).not.toContain("onclick");
});

it.each([
  "javascript:alert(1)",
  "https://user:pass@example.org/image.png",
])("rejects unsafe HTML image sources: %s", (src) => {
  const parsed = importMarkdown(`<img src="${src}">`, "unsafe.md").json;
  expect(parsed.content?.some((node) => node.type === "image")).toBe(false);
  const metadata = JSON.stringify({ src });
  const overridden = importMarkdown(
    `<img src="https://example.org/image.png" data-docs-attrs='${metadata}'>`,
    "unsafe-metadata.md",
  ).json;
  expect(overridden.content?.some((node) => node.type === "image")).toBe(false);
});

const word = markdownText;
const inlineContent = fc
  .array(word, { minLength: 1, maxLength: 3 })
  .map((words) =>
    words.flatMap((value, index) => (index ? [{ type: "hardBreak" }, text(value)] : [text(value)])),
  );
const paragraph = fc
  .tuple(inlineContent, fc.constantFrom(null, "left", "center", "right", "justify"))
  .map(([content, textAlign]) => ({ type: "paragraph", content, attrs: { textAlign } }));
const list = (child: fc.Arbitrary<JSONContent>, minChildren = 0): fc.Arbitrary<JSONContent> =>
  fc
    .tuple(
      fc.constantFrom("bulletList", "orderedList", "taskList"),
      fc.integer({ min: 1, max: 12 }),
      fc.constantFrom(null, "a", "I"),
      fc.array(
        fc.tuple(
          paragraph,
          fc.boolean(),
          fc.array(child, { minLength: minChildren, maxLength: 2 }),
        ),
        {
          minLength: 1,
          maxLength: 2,
        },
      ),
    )
    .map(([type, start, style, items]) => ({
      type,
      ...(type === "orderedList" ? { attrs: { start, type: style } } : {}),
      content: items.map(([first, checked, rest]) => ({
        type: type === "taskList" ? "taskItem" : "listItem",
        ...(type === "taskList" ? { attrs: { checked } } : {}),
        content: [first, ...rest],
      })),
    }));
const nestedList = list(list(paragraph));

it("round trips generated nested lists, tasks and blockquotes with indented code lines, hard breaks, multiple paragraphs and opening thematic breaks", () => {
  const indentedCode: fc.Arbitrary<JSONContent> = fc
    .tuple(word, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
    .map(([value, firstIndent, secondIndent]) => ({
      type: "codeBlock",
      attrs: { language: "python" },
      content: [text(`${" ".repeat(firstIndent)}${value}\n${" ".repeat(secondIndent)}launch()`)],
    }));
  const plain: fc.Arbitrary<JSONContent> = fc.oneof(
    inlineContent.map((content) => ({ type: "paragraph", content })),
    indentedCode,
    word.map((value) => ({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [p(value), p("Second paragraph")] }],
        },
      ],
    })),
  );
  const containers = (
    child: fc.Arbitrary<JSONContent>,
    minChildren = 0,
  ): fc.Arbitrary<JSONContent> =>
    fc.oneof(
      list(child, minChildren),
      fc
        .array(child, { minLength: 1, maxLength: 3 })
        .map((content) => ({ type: "blockquote", content })),
    );
  const generated = containers(fc.oneof(plain, containers(fc.oneof(plain, containers(plain)))));
  const nestedCode = containers(containers(indentedCode, 1), 1);
  fc.assert(
    fc.property(generated, nestedCode, (value, code) => {
      const stripAlignment = (node: JSONContent): JSONContent => ({
        ...node,
        ...(node.type === "paragraph" ? { attrs: { textAlign: null } } : {}),
        ...(node.content ? { content: node.content.map(stripAlignment) } : {}),
      });
      roundTrip(
        doc(
          { type: "horizontalRule" },
          stripAlignment(value),
          { type: "horizontalRule" },
          stripAlignment(code),
          { type: "horizontalRule" },
          p("Final section"),
        ),
      );
    }),
    { seed: 1817, numRuns: 200 },
  );
});

it("round trips generated documents with every schema node and mark including nested lists in table cells", () => {
  const visitedNodes = new Set<string>();
  const visitedMarks = new Set<string>();
  fc.assert(
    fc.property(
      paragraph,
      nestedList,
      word,
      fc.integer({ min: 1, max: 3 }),
      fc.boolean(),
      fc.constantFrom(null, "js", "", "markdown linenums=1", "`\n<script>"),
      fc.constantFrom(null, 120, "240"),
      fc.constantFrom(null, "left", "center", "right"),
      (para, nested, value, level, checked, language, size, align) => {
        const original = doc(
          {
            type: "paragraph",
            content: Object.keys(schema.marks).flatMap((type): JSONContent[] => [
              {
                ...text(value),
                marks: [
                  {
                    type,
                    ...(type === "link"
                      ? {
                          attrs: {
                            href: "https://example.org/?x=1&y=2",
                            target: checked ? "_self" : null,
                            rel: null,
                            class: "docs",
                            title: "",
                          },
                        }
                      : {}),
                  },
                ],
              },
              { type: "hardBreak", marks: [{ type: "underline" }] },
            ]),
          },
          para,
          { type: "paragraph" },
          { type: "heading", attrs: { level }, content: [text(value)] },
          { type: "blockquote", content: [para, nested] },
          ...["bulletList", "orderedList", "taskList"].map(
            (type): JSONContent => ({
              type,
              content: [
                {
                  type: type === "taskList" ? "taskItem" : "listItem",
                  attrs: type === "taskList" ? { checked } : {},
                  content: [p(value), nested],
                },
              ],
            }),
          ),
          { type: "horizontalRule" },
          { type: "codeBlock", attrs: { language }, content: [text(value)] },
          {
            type: "image",
            attrs: {
              src: "https://example.org/image.png",
              alt: checked ? value : null,
              title: "",
              width: size,
              height: size,
            },
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 2, colwidth: [80, 90], align },
                    content: [para],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: { rowspan: 2, align },
                    content: [
                      nested,
                      {
                        type: "table",
                        content: [
                          {
                            type: "tableRow",
                            content: [{ type: "tableCell", content: [p(value), p(value)] }],
                          },
                        ],
                      },
                    ],
                  },
                  { type: "tableCell", content: [para] },
                ],
              },
              { type: "tableRow", content: [{ type: "tableCell", content: [para] }] },
            ],
          },
        );
        const visit = (node: JSONContent) => {
          visitedNodes.add(node.type as string);
          for (const mark of node.marks ?? []) visitedMarks.add(mark.type);
          for (const child of node.content ?? []) visit(child);
        };
        visit(original);
        roundTrip(original);
      },
    ),
    { seed: 1807, numRuns: 100 },
  );
  expect([...visitedNodes].sort()).toEqual(Object.keys(schema.nodes).sort());
  expect([...visitedMarks].sort()).toEqual(Object.keys(schema.marks).sort());
});
