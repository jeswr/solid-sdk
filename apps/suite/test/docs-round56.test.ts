// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Plugin } from "@tiptap/pm/state";
import { Editor, type JSONContent } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ImageUpload } from "../src/apps/docs/components/image-upload";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { imageTransfer } from "../src/apps/docs/editor/image-transfer";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

afterEach(() => vi.unstubAllGlobals());

it.each([
  "paste",
  "html",
  "markdown",
])("round56 mixed rendered lists preserve ordinary items and numbering through %s", (path) => {
  const editor = new Editor({ extensions: baseExtensions(vi.fn()), content: "<p></p>" });
  const source =
    '<ol start="7"><li>Prepare</li><li><label><input type="checkbox" checked><strong>Review</strong></label></li><li>Ship</li><li>Celebrate</li><li><input type="checkbox">Archive</li></ol><ul><li>Plain<ul><li>Nested plain</li><li><input type="checkbox" checked>Nested task</li><li>Nested end</li></ul></li><li><input type="checkbox">Open</li><li>End</li></ul>';
  try {
    let json: JSONContent;
    if (path === "paste") {
      expect(editor.view.pasteHTML(source, new Event("paste") as ClipboardEvent)).toBe(true);
      json = editor.getJSON();
    } else
      json = path === "html" ? importHtml(source).json : importMarkdown(source, "mixed.md").json;
    expect(json.content?.slice(0, 7)).toMatchObject([
      { type: "orderedList", attrs: { start: 7 }, content: [{ type: "listItem" }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true } }],
      },
      {
        type: "orderedList",
        attrs: { start: 9 },
        content: [{ type: "listItem" }, { type: "listItem" }],
      },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false } }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ text: "Plain" }] },
              { type: "bulletList", content: [{ type: "listItem" }] },
              { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true } }] },
              { type: "bulletList", content: [{ type: "listItem" }] },
            ],
          },
        ],
      },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false } }] },
      { type: "bulletList", content: [{ type: "listItem" }] },
    ]);
    editor.commands.setContent(json);
    editor.state.doc.check();
    const saved = editor.getJSON();
    editor.commands.setContent(importMarkdown(exportMarkdown(saved), "again.md").json);
    expect(editor.getJSON()).toEqual(saved);
    expect(editor.getHTML()).toContain("<strong>Review</strong>");
  } finally {
    editor.destroy();
  }
});

it.each([
  "image",
  "text",
  "blocks",
])("round56 plain clipboard images replace the mapped %s selection across alt entry and retry", async (selection) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(vi.fn(async () => new Response(null, { status: 404 }))),
    content:
      selection === "text"
        ? "<p>Before Old tail</p>"
        : '<p>Before</p><img src="https://pod.test/old.png" alt="Old"><p>Tail</p>',
  });
  if (selection === "image") editor.commands.setNodeSelection(8);
  else if (selection === "text") editor.commands.setTextSelection({ from: 8, to: 11 });
  else editor.commands.setTextSelection({ from: 7, to: 10 });
  editor.registerPlugin(
    new Plugin({
      appendTransaction(transactions, _old, state) {
        return transactions.some((transaction) => transaction.getMeta("prefix"))
          ? state.tr.insertText("Also ", 1)
          : null;
      },
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pending = Promise.withResolvers<Response>();
  const fetchImpl = vi
    .fn<typeof fetch>(async () => new Response(null, { status: 201 }))
    .mockImplementationOnce(() => pending.promise);
  const runtime = {
    stored: { url: "https://pod.test/docs/plan.ttl" },
    session: { fetch: fetchImpl },
  } as unknown as DocumentPersistence;
  const file = new File(["pixels"], "screenshot.png", { type: "image/png" });
  const image = imageTransfer({
    files: [file],
    getData: () => "",
  } as unknown as DataTransfer);
  expect(image).toEqual({ file });
  const close = vi.fn();
  const submit = async () => {
    await act(async () =>
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  };
  try {
    await act(async () =>
      root.render(createElement(ImageUpload, { editor, runtime, file, close })),
    );
    // Edits while entering alt text and during the PUT must map the same selection.
    editor.commands.insertContentAt(1, "New ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const input = document.querySelector<HTMLInputElement>('input:not([type="checkbox"])');
    if (!input) throw new Error("Missing alt text input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Screenshot",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(fetchImpl).toHaveBeenCalledOnce();
    editor.view.dispatch(editor.state.tr.insertText("Added ", 1).setMeta("prefix", true));
    editor.commands.setTextSelection(1);
    await act(async () => {
      pending.resolve(new Response(null, { status: 503 }));
      await pending.promise;
    });
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("couldn't upload");
    await submit();
    expect(close).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const images: JSONContent[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") images.push(node.toJSON());
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs).toMatchObject({ alt: "Screenshot" });
    expect(images[0]?.attrs?.src).toMatch(/^https:\/\/pod.test\/docs\/plan\/assets\/.*\.png$/);
    expect(editor.state.doc.textContent).toBe(
      selection === "text" ? "Also Added New Before  tail" : "Also Added New BeforeTail",
    );
    editor.state.doc.check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    editor.destroy();
  }
});
