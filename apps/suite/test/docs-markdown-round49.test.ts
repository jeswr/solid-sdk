// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import type { PodSession } from "../src/lib/session/pod-session";

const schema = getSchema(baseExtensions(vi.fn()));
const tasks = (json: JSONContent) => {
  const items: JSONContent[] = [];
  schema.nodeFromJSON(json).descendants((node) => {
    if (node.type.name === "taskItem") items.push(node.toJSON());
  });
  return items;
};

it.each([
  "> 5 GB free disk space",
  "# Requirement",
  "- Requirement",
  "+ Requirement",
  "* Requirement",
  "1. Requirement",
  "1) Requirement",
  "---",
  "***",
  "___",
  "```",
  "~~~",
  "[source]: https://example.org/guide",
])("round49 task markers cannot expose inline content as a new block: %s", (requirement) => {
  for (const marker of ["- [ ]", "+ [x]", "* [X]", "7. [ ]", "7) [x]"]) {
    for (const parent of ["", "> ", "> > ", "- Parent\n\n  ", "- [ ] Parent\n\n  "]) {
      const result = importMarkdown(`${parent}${marker} ${requirement}`, "tasks.md");
      const item = tasks(result.json).at(-1);
      expect(item?.attrs?.checked).toBe(!marker.includes("[ ]"));
      expect(item?.content?.map((node) => node.type)).toEqual(["paragraph"]);
      expect(schema.nodeFromJSON(item as JSONContent).textContent).toBe(requirement);
      expect(result.skipped).toEqual([]);
      expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
    }
  }
});

it.each(["", "> "])("round49 task prose keeps lazy continuations inside %j", (prefix) => {
  const result = importMarkdown(`${prefix}- [ ] > 5 GB free\ncontinued\n- Outside`, "tasks.md");
  const item = tasks(result.json)[0];
  expect(item?.content?.map((node) => node.type)).toEqual(["paragraph"]);
  expect(schema.nodeFromJSON(item as JSONContent).textContent).toBe("> 5 GB free\ncontinued");
  expect(schema.nodeFromJSON(result.json).lastChild?.type.name).toBe("bulletList");
});

it("round49 task content retains inline formatting, forward references and real continuation blocks", () => {
  const result = importMarkdown(
    "- [x] > **5 GB** and [guide][ref]\n\n  > Quoted\n\n  # Heading\n\n  ~~~\n  code\n  ~~~\n\n[ref]: https://example.org/guide",
    "tasks.md",
  );
  const item = tasks(result.json)[0];
  expect(item?.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "blockquote",
    "heading",
    "codeBlock",
  ]);
  expect(item?.content?.[0]?.content).toMatchObject([
    { type: "text", text: "> " },
    { type: "text", text: "5 GB", marks: [{ type: "bold" }] },
    { type: "text", text: " and " },
    {
      type: "text",
      text: "guide",
      marks: [{ type: "link", attrs: { href: "https://example.org/guide" } }],
    },
  ]);
  expect(result.skipped).toEqual([]);
});

it("round49 removing inline task markers preserves empty items, setext headings and table headers", () => {
  const result = importMarkdown(
    "- [ ]\n- [x] Title\n  ===\n- [ ] Head | Other\n  --- | ---\n  One | Two",
    "tasks.md",
  );
  const items = tasks(result.json);
  expect(items[0]?.content?.[0]?.content).toBeUndefined();
  expect(items[1]?.content?.[1]).toMatchObject({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: "Title" }],
  });
  expect(items[2]?.content?.[1]?.type).toBe("table");
  expect(schema.nodeFromJSON(items[2] as JSONContent).textContent).toBe("HeadOtherOneTwo");
  expect(result.skipped).toEqual([]);
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "Aligned" }] },
  { type: "paragraph", content: [{ type: "hardBreak" }, { type: "text", text: "After break" }] },
])("round49 tasks export rich initial paragraphs losslessly: %j", (paragraph) => {
  const json = schema
    .nodeFromJSON({
      type: "doc",
      content: [{ type: "taskList", content: [{ type: "taskItem", content: [paragraph] }] }],
    })
    .toJSON();
  expect(importMarkdown(exportMarkdown(json), "rich-tasks.md").json).toEqual(json);
});

it("round49 task paragraph fallbacks preserve alignment with Markdown and forward references", () => {
  const result = importMarkdown(
    '- [x] <P style="text-align: center">**Bold** [guide][ref]</P>\n\n[ref]: https://example.org/guide',
    "rich-tasks.md",
  );
  expect(tasks(result.json)[0]?.content).toMatchObject([
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        { type: "text", text: "Bold", marks: [{ type: "bold" }] },
        { type: "text", text: " " },
        { type: "text", text: "guide", marks: [{ type: "link" }] },
      ],
    },
  ]);
  expect(result.skipped).toEqual([]);
});

it("round49 checklist file conversion and editor insertion retain literal comparison signs", async () => {
  const session = { fetch: vi.fn<typeof fetch>() } as unknown as PodSession;
  const result = await convertImport(
    new NodeFile(["- [ ] > 5 GB free disk space"], "requirements.md") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  const doc = new Doc();
  const editor = new Editor({ extensions: editorExtensions(doc, session.fetch) });
  try {
    expect(result.skipped).toEqual([]);
    editor.commands.setContent(result.json);
    const item = editor.state.doc.firstChild?.firstChild;
    expect(item?.type.name).toBe("taskItem");
    expect(item?.childCount).toBe(1);
    expect(item?.firstChild?.textContent).toBe("> 5 GB free disk space");
    expect(tasks(yDocToProsemirrorJSON(doc))[0]).toEqual(item?.toJSON());
    expect(session.fetch).not.toHaveBeenCalled();
  } finally {
    editor.destroy();
    doc.destroy();
  }
});
