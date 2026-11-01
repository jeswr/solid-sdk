// @vitest-environment jsdom
// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { Editor, generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
it.each([
  "> > Paragraph\n> >\nMy reply",
  "> > > Paragraph\n> > >\n> My reply",
  "- Parent\n\n  > > Paragraph\n  > >\n  My reply",
])("round38 nested quoted blanks close lazy paragraphs from source: %s", (source) => {
  const result = importMarkdown(source, "nested.md");
  const children = source.startsWith("-")
    ? result.json.content?.[0]?.content?.[0]?.content?.slice(1)
    : source.endsWith("> My reply")
      ? result.json.content?.[0]?.content
      : result.json.content;
  expect(children?.map((node) => node.type)).toEqual(["blockquote", "paragraph"]);
  expect(children?.[1]?.content?.[0]?.text).toBe("My reply");
  roundTrip(result.json);
});
function roundTrip(json: JSONContent) {
  const dom = new DOMParser().parseFromString(generateHTML(json, extensions), "text/html");
  expect(
    SchemaDOMParser.fromSchema(schema).parse(dom.body, { preserveWhitespace: "full" }).toJSON(),
  ).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it.each([
  "- ",
  "4. ",
  "- [ ] ",
  "> ",
  "> - ",
  "- > ",
  "- - ",
  "> > - ",
])("round38 repeated lazy underlines stay entirely literal inside %s", (prefix) => {
  for (const separator of ["==", "===", "======", "--"]) {
    const expected = `Report\n${separator}\nMore\n${separator}`;
    const result = importMarkdown(`${prefix}${expected}`, "report.md");
    expect(result.skipped).toEqual([]);
    const node = schema.nodeFromJSON(result.json);
    expect(node.textContent).toBe(expected);
    node.descendants((child) => {
      expect(child.type.name).not.toBe("heading");
      expect(child.marks).toEqual([]);
    });
    roundTrip(result.json);
  }
});

it.each([
  "- ",
  "4. ",
  "- [x] ",
  "- - ",
  "> - ",
])("round38 quoted blank lines end lazy continuation after %s", (prefix) => {
  for (const ending of ["", "\n", "\n\n> Later quotation"]) {
    const result = importMarkdown(`> ${prefix}Quoted\ncontinued\n>\nMy reply${ending}`, "reply.md");
    expect(result.skipped).toEqual([]);
    expect(result.json.content?.[0]?.type).toBe("blockquote");
    expect(schema.nodeFromJSON(result.json.content?.[0] as JSONContent).textContent).toBe(
      "Quoted\ncontinued",
    );
    expect(result.json.content?.[1]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "My reply" }],
    });
    if (ending.includes("Later")) expect(result.json.content?.[2]?.type).toBe("blockquote");
    else expect(result.json.content).toHaveLength(2);
    roundTrip(result.json);
  }
});

it.each([
  "- Report\n===\nMore\n===",
  "> - Quoted\ncontinued\n>\nMy reply",
])("round38 container regressions survive a collaborative snapshot reopen: %s", (source) => {
  const json = importMarkdown(source, "source.md").json;
  const doc = new Doc();
  const snapshot = new Doc();
  const editor = new Editor({ extensions: editorExtensions(doc, vi.fn()) });
  const reopened = new Editor({ extensions: editorExtensions(snapshot, vi.fn()) });
  try {
    editor.commands.setContent(json);
    applyUpdate(snapshot, encodeStateAsUpdate(doc));
    expect(reopened.getJSON()).toEqual(editor.getJSON());
    if (source.startsWith("-"))
      expect(schema.nodeFromJSON(reopened.getJSON()).textContent).toBe("Report\n===\nMore\n===");
    else
      expect(reopened.getJSON().content?.[1]).toMatchObject({
        type: "paragraph",
        content: [{ type: "text", text: "My reply" }],
      });
    roundTrip(reopened.getJSON());
  } finally {
    editor.destroy();
    reopened.destroy();
    doc.destroy();
    snapshot.destroy();
  }
});
