// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

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
    editor.commands.setContent(importMarkdown(downloaded, "round19.md").json);
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

it("round19 preserves an opening thematic-break section through Markdown replace and snapshot reopen", () => {
  const downloaded = replaceAndReopen((editor) => {
    editor.commands.setContent("<hr><p>Keep this section</p><hr><p>Final section</p>");
  });
  expect(downloaded).toBe("***\n\nKeep this section\n\n***\n\nFinal section");
});

it("round19 preserves a checklist Shift+Enter through Markdown replace and snapshot reopen", () => {
  const downloaded = replaceAndReopen((editor) => {
    editor.commands.setContent("<p>First line</p>");
    editor.commands.toggleTaskList();
    editor.commands.setTextSelection(13);
    editor.commands.setHardBreak();
    editor.commands.insertContent("Second line");
    const json: JSONContent = editor.getJSON();
    expect(json.content?.[0]?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: "text", text: "First line" },
      { type: "hardBreak" },
      { type: "text", text: "Second line" },
    ]);
  });
  expect(downloaded).toBe("- [ ] First line\\\n      Second line");
  expect(downloaded).not.toMatch(/ +$/m);
});

it("keeps a leading thematic-break section when its content is not a YAML mapping", () => {
  const parsed = importMarkdown("---\n\nKeep this section\n\n---\n\nFinal section", "rules.md");
  expect(parsed.json.content?.map((node) => node.type)).toEqual([
    "horizontalRule",
    "paragraph",
    "horizontalRule",
    "paragraph",
  ]);
  expect(parsed.json.content?.[1]?.content?.[0]?.text).toBe("Keep this section");
});
