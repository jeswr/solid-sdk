// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { act, click, h, mount } from "./drive-ui-dom";

const { LinkPopover } = await import("../src/apps/docs/components/editor-popovers");

it("round29 link popover opens and applies a normalized destination without doubling escapes", async () => {
  const raw = "https://files.example.org/合同 signed%20copy.pdf";
  const encoded = "https://files.example.org/%E5%90%88%E5%90%8C%20signed%20copy.pdf";
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(vi.fn()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "contract", marks: [{ type: "link", attrs: { href: raw } }] },
          ],
        },
      ],
    },
  });
  editor.commands.setTextSelection({ from: 1, to: 9 });
  const close = vi.fn();
  const view = await mount(h(LinkPopover, { editor, close }));
  try {
    const form = document.querySelector("form.docs-form") as HTMLFormElement;
    const input = form.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe(raw);
    // Browser URL input validation would reject spaces before our submit handler.
    expect(input.type).toBe("text");
    const open = Array.from(form.querySelectorAll("button")).find(
      (button) => button.textContent === "Open link",
    ) as HTMLButtonElement;
    await click(open);
    expect(form.querySelector("a")?.getAttribute("href")).toBe(encoded);
    expect(form.textContent).toContain("Open files.example.org?");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(editor.getAttributes("link").href).toBe(encoded);
    expect(editor.getHTML()).toContain(`href="${encoded}"`);
    expect(close).toHaveBeenCalled();
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

it("round34 image links can be inspected, edited and removed with the existing link popover", async () => {
  const editor = new Editor({
    extensions: baseExtensions(vi.fn(async () => new Response(null, { status: 404 }))),
    content: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://pod.test/badge.png",
            alt: "Build status",
            link: { href: "https://example.org/actions" },
          },
        },
      ],
    },
  });
  editor.commands.setNodeSelection(0);
  let view = await mount(h(LinkPopover, { editor, close: vi.fn() }));
  try {
    const input = document.querySelector('input[inputmode="url"]') as HTMLInputElement;
    expect(input.value).toBe("https://example.org/actions");
    expect(editor.getHTML()).toContain('href="https://example.org/actions"');
    const anchor = editor.view.dom.querySelector("a") as HTMLAnchorElement;
    expect(anchor.querySelector("img")?.alt).toContain("Build status");
    expect(anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
      false,
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "https://example.org/new-actions",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (document.querySelector("form.docs-form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(editor.getAttributes("image").link.href).toBe("https://example.org/new-actions");
    await view.unmount();
    view = await mount(h(LinkPopover, { editor, close: vi.fn() }));
    const remove = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove link",
    ) as HTMLButtonElement;
    await click(remove);
    expect(editor.getAttributes("image").link).toBeNull();
    expect(editor.getHTML()).not.toContain("<a");
  } finally {
    await view.unmount();
    editor.destroy();
  }
});
