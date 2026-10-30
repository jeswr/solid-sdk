// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);

it.each(
  ["paste", "html", "markdown"].flatMap((path) => [false, true].map((task) => ({ path, task }))),
)("round47 list div boundaries survive $path without merging paragraphs (task: $task)", ({
  path,
  task,
}) => {
  const editor = new Editor({ extensions, content: "<p></p>" });
  try {
    const check = task ? '<input type="checkbox" checked>' : "";
    for (const body of [
      "<div>First paragraph</div><div>Second paragraph</div>",
      "<div><div>First paragraph</div><div>Second paragraph</div></div>",
      "<div>First paragraph<p>Second paragraph</p></div>",
      "<div><p>First paragraph</p>Second paragraph</div>",
      "<div><p>First paragraph</p><p>Second paragraph</p></div>",
      "<div>First <strong>paragraph</strong></div><div>Second paragraph</div>",
      "<div>\n<p>First paragraph</p>\n<p>Second paragraph</p>\n</div>",
    ]) {
      const source = `<ul><li>${check}${body}</li></ul>`;
      let json: JSONContent;
      if (path === "paste") {
        editor.commands.setContent("<p></p>");
        expect(editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent)).toBe(true);
        json = editor.getJSON();
      } else
        json = path === "html" ? importHtml(source).json : importMarkdown(source, "list.md").json;
      const list = json.content?.[0];
      expect(list?.type).toBe(check ? "taskList" : "bulletList");
      const item = list?.content?.[0];
      expect(item?.content?.map((node) => schema.nodeFromJSON(node).textContent)).toEqual([
        "First paragraph",
        "Second paragraph",
      ]);
      if (check) expect(item?.attrs?.checked).toBe(true);
    }
  } finally {
    editor.destroy();
  }
});

it.each([
  ["[outer [inner](https://a.test)](https://b.test)", "[outer inner](https://b.test)"],
  ["[outer *[inner](https://a.test)*](https://b.test)", "[outer inner](https://b.test)"],
  ["[outer [inner][a]](https://b.test)", "[outer inner](https://b.test)"],
  ["[outer [inner](https://a.test)][b]", "[outer inner]b"],
  ["[outer [inner][a]][b]", "[outer inner]b"],
  ["[outer <https://a.test>](https://b.test)", "[outer https://a.test](https://b.test)"],
  ["[outer [inner](https://a.test)][]", "[outer inner][]"],
  ["[outer [inner](https://a.test)]", "[outer inner]"],
])("round47 nested links retain outer literal syntax: %s", (source, text) => {
  const definitions = "\n\n[a]: https://a.test\n[b]: https://b.test";
  const result = importMarkdown(source + definitions, "links.md");
  expect(result.skipped).toEqual([]);
  expect(schema.nodeFromJSON(result.json).textContent).toBe(text);
  const linked: JSONContent[] = [];
  function visit(node: JSONContent) {
    if (node.marks?.some((mark) => mark.type === "link")) linked.push(node);
    node.content?.forEach(visit);
  }
  visit(result.json);
  // The suffix may independently contain a GFM URL or shortcut reference.
  // It must never absorb the outer label or replace the inner destination.
  expect(result.json.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "[outer " });
  expect(linked[0]?.text).toBe(source.includes("<https:") ? "https://a.test" : "inner");
  expect(linked[0]?.marks).toContainEqual(
    expect.objectContaining({
      type: "link",
      attrs: expect.objectContaining({ href: "https://a.test" }),
    }),
  );

  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  "[outer ![image](https://img.test/a.png)](https://b.test)",
  "[outer `literal [inner](https://a.test)`](https://b.test)",
  "[outer \\[inner\\](https://a.test)](https://b.test)",
])("round47 image labels and literal brackets do not invalidate a link: %s", (source) => {
  const result = importMarkdown(source, "allowed.md");
  expect(result.skipped).toEqual([]);
  expect(result.json.content?.[0]?.content?.[0]?.marks).toContainEqual(
    expect.objectContaining({
      type: "link",
      attrs: expect.objectContaining({ href: "https://b.test" }),
    }),
  );
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  "paste",
  "html",
  "markdown",
])("round47 empty list divs remain paragraphs through %s", (path) => {
  const source = '<ul><li><input type="checkbox"><div></div><div> </div><div>Text</div></li></ul>';
  const editor = new Editor({ extensions, content: "<p></p>" });
  try {
    let json: JSONContent;
    if (path === "paste") {
      editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent);
      json = editor.getJSON();
    } else
      json = path === "html" ? importHtml(source).json : importMarkdown(source, "empty.md").json;
    expect(
      json.content?.[0]?.content?.[0]?.content?.map(
        (node) => schema.nodeFromJSON(node).textContent,
      ),
    ).toEqual(["", "", "Text"]);
  } finally {
    editor.destroy();
  }
});
