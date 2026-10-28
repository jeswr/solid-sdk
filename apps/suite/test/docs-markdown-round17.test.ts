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

function makeEditor(doc = new Doc()) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(doc, vi.fn()),
  });
  return {
    editor,
    doc,
    destroy: () => {
      editor.destroy();
      doc.destroy();
    },
  };
}

it.each([
  "<strong> one </strong> <em> two </em>",
  "<p><strong> one </strong> <em> two </em></p>",
  "<strong> one <strong> two </strong> three </strong>",
  "<strong>&#32;one&#32;</strong>&#32;<em>&#32;two&#32;</em>",
])("preserves whitespace inside and between inline HTML elements: %s", (source) => {
  const json = importMarkdown(source, "spaces.md").json;
  const text = json.content?.[0]?.content?.map((node) => node.text).join("");
  expect(text).toBe(source.includes("three") ? " one  two  three " : " one   two ");
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
});

it("coalesces identical mark sets and escapes HTML link attributes in nested marks", () => {
  const link = {
    type: "link",
    attrs: { href: 'https://example.org/a?x=1&y="two"', title: 'A "title" & more' },
  };
  const original: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before " },
          { type: "text", text: "one ", marks: [link, { type: "bold" }] },
          { type: "text", text: "two", marks: [link, { type: "bold" }] },
          { type: "text", text: " after" },
          { type: "text", text: "." },
        ],
      },
    ],
  };
  const exported = exportMarkdown(original);
  expect(exported).toContain('title="A &#34;title&#34; &#38; more"');
  const imported = importMarkdown(exported, "attrs.md").json;
  expect(imported.content?.[0]?.content).toMatchObject([
    { text: "before " },
    { text: "one two", marks: [{ type: "link", attrs: link.attrs }, { type: "bold" }] },
    { text: " after." },
  ]);
});

it("imports empty HTML, block images and unknown HTML without losing literal text", () => {
  expect(importMarkdown("<span></span>", "empty.md").json.content?.[0]?.content).toBeUndefined();
  expect(
    importMarkdown('<span><img src="https://example.org/image.png"></span>', "image.md").json
      .content?.[0]?.type,
  ).toBe("image");
  expect(
    importMarkdown("<strong><unknown>literal</unknown></strong>", "unknown.md").json.content?.[0]
      ?.content?.[0]?.text,
  ).toBe("<strong><unknown>literal</unknown></strong>");
  expect(
    importMarkdown("<div><unknown>literal</unknown></div>", "unknown.md").json.content?.[0]
      ?.content?.[0]?.text,
  ).toBe("<div><unknown>literal</unknown></div>");
});

it("keeps text from an unfinished inline HTML element", () => {
  expect(
    importMarkdown("<strong>unfinished", "unfinished.md").json.content?.[0]?.content?.[0]?.text,
  ).toBe("unfinished");
});

it("does not emit empty Markdown delimiters for an empty marked text node", () => {
  expect(
    exportMarkdown({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "", marks: [{ type: "bold" }] }] },
      ],
    }),
  ).toBe("<span><strong></strong></span>");
});

it("preserves the space before three when overlapping bold and italic are downloaded and replaced", () => {
  const { editor, doc, destroy } = makeEditor();
  const reopened = makeEditor();
  try {
    editor.commands.setContent("<p>one two three</p>");
    editor.chain().setTextSelection({ from: 1, to: 8 }).setBold().run();
    editor.chain().setTextSelection({ from: 5, to: 14 }).setItalic().run();
    const before = editor.getJSON();
    const exported = exportMarkdown(before);
    expect(exported).toBe("<span><strong>one <em>two</em></strong><em> three</em></span>");
    editor.commands.setContent(importMarkdown(exported, "again.md").json);
    expect(editor.getText()).toBe("one two three");
    expect(editor.getJSON()).toEqual(before);
    applyUpdate(reopened.doc, encodeStateAsUpdate(doc));
    expect(yDocToProsemirrorJSON(reopened.doc, "prosemirror")).toEqual(
      yDocToProsemirrorJSON(doc, "prosemirror"),
    );
    expect(reopened.editor.getJSON()).toEqual(before);
  } finally {
    destroy();
    reopened.destroy();
  }
});

it("preserves italics on ef when bold and highlight end inside an italic run", () => {
  const { editor, doc, destroy } = makeEditor();
  const reopened = makeEditor();
  try {
    editor.commands.setContent("<p>abcdef</p>");
    editor.chain().setTextSelection({ from: 1, to: 7 }).setItalic().run();
    editor.chain().setTextSelection({ from: 1, to: 5 }).setBold().run();
    editor.chain().setTextSelection({ from: 3, to: 5 }).setHighlight().run();
    const before = editor.getJSON();
    const exported = exportMarkdown(before);
    expect(exported).toBe("<span><strong><em>ab<mark>cd</mark></em></strong><em>ef</em></span>");
    editor.commands.setContent(importMarkdown(exported, "again.md").json);
    expect(editor.getJSON()).toEqual(before);
    applyUpdate(reopened.doc, encodeStateAsUpdate(doc));
    expect(yDocToProsemirrorJSON(reopened.doc, "prosemirror")).toEqual(
      yDocToProsemirrorJSON(doc, "prosemirror"),
    );
    expect(reopened.editor.getJSON()).toEqual(before);
  } finally {
    destroy();
    reopened.destroy();
  }
});

it("round trips random overlapping ranges of every schema mark with edge spaces", () => {
  const types = Object.keys(getSchema(baseExtensions(vi.fn())).marks);
  const { editor, destroy } = makeEditor();
  const sample = fc
    .tuple(
      markdownWhitespace,
      fc.array(markdownText, {
        minLength: 3,
        maxLength: 6,
      }),
      markdownWhitespace,
    )
    .chain(([leading, words, trailing]) => {
      const text = `${leading}${words.join(" ")}${trailing}`;
      const range = fc.tuple(
        fc.integer({ min: 0, max: text.length }),
        fc.integer({ min: 0, max: text.length }),
      );
      return fc.tuple(
        fc.constant(text),
        fc.array(range, { minLength: types.length, maxLength: types.length }),
      );
    });
  try {
    fc.assert(
      fc.property(sample, ([text, ranges]) => {
        editor.commands.setContent({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        });
        ranges.forEach(([a, b], index) => {
          editor
            .chain()
            .setTextSelection({ from: Math.min(a, b) + 1, to: Math.max(a, b) + 1 })
            .setMark(
              types[index] as string,
              types[index] === "link"
                ? { href: "https://example.org/docs", rel: "noopener noreferrer nofollow" }
                : {},
            )
            .run();
        });
        const before = editor.getJSON();
        const exported = exportMarkdown(before);
        const stack: string[] = [];
        for (const tag of exported.matchAll(/<(\/?)([a-z]+)(?: [^>]*)?>/g)) {
          if (tag[1]) expect(stack.pop()).toBe(tag[2]);
          else stack.push(tag[2] as string);
        }
        expect(stack).toEqual([]);
        if (exported.startsWith("<span>")) expect(exported).not.toContain("&#32;");
        editor.commands.setContent(importMarkdown(exported, "ranges.md").json);
        expect(editor.getJSON()).toEqual(before);
      }),
      { seed: 1707, numRuns: 500 },
    );
  } finally {
    destroy();
  }
}, 60_000);
