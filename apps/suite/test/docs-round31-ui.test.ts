// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { act, click, h, key, mount } from "./drive-ui-dom";

const { SlashMenu } = await import("../src/apps/docs/components/slash-menu");
const { CountPopover } = await import("../src/apps/docs/components/editor-popovers");
const { LinkPopover } = await import("../src/apps/docs/components/editor-popovers");
const { ImageUpload } = await import("../src/apps/docs/components/image-upload");
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(window.Range.prototype, "getClientRects", { value: () => [new DOMRect()] });
Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
  value: () => new DOMRect(),
});
afterEach(() => document.body.replaceChildren());

it("round37 the slash insertion dialog has its own accessible name", async () => {
  const editor = editorWith("/");
  const view = await mount(
    h(SlashMenu, {
      editor,
      position: { from: 1, to: 2, left: 0, top: 0, query: "" },
      close: vi.fn(),
      image: vi.fn(),
    }),
  );
  try {
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Insert a block",
    );
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

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

it.each(
  ["count", "link", "image", "slash"].flatMap((kind) =>
    ["pointer", "focus", "Escape"].map((dismissal) => ({ kind, dismissal })),
  ),
)("round32 $dismissal dismissal of $kind preserves the intended typing focus", async ({
  kind,
  dismissal,
}) => {
  const editor = editorWith("Count me");
  function Harness() {
    const [open, setOpen] = useState(true);
    const close = () => setOpen(false);
    const popover =
      kind === "count"
        ? h(CountPopover, { editor, close, pinned: false, setPinned: vi.fn() })
        : kind === "link"
          ? h(LinkPopover, { editor, close })
          : kind === "image"
            ? h(ImageUpload, { editor, close, file: null, runtime: {} as never })
            : h(SlashMenu, {
                editor,
                close,
                image: vi.fn(),
                position: { from: 9, to: 9, left: 0, top: 0, query: "" },
              });
    return h(
      "div",
      null,
      h("input", { "aria-label": "Document title", defaultValue: "Old title" }),
      open ? popover : null,
    );
  }
  const view = await mount(h(Harness));
  vi.useFakeTimers();
  try {
    const title = document.querySelector('input[aria-label="Document title"]') as HTMLInputElement;
    if (dismissal === "Escape") {
      await key(document.activeElement as Element, "Escape");
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(editor.view.dom);
      return;
    }
    await act(async () => {
      if (dismissal === "pointer")
        title.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      title.focus();
      if (dismissal === "pointer") title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(title);
    const focused = document.activeElement as HTMLInputElement;
    focused.value = "New title";
    expect(title.value).toBe("New title");
    expect(editor.getText()).not.toContain("New title");
  } finally {
    vi.useRealTimers();
    await view.unmount();
    editor.destroy();
  }
});
