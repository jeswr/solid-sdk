// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

afterEach(() => vi.unstubAllGlobals());

it.each([
  "HTML",
  "snapshot",
  "paste",
])("round39 mixed-case image URLs load through the %s entry point", async (path) => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:logo");
      static revokeObjectURL = vi.fn();
    },
  );
  const fetchImage = vi.fn<typeof fetch>(
    async () => new Response("pixels", { headers: { "content-type": "image/png" } }),
  );
  const html = '<img src="HTTPS://pod.test/logo.png" alt="Logo">';
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(fetchImage),
    content:
      path === "HTML"
        ? html
        : path === "snapshot"
          ? {
              type: "doc",
              content: [
                { type: "image", attrs: { src: "HTTPS://pod.test/logo.png", alt: "Logo" } },
              ],
            }
          : "",
  });
  try {
    if (path === "paste") editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    expect(fetchImage).toHaveBeenCalledWith("https://pod.test/logo.png", {
      signal: expect.any(AbortSignal),
      redirect: "error",
    });
    await vi.waitFor(() =>
      expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe("blob:logo"),
    );
    expect(editor.view.dom.querySelector("img")?.alt).toBe("Logo");
  } finally {
    editor.destroy();
  }
});
