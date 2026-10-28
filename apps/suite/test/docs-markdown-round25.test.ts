// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { markdownText, markdownWhitespace } from "./helpers/docs-markdown-text";

const schema = getSchema(baseExtensions(vi.fn()));
const paragraph = (text: string, marks: JSONContent["marks"] = []): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text, marks }],
});

it.each([
  {
    name: "literal tab delimiter in bulleted inline code",
    task: false,
    text: "cut -d '\t' -f2 data.tsv",
  },
  { name: "checked task label beginning with NBSP", task: true, text: "\u00a0Keep checked" },
])("round25 preserves $name through Markdown replace and snapshot reopen", ({ task, text }) => {
  const doc = new Doc();
  const reopenedDoc = new Doc();
  const editor = new Editor({ extensions: editorExtensions(doc, vi.fn()) });
  const reopened = new Editor({ extensions: editorExtensions(reopenedDoc, vi.fn()) });
  try {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: task ? "taskList" : "bulletList",
          content: [
            {
              type: task ? "taskItem" : "listItem",
              ...(task ? { attrs: { checked: true } } : {}),
              content: [paragraph(text)],
            },
          ],
        },
      ],
    });
    if (!task)
      editor
        .chain()
        .setTextSelection({ from: 3, to: 3 + text.length })
        .setCode()
        .run();
    const before: JSONContent = editor.getJSON();
    expect(before.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe(text);
    const imported = importMarkdown(exportMarkdown(before), "round25.md");
    expect(imported.skipped).toEqual([]);
    expect(imported.json).toEqual(before);
    editor.commands.setContent(imported.json);
    expect(editor.getJSON()).toEqual(before);
    applyUpdate(reopenedDoc, encodeStateAsUpdate(doc));
    expect(yDocToProsemirrorJSON(reopenedDoc, "prosemirror")).toEqual(
      yDocToProsemirrorJSON(doc, "prosemirror"),
    );
    expect(reopened.getJSON()).toEqual(before);
  } finally {
    editor.destroy();
    reopened.destroy();
    doc.destroy();
    reopenedDoc.destroy();
  }
});

it("round trips generated whitespace in every Markdown text position and isolated mark", () => {
  const visitedMarks = new Set<string>();
  fc.assert(
    fc.property(
      markdownText,
      fc.boolean(),
      fc.constantFrom(null, ...Object.keys(schema.marks)),
      (value, checked, mark) => {
        if (mark) visitedMarks.add(mark);
        const labelled = paragraph(
          value,
          mark
            ? [
                {
                  type: mark,
                  ...(mark === "link" ? { attrs: { href: "https://example.org/" } } : {}),
                },
              ]
            : [],
        );
        const blocks: JSONContent[] = [
          labelled,
          { ...labelled, type: "heading", attrs: { level: 2 } },
          { type: "codeBlock", content: [{ type: "text", text: value }] },
          ...["bulletList", "orderedList", "taskList"].map(
            (type): JSONContent => ({
              type,
              content: [
                {
                  type: type === "taskList" ? "taskItem" : "listItem",
                  ...(type === "taskList" ? { attrs: { checked } } : {}),
                  content: [labelled],
                },
              ],
            }),
          ),
          {
            type: "table",
            content: ["tableHeader", "tableCell"].map((type) => ({
              type: "tableRow",
              content: [{ type, content: [labelled] }],
            })),
          },
        ];
        const original = schema.nodeFromJSON({
          type: "doc",
          content: blocks.flatMap((block) => [block, { type: "horizontalRule" }]),
        });
        original.check();
        const imported = importMarkdown(exportMarkdown(original.toJSON()), "whitespace.md");
        expect(imported.skipped).toEqual([]);
        expect(imported.json).toEqual(original.toJSON());
      },
    ),
    { seed: 2507, numRuns: 1000 },
  );
  expect([...visitedMarks].sort()).toEqual(Object.keys(schema.marks).sort());
}, 120_000);

it("recognizes task markers before whitespace-only, empty and invisible labels", () => {
  fc.assert(
    fc.property(markdownWhitespace, (label) => {
      for (const marker of ["x", "X", " "]) {
        const imported = importMarkdown(`- [${marker}] ${label}`, "task.md");
        expect(imported.json.content?.[0]).toMatchObject({
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: marker !== " " } }],
        });
      }
    }),
    { seed: 2517, numRuns: 100 },
  );
  expect(importMarkdown("- [x] ", "empty.md").json.content?.[0]?.type).toBe("taskList");
});

it.each([
  "\u2028",
  "\u2029",
  "\u00a0",
  "\ufeff",
])("preserves Unicode whitespace %j before quote markers in nested code blocks", (space) => {
  const original = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  paragraph("  "),
                  { type: "codeBlock", content: [{ type: "text", text: ` ${space}>\n launch()` }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  expect(importMarkdown(exportMarkdown(original.toJSON()), "code.md").json).toEqual(
    original.toJSON(),
  );
});
