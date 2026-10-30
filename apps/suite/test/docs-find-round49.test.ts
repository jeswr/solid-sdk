// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { Editor } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { FindBar } from "../src/apps/docs/components/find-bar";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { findKey } from "../src/apps/docs/editor/find-plugin";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window.Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(
  editable = true,
  content = `<p>${"Earlier paragraph. ".repeat(200)}</p><p>Needle needle</p>`,
  doc?: Doc,
) {
  const host = document.createElement("div");
  const element = document.createElement("div");
  document.body.append(host, element);
  const editor = new Editor({
    element,
    extensions: doc ? editorExtensions(doc, vi.fn()) : baseExtensions(vi.fn()),
    content: doc ? "" : content,
    editable,
  });
  if (doc) {
    editor.commands.setContent(content);
    editor.commands.setTextSelection(1);
  }
  const root = createRoot(host);
  const scroll = vi.fn(() => true);
  editor.on("transaction", ({ transaction }) => {
    if (transaction.scrolledIntoView) scroll();
  });
  let revision = 0;
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? createElement(FindBar, { editor, revision, close: () => setOpen(false) }) : null;
  }
  const render = () =>
    act(async () => root.render(createElement(TooltipProvider, null, createElement(Harness))));
  await render();
  const input = host.querySelector<HTMLInputElement>(
    "input:not([type=checkbox])",
  ) as HTMLInputElement;
  return {
    editor,
    host,
    input,
    scroll,
    async query(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    async refresh() {
      revision++;
      await render();
    },
    async destroy() {
      await act(async () => root.unmount());
      editor.destroy();
      host.remove();
      element.remove();
    },
  };
}

it.each([
  true,
  false,
])("round49 Find selects and scrolls to its initial match without taking input focus (editable=%s)", async (editable) => {
  const view = await fixture(editable);
  try {
    const { editor, input, host, scroll } = view;
    expect(editor.state.selection.from).toBe(1);
    await view.query("Needle needle");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 1");
    expect(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
    ).toBe("Needle needle");
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    const match = editor.state.selection;
    await act(async () => editor.commands.setTextSelection(1));
    scroll.mockClear();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')?.click(),
    );
    expect(editor.state.selection.eq(match)).toBe(true);
    expect(scroll).toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    expect(editor.state.selection.eq(match)).toBe(true);
    expect(findKey.getState(editor.state)?.query).toBe("");
  } finally {
    await view.destroy();
  }
});

it.each([
  {
    content: "<p>Original</p><p>Needle remains</p>",
    query: "Needle",
    expected: "HiOriginalNeedle remains",
  },
  { content: "<p>Start cat end</p>", query: "cat", expected: "HiStart cat end" },
])("round50 Find preserves the typing caret when $query moves after an edit", async ({
  content,
  query,
  expected,
}) => {
  const doc = new Doc();
  const replayed = new Doc();
  const view = await fixture(true, content, doc);
  try {
    await view.query(query);
    await act(async () => view.editor.commands.setTextSelection(1));
    view.scroll.mockClear();
    for (const character of "Hi") {
      await act(async () => view.editor.commands.insertContent(character));
      await view.refresh();
    }
    expect(view.editor.state.doc.textContent).toBe(expected);
    expect(view.editor.state.selection.from).toBe(3);
    expect(view.editor.state.selection.empty).toBe(true);
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe("1 of 1");
    expect(view.editor.view.dom.querySelector(".docs-find-active")?.textContent).toBe(query);
    expect(view.scroll).not.toHaveBeenCalled();
    applyUpdate(replayed, encodeStateAsUpdate(doc));
    expect(view.editor.schema.nodeFromJSON(yDocToProsemirrorJSON(replayed)).toJSON()).toEqual(
      view.editor.getJSON(),
    );
    const snapshot = new Editor({
      extensions: baseExtensions(vi.fn()),
      content: view.editor.getHTML(),
    });
    try {
      expect(snapshot.state.doc.textContent).toBe(expected);
    } finally {
      snapshot.destroy();
    }
  } finally {
    await view.destroy();
    doc.destroy();
    replayed.destroy();
  }
});

it("round50 Find never selects matches created by edits or a clamped active index", async () => {
  const view = await fixture(true, "<p>cat cat</p>");
  try {
    await view.query("cat");
    await act(async () =>
      view.host.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')?.click(),
    );
    await act(async () => view.editor.commands.insertContent("dog"));
    const caret = view.editor.state.selection;
    await view.refresh();
    expect(view.editor.state.selection.eq(caret)).toBe(true);
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe("1 of 1");
    expect(view.editor.view.dom.querySelector(".docs-find-active")?.textContent).toBe("cat");
    await view.query("missing");
    await act(async () => view.editor.commands.insertContent("missing"));
    const newCaret = view.editor.state.selection;
    await view.refresh();
    expect(view.editor.state.selection.eq(newCaret)).toBe(true);
    expect(newCaret.empty).toBe(true);
    expect(view.editor.view.dom.querySelector(".docs-find-active")?.textContent).toBe("missing");
  } finally {
    await view.destroy();
  }
});

it("round49 Find selects for query, case and navigation while revisions only refresh highlights", async () => {
  const view = await fixture();
  try {
    const { editor, host, scroll } = view;
    await view.query("needle");
    const first = editor.state.selection.from;
    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next match"]');
    const previous = host.querySelector<HTMLButtonElement>('button[aria-label="Previous match"]');
    await act(async () => next?.click());
    expect(editor.state.selection.from).toBe(first + 7);
    await act(async () => previous?.click());
    expect(editor.state.selection.from).toBe(first);
    await act(async () => previous?.click());
    expect(editor.state.selection.from).toBe(first + 7);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 1");
    expect(editor.state.selection.from).toBe(first + 7);
    scroll.mockClear();
    await view.refresh();
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => editor.commands.insertContentAt(1, "More "));
    await view.refresh();
    expect(editor.state.selection.from).toBe(6);
    expect(scroll).not.toHaveBeenCalled();
    await view.query("missing");
    const unmatched = editor.state.selection;
    expect(host.querySelector('[role="status"]')?.textContent).toBe("0 of 0");
    scroll.mockClear();
    await act(async () => next?.click());
    expect(editor.state.selection.eq(unmatched)).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
    await view.query("");
    expect(editor.state.selection.eq(unmatched)).toBe(true);
  } finally {
    await view.destroy();
  }
});
