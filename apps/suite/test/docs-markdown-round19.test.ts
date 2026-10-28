// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const schema = getSchema(baseExtensions(vi.fn()));

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
  // StarterKit's trailingNode adds an editable paragraph after the checklist.
  expect(downloaded).toBe("- [ ] First line\\\n      Second line\n\n<p></p>");
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

it("keeps paragraph inline tokens across repeated imports before and after a task list", () => {
  const source = "Before\n\n- [ ] First\\\n      Second\n\nAfter";
  for (let run = 0; run < 3; run++) {
    const json = importMarkdown(source, "repeat.md").json;
    expect(json.content?.[0]?.content).toEqual([{ type: "text", text: "Before" }]);
    expect(json.content?.[2]?.content).toEqual([{ type: "text", text: "After" }]);
    expect(exportMarkdown(json)).toBe(source);
  }
});

it("preserves loose task continuations, nested quotes, fenced code and HTML tables", () => {
  const downloaded = replaceAndReopen((editor) => {
    editor.commands.setContent(
      '<blockquote><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>First<br>Second</p><p>Another paragraph</p><blockquote><ol start="12"><li><p>Nested<br>Continuation</p><pre><code>first\nsecond</code></pre><table><tr><td><p>One</p><p>Two</p></td></tr></table></li></ol></blockquote></li><li data-type="taskItem" data-checked="false"><p>Next task</p></li></ul></blockquote>',
    );
  });
  expect(downloaded).toContain("> - [x] First\\\n>       Second\n>\n>       Another paragraph");
  expect(downloaded).toContain(">       >     second");
  expect(downloaded).toContain(">       >     <table>");
  expect(downloaded).not.toMatch(/ +$/m);
});

it("keeps ordered numbering when splitting mixed task and ordinary items", () => {
  const json = importMarkdown("7. Seven\n8. [x] Done\n9. Nine", "mixed.md").json;
  expect(json.content?.map((node) => node.type)).toEqual([
    "orderedList",
    "taskList",
    "orderedList",
  ]);
  expect(json.content?.[2]?.attrs?.start).toBe(9);
  expect(json.content?.[1]?.content?.[0]?.attrs?.checked).toBe(true);
});

it("preserves tabs in code blocks inside list and quote containers", () => {
  const original = schema
    .nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Code" }] },
                {
                  type: "blockquote",
                  content: [
                    { type: "codeBlock", content: [{ type: "text", text: "one\n two\t \nthree" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    .toJSON();
  expect(importMarkdown(exportMarkdown(original), "code.md").json).toEqual(original);
});

it.each([
  "- [ ] ",
  "- ```\n  code\n  ```",
])("imports list items with required initial paragraphs: %j", (source) => {
  const json = importMarkdown(source, "list.md").json;
  const item = json.content?.[0]?.content?.[0];
  expect(item?.content?.[0]?.type).toBe("paragraph");
  schema.nodeFromJSON(json).check();
});

it.each([
  ["title: Plan", "Plan"],
  ['title: "Quoted plan"', "Quoted plan"],
  ["title: 'It''s a plan'", "It's a plan"],
  ['title: "A # plan" # comment', "A # plan"],
  ["# metadata\n\ntitle: Plan # comment\nother: x", "Plan"],
  ["title:\nother: true", "file"],
  ['title: ""', "file"],
  ["title: 42", "file"],
  ["title: false", "file"],
  ['title: ["a", "b"]', "file"],
  ['title: {"nested": "value"}', "file"],
])("recognizes validated front matter and scalar titles: %s", (metadata, title) => {
  for (const close of ["---", "..."]) {
    for (const newline of ["\n", "\r\n"]) {
      const source = ["---", ...metadata.split("\n"), close, "# Body"].join(newline);
      const imported = importMarkdown(source, "file.md");
      expect(imported.title).toBe(title);
      expect(imported.json.content?.map((node) => node.type)).toEqual(["heading"]);
      expect(imported.json.content?.[0]?.content?.[0]?.text).toBe("Body");
    }
  }
});

it.each([
  "Keep this section",
  "- sequence",
  '"scalar"',
  "true",
  "42",
  "",
  "# comment only",
  "title: [unfinished",
  'title: "unclosed',
  "title: 'unclosed",
  "title: one\ntitle: two",
  "title: bad: mapping",
  'title: "bad\\qescape"',
  "title: bad:",
  "title: |\n  block scalar",
  "title: &anchor value",
  "title: *alias",
  "nested:\n  title: Nested",
])("leaves non-mapping, invalid or unsupported YAML visible: %j", (metadata) => {
  const imported = importMarkdown(`---\n${metadata}\n---\n\n# Body`, "file.md");
  expect(imported.title).toBe("file");
  expect(imported.json.content?.[0]?.type).toBe("horizontalRule");
  expect(imported.json.content?.length).toBeGreaterThan(1);
});

it.each([
  " ---\ntitle: Plan\n---\n# Body",
  "--- \ntitle: Plan\n---\n# Body",
  "\n---\ntitle: Plan\n---\n# Body",
  "---\ntitle: Plan\n--- extra\n# Body",
  "---\ntitle: Plan",
])("requires exact opening and closing front matter delimiters: %j", (source) => {
  expect(importMarkdown(source, "file.md").title).toBe("file");
});

it("recognizes a front matter closing delimiter at EOF", () => {
  const imported = importMarkdown("---\ntitle: Plan\n...", "file.md");
  expect(imported.title).toBe("Plan");
  expect(imported.json.content?.map((node) => node.type)).toEqual(["paragraph"]);
});

it.each(["", " \n"])("imports empty Markdown into an editable paragraph: %j", (source) => {
  expect(importMarkdown(source, "empty.md").json.content).toEqual([
    { type: "paragraph", attrs: { textAlign: null } },
  ]);
});
