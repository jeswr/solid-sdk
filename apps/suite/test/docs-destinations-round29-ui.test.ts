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
