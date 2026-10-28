// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Plugin } from "@tiptap/pm/state";
import { Editor, type JSONContent } from "@tiptap/react";
import fc from "fast-check";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { ImageUpload } from "../src/apps/docs/components/image-upload";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { insertionAnchor } from "../src/apps/docs/lib/editor/insertion-anchor";

afterEach(() => vi.unstubAllGlobals());

function makeEditor() {
  const doc = new Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(
      doc,
      vi.fn(async () => new Response(null, { status: 404 })),
    ),
  });
  return {
    editor,
    destroy: () => {
      editor.destroy();
      doc.destroy();
    },
  };
}

it("downloads and replaces bold text with a leading space without literal asterisks", () => {
  const { editor, destroy } = makeEditor();
  try {
    editor.commands.setContent("<p>foo cat</p>");
    editor.chain().setTextSelection({ from: 4, to: 8 }).setBold().run();
    const exported = exportMarkdown(editor.getJSON());
    editor.commands.setContent(importMarkdown(exported, "again.md").json);
    expect(editor.getText()).toBe("foo cat");
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe(" cat");
    editor.state.doc.check();
  } finally {
    destroy();
  }
});

it.each([
  ["bold", "**", "strong"],
  ["italic", "*", "em"],
  ["strike", "~~", "s"],
])("round trips %s runs with edge whitespace and punctuation", (type, _delimiter, tag) => {
  const { editor, destroy } = makeEditor();
  try {
    fc.assert(
      fc.property(
        fc.constantFrom("", "foo", "(", "!", "é", "😀"),
        fc.constantFrom("", "bar", ")", "?", "中", "😀"),
        fc.constantFrom("", " ", "  ", "\t", "\n"),
        fc.constantFrom("", " ", "  ", "\t", "\n"),
        fc.constantFrom("cat", "!cat", "cat?", "!cat?", "*cat*", "[cat]", "😀cat😀"),
        (before, after, leading, trailing, core) => {
          const original: JSONContent = {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  ...(before ? [{ type: "text", text: before }] : []),
                  { type: "text", text: `${leading}${core}${trailing}`, marks: [{ type }] },
                  ...(after ? [{ type: "text", text: after }] : []),
                ],
              },
            ],
          };
          editor.commands.setContent(importMarkdown(exportMarkdown(original), "marks.md").json);
          expect(editor.getText()).toBe(`${before}${leading}${core}${trailing}${after}`);
          expect(editor.view.dom.querySelector(tag)?.textContent).toBe(
            `${leading}${core}${trailing}`,
          );
          editor.state.doc.check();
        },
      ),
      { seed: 1607, numRuns: 300 },
    );
  } finally {
    destroy();
  }
});

it("accepts every combination of the Markdown importer's inline marks", () => {
  const { editor, destroy } = makeEditor();
  try {
    const wrappers = [
      (text: string) => `\`${text}\``,
      (text: string) => `**${text}**`,
      (text: string) => `*${text}*`,
      (text: string) => `~~${text}~~`,
      (text: string) => `==${text}==`,
      (text: string) => `[${text}](https://example.org/docs)`,
    ];
    for (let subset = 0; subset < 2 ** wrappers.length; subset++) {
      const source = wrappers.reduce(
        (text, wrap, index) => (subset & (1 << index) ? wrap(text) : text),
        "word",
      );
      editor.commands.setContent(importMarkdown(source, "marks.md").json);
      editor.state.doc.check();
      const original = editor.getJSON();
      expect(original.content?.[0]?.content?.[0]?.marks ?? []).toHaveLength(
        subset.toString(2).replaceAll("0", "").length,
      );
      editor.commands.setContent(importMarkdown(exportMarkdown(original), "again.md").json);
      editor.state.doc.check();
      expect(editor.getJSON()).toEqual(original);
    }
  } finally {
    destroy();
  }
});

it("maps the insertion anchor through appended transactions and releases the listener", () => {
  const { editor, destroy } = makeEditor();
  try {
    editor.commands.setContent("<p>Important words to keep</p>");
    editor.commands.setTextSelection(24);
    editor.registerPlugin(
      new Plugin({
        appendTransaction(transactions, _old, state) {
          return transactions.some((transaction) => transaction.getMeta("prefix"))
            ? state.tr.insertText("Added ", 1)
            : null;
        },
      }),
    );
    const anchor = insertionAnchor(editor);
    editor.view.dispatch(editor.state.tr.insertText("New ", 1).setMeta("prefix", true));
    expect(anchor.position).toBe(34);
    anchor.release();
    editor.commands.insertContentAt(1, "After release ");
    expect(anchor.position).toBe(34);
  } finally {
    destroy();
  }
});

it.each([
  "[API `fetch()`](https://example.org/docs)",
  "**`bold code`**",
  "*[italic link](https://example.org/docs)*",
  "~~`struck code`~~",
  "***~~[`all marks`](https://example.org/docs)~~***",
  "==`highlighted code`==",
  "foo[**\\]API**](https://example.org/docs)",
])("imports and round trips compatible marks through the editor: %s", (source) => {
  const { editor, destroy } = makeEditor();
  try {
    const original = importMarkdown(source, "marks.md").json;
    editor.commands.setContent(original);
    editor.state.doc.check();
    const before = editor.getJSON();
    editor.commands.setContent(importMarkdown(exportMarkdown(before), "again.md").json);
    editor.state.doc.check();
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getText()).not.toMatch(/[*~`]/);
  } finally {
    destroy();
  }
});

it.each([
  "<p><strong>first <em>middle</em> end</strong><s>strike</s></p>",
  '<p><strong>before <a href="https://example.org" rel="noopener noreferrer nofollow">link</a> after</strong></p>',
  "<p><strong><code> code </code> and <code>more</code></strong></p>",
  "<p><strong>bold<em>both</em></strong><em>italic</em></p>",
  "<p><strong>! &amp; &lt; &gt; \\ [ ] | \" '; ?</strong>end</p>",
  "<p><strong>bold</strong><br><em>italic</em></p>",
])("round trips marks spanning multiple inline nodes: %s", (html) => {
  const { editor, destroy } = makeEditor();
  try {
    editor.commands.setContent(html);
    const before = editor.getJSON();
    editor.commands.setContent(importMarkdown(exportMarkdown(before), "runs.md").json);
    editor.state.doc.check();
    expect(editor.getJSON()).toEqual(before);
  } finally {
    destroy();
  }
});

it("preserves whitespace-only mark runs and whitespace-only edge nodes using HTML", () => {
  const { editor, destroy } = makeEditor();
  try {
    const original: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: " \t ", marks: [{ type: "italic" }] },
            { type: "text", text: "  ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "cat",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.org" } }],
            },
            { type: "text", text: "  ", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    editor.commands.setContent(importMarkdown(exportMarkdown(original), "spaces.md").json);
    expect(editor.getText()).toBe(" \t   cat  ");
    expect(editor.view.dom.querySelector("em")?.textContent).toBe(" \t ");
    expect(
      Array.from(editor.view.dom.querySelectorAll("strong"), (node) => node.textContent).join(""),
    ).toBe("  cat  ");
  } finally {
    destroy();
  }
});

it.each([
  "selection",
  "insertion",
  "deletion",
  "deleted anchor",
  "deleted block",
  "initial save",
  "failed upload",
  "destroyed editor",
])("retains the upload insertion anchor across a later %s", async (change) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { editor, destroy } = makeEditor();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let finish!: (response: Response) => void;
  const put = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetchImpl = vi.fn(() => put);
  const save = Promise.withResolvers<void>();
  const stored = { url: "https://pod.test/docs/test/index.ttl" } as DocumentPersistence["stored"];
  const runtime = {
    stored: change === "initial save" ? undefined : stored,
    session: { fetch: fetchImpl },
    change: vi.fn(),
    flush: vi.fn(async () => {
      await save.promise;
      runtime.stored = stored;
    }),
  } as unknown as DocumentPersistence;
  const close = vi.fn();
  try {
    editor.commands.setContent("<p>Important words to keep</p>");
    editor.commands.setTextSelection(change === "deleted anchor" ? 20 : 24);
    await act(async () =>
      root.render(
        createElement(ImageUpload, {
          editor,
          runtime,
          file: new File(["image"], "image.png", { type: "image/png" }),
          close,
        }),
      ),
    );
    const decorative = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => decorative?.click());
    await act(async () =>
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    if (change === "initial save") expect(runtime.flush).toHaveBeenCalledOnce();
    else expect(fetchImpl).toHaveBeenCalledOnce();
    const off = vi.spyOn(editor, "off");
    if (change === "insertion") editor.commands.insertContentAt(1, "New ");
    if (change === "deletion") editor.commands.deleteRange({ from: 16, to: 24 });
    if (change === "deleted anchor") editor.commands.deleteRange({ from: 16, to: 24 });
    if (change === "deleted block") editor.commands.deleteRange({ from: 0, to: 25 });
    editor.commands.setTextSelection({ from: 1, to: 16 });
    if (change === "destroyed editor") editor.destroy();
    if (change === "initial save") {
      await act(async () => {
        save.resolve();
        await save.promise;
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
    await act(async () => {
      finish(new Response(null, { status: change === "failed upload" ? 500 : 201 }));
      await put;
    });
    expect(off).toHaveBeenCalledWith("transaction", expect.any(Function));
    if (change === "failed upload" || change === "destroyed editor") {
      expect(close).not.toHaveBeenCalled();
      if (change === "failed upload") {
        expect(editor.getText()).toBe("Important words to keep");
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("couldn't upload");
      }
      return;
    }
    expect(close).toHaveBeenCalledOnce();
    expect(editor.getText().trim()).toBe(
      change === "insertion"
        ? "New Important words to keep"
        : change === "deletion" || change === "deleted anchor"
          ? "Important words"
          : change === "deleted block"
            ? ""
            : "Important words to keep",
    );
    const blocks = editor.getJSON().content ?? [];
    if (change === "deleted block") {
      expect(blocks.filter((node) => node.type !== "paragraph")).toMatchObject([{ type: "image" }]);
    } else {
      expect(blocks[0]?.type).toBe("paragraph");
      expect(blocks[1]?.type).toBe("image");
    }
    editor.state.doc.check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    destroy();
  }
});
