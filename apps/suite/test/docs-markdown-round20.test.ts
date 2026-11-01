// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const code = "if ready:\n    launch()";

it("round20 preserves GFM checklist code indentation through import, Markdown replace and snapshot reopen", () => {
  const imported = importMarkdown(
    "- [ ] Example\n\n  ```python\n  if ready:\n      launch()\n  ```",
    "round20.md",
  ).json;
  expect(imported.content).toMatchObject([
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Example" }] },
            {
              type: "codeBlock",
              attrs: { language: "python" },
              content: [{ type: "text", text: code }],
            },
          ],
        },
      ],
    },
  ]);
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
    editor.commands.setContent(imported);
    const before = editor.getJSON();
    editor.commands.setContent(importMarkdown(exportMarkdown(before), "round20.md").json);
    expect(editor.getJSON()).toEqual(before);
    const snapshot = encodeStateAsUpdate(doc);
    applyUpdate(reopenedDoc, snapshot);
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

it.each([
  ["fenced code", "- [x] Example\n\n  ~~~python\n  if ready:\n      launch()\n  ~~~"],
  ["indented code", "- [ ] Example\n\n      if ready:\n          launch()"],
  ["wide bullet", "-   [ ] Example\n\n    ```python\n    if ready:\n        launch()\n    ```"],
  ["ordered task", "12. [x] Example\n\n    ```python\n    if ready:\n        launch()\n    ```"],
  [
    "nested task and quote",
    "> - [ ] Example\n>\n>   - [x] Nested\n>\n>     ```python\n>     if ready:\n>         launch()\n>     ```",
  ],
])("preserves CommonMark content offsets for %s", (_name, source) => {
  const imported = importMarkdown(source, "containers.md").json;
  const codes: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "codeBlock") codes.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(imported);
  expect(codes.map((node) => node.content)).toEqual([[{ type: "text", text: code }]]);
  expect(importMarkdown(exportMarkdown(imported), "containers.md").json).toEqual(imported);
});
