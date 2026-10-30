// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { Editor } from "@tiptap/react";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FindBar } from "../src/apps/docs/components/find-bar";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
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

async function fixture(editable = true) {
  const host = document.createElement("div");
  const element = document.createElement("div");
  document.body.append(host, element);
  const editor = new Editor({
    element,
    extensions: baseExtensions(vi.fn()),
    content: `<p>${"Earlier paragraph. ".repeat(200)}</p><p>Needle needle</p>`,
    editable,
  });
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

it("round49 Find keeps query, case, navigation and document revisions on the selected match", async () => {
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
    expect(editor.state.selection.from).toBe(first + 12);
    expect(scroll).toHaveBeenCalled();
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
