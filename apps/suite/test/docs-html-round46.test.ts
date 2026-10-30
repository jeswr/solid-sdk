// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, generateHTML, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const source = `<ul><li><input type="checkbox" checked disabled><strong>Done</strong><ul><li><label><input type="checkbox">Nested</label></li></ul></li><li><p><input type="checkbox">Open</p></li></ul><ul><li>Plain<ul><li><input type="checkbox" checked>Child</li></ul></li></ul>`;
it.each([
  "paste",
  "html",
  "markdown",
])("round46 rendered checklist %s preserves completion and nested list types", (path) => {
  const editor = new Editor({ extensions: baseExtensions(vi.fn()), content: "<p></p>" });
  try {
    let json: JSONContent;
    if (path === "paste") {
      expect(editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent)).toBe(true);
      json = editor.getJSON();
    } else
      json = path === "html" ? importHtml(source).json : importMarkdown(source, "tasks.md").json;
    expect(json.content?.slice(0, 2)).toMatchObject([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Done", marks: [{ type: "bold" }] }],
              },
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { checked: false },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                  },
                ],
              },
            ],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Open" }] }],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Plain" }] },
              { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true } }] },
            ],
          },
        ],
      },
    ]);
  } finally {
    editor.destroy();
  }
});

it("round46 numbered rendered checklists preserve states while plain siblings become unchecked tasks", () => {
  const { json } = importHtml(
    '<ol start="3"><li><label><input type="checkbox" checked="false">Done</label></li><li>Unmarked</li><li><input type="checkbox">Open</li></ol>',
  );
  expect(json.content?.[0]).toMatchObject({
    type: "taskList",
    content: [
      { type: "taskItem", attrs: { checked: true } },
      { type: "taskItem", attrs: { checked: false } },
      { type: "taskItem", attrs: { checked: false } },
    ],
  });
  expect(JSON.stringify(json)).toContain("Unmarked");
});

it.each([
  "paste",
  "html",
  "markdown",
])("round46 editor-rendered checklist wrappers preserve content through %s", (path) => {
  const extensions = baseExtensions(vi.fn());
  const original = importHtml(source).json;
  const rendered = generateHTML(original, extensions);
  const editor = new Editor({ extensions, content: "<p></p>" });
  try {
    let json: JSONContent;
    if (path === "paste") {
      editor.view.pasteHTML(rendered, new Event("paste") as ClipboardEvent);
      json = editor.getJSON();
    } else
      json =
        path === "html" ? importHtml(rendered).json : importMarkdown(rendered, "tasks.md").json;
    expect(json.content?.slice(0, 2)).toEqual(original.content);
  } finally {
    editor.destroy();
  }
});
