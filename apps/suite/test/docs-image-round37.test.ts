// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

afterEach(() => vi.unstubAllGlobals());

it("round37 image presentation and link edits retain loaded bytes offline until src changes", async () => {
  const createObjectURL = vi.fn(() => "blob:loaded-image");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  let online = true;
  const fetchImage = vi.fn<typeof fetch>(async () => {
    if (!online) throw new Error("Offline");
    return new Response("pixels", { headers: { "content-type": "image/png" } });
  });
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(fetchImage),
    content: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://pod.test/image.png", alt: "Original" } }],
    },
  });
  try {
    const image = editor.view.dom.querySelector("img") as HTMLImageElement;
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("blob:loaded-image"));
    editor.commands.setNodeSelection(0);
    fetchImage.mockClear();
    revokeObjectURL.mockClear();
    online = false;
    for (const attributes of [
      { width: 320 },
      { alt: "Updated", title: "Caption", height: 120 },
      { link: { href: "https://example.org/first", title: "First" } },
      { link: { href: "https://example.org/second" } },
      { link: null, width: null, height: null, title: null },
    ]) {
      editor.commands.updateAttributes("image", attributes);
      expect(editor.view.dom.querySelector("img")).toBe(image);
      expect(image.getAttribute("src")).toBe("blob:loaded-image");
      expect(fetchImage).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      if (attributes.width) expect(image.style.width).toBe("320px");
      if (attributes.height) expect(image.getAttribute("height")).toBe("120");
      if (attributes.title) expect(image.title).toBe("Caption");
      if (attributes.link) {
        const anchor = image.parentElement as HTMLAnchorElement;
        expect(anchor.href).toBe(attributes.link.href);
        expect(anchor.getAttribute("title")).toBe(attributes.link.title ?? null);
        expect(anchor.dispatchEvent(new MouseEvent("click", { cancelable: true }))).toBe(false);
      }
    }
    expect(image.alt).toBe("Updated");
    expect(image.style.width).toBe("100%");
    expect(image.hasAttribute("height")).toBe(false);
    expect(image.hasAttribute("title")).toBe(false);
    expect(image.closest("a")).toBeNull();
    editor.commands.updateAttributes("image", { src: "https://pod.test/other.png" });
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledOnce());
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:loaded-image");
    await vi.waitFor(() =>
      expect(editor.view.dom.querySelector("img")?.dataset.docsImageState).toBe("error"),
    );
  } finally {
    editor.destroy();
  }
});

it("round37 pending image edits retain the request and use the latest alt text on failure", async () => {
  let fail!: (error: Error) => void;
  const response = new Promise<Response>((_resolve, reject) => {
    fail = reject;
  });
  const fetchImage = vi.fn(() => response);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(fetchImage),
    content: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://pod.test/pending.png", alt: "Old" } }],
    },
  });
  try {
    const image = editor.view.dom.querySelector("img") as HTMLImageElement;
    const count = fetchImage.mock.calls.length;
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes("image", { alt: "New", width: 320 });
    expect(editor.view.dom.querySelector("img")).toBe(image);
    expect(fetchImage).toHaveBeenCalledTimes(count);
    fail(new Error("Offline"));
    await vi.waitFor(() => expect(image.alt).toBe("Image unavailable: New"));
    editor.commands.updateAttributes("image", { alt: null });
    expect(image.alt).toBe("Image unavailable");
    expect(fetchImage).toHaveBeenCalledTimes(count);
  } finally {
    editor.destroy();
  }
});
