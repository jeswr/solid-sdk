// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { act, click, h, key, mount } from "./drive-ui-dom";

const { SlashMenu } = await import("../src/apps/docs/components/slash-menu");
const { CountPopover } = await import("../src/apps/docs/components/editor-popovers");
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(window.Range.prototype, "getClientRects", { value: () => [new DOMRect()] });
Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
  value: () => new DOMRect(),
});
afterEach(() => document.body.replaceChildren());

function editorWith(text: string) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: baseExtensions(vi.fn()),
    content: `<p>${text}</p>`,
  });
  editor.commands.setTextSelection(text.length + 1);
  return editor;
}

it("round31 cancelling the slash menu preserves the typed path as literal editor text", async () => {
  const editor = editorWith("Use /");
  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? h(SlashMenu, {
          editor,
          position: { from: 5, to: 6, left: 0, top: 0, query: "" },
          close: () => setOpen(false),
          image: vi.fn(),
        })
      : null;
  }
  const view = await mount(h(Harness));
  try {
    const input = document.querySelector('input[aria-label="Filter blocks"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "usr/local/bin",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("usr/local/bin");
    await key(input, "Escape");
    expect(editor.getText()).toBe("Use /usr/local/bin");
    expect(editor.state.selection.from).toBe("Use /usr/local/bin".length + 1);
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

it("round31 closing Word count returns keyboard focus to the editor", async () => {
  const editor = editorWith("Count me");
  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? h(CountPopover, { editor, close: () => setOpen(false), pinned: false, setPinned: vi.fn() })
      : null;
  }
  const view = await mount(h(Harness));
  try {
    await key(document.activeElement as Element, "Escape");
    await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    expect(editor.state.selection.from).toBe(9);
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

it("round31 selecting a slash command consumes its query instead of restoring it", async () => {
  const editor = editorWith("Use /");
  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? h(SlashMenu, {
          editor,
          position: { from: 5, to: 6, left: 0, top: 0, query: "Heading 1" },
          close: () => setOpen(false),
          image: vi.fn(),
        })
      : null;
  }
  const view = await mount(h(Harness));
  try {
    const item = document.querySelector('[role="option"]') as HTMLElement;
    expect(item.textContent).toBe("Heading 1");
    await click(item);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Use " }],
    });
    expect(editor.getText()).not.toContain("Heading 1");
    expect(document.querySelector('input[aria-label="Filter blocks"]')).toBeNull();
  } finally {
    await view.unmount();
    editor.destroy();
  }
});
