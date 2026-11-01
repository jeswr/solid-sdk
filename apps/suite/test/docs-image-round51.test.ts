// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ImageUpload } from "../src/apps/docs/components/image-upload";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { imageTransfer } from "../src/apps/docs/editor/image-transfer";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";

function transfer(html: string, files: File[] = [], plain = ""): DataTransfer {
  return {
    files,
    getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? plain : ""),
  } as unknown as DataTransfer;
}

function text(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

afterEach(() => vi.unstubAllGlobals());

it("round51 embedded data bytes win over the whole-fragment PNG fallback", async () => {
  const fallback = new File(["screenshot of the entire fragment"], "fallback.png", {
    type: "image/png",
  });
  const image = imageTransfer(
    transfer('<p>Before</p><img src="data:image/png;base64,cGl4ZWxz"><p>After</p>', [fallback]),
  );
  expect(image?.file).not.toBe(fallback);
  expect(image?.file.type).toBe("image/png");
  expect(await text(image?.file as File)).toBe("pixels");
  expect(image?.rich?.images).toHaveLength(1);
});

it("round51 HTML-only percent-encoded SVG bytes retain their MIME type and UTF-8 text", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>café</text></svg>';
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = imageTransfer(transfer(`<p>Before</p><img src="${source}" alt="Diagram">`));
  expect(image?.file.type).toBe("image/svg+xml");
  expect(await text(image?.file as File)).toBe(svg);
  expect(image?.rich?.images[0]?.alt).toBe("Diagram");
});

it("round51 local images match files by name and repeated sources share one upload", () => {
  const a = new File(["a"], "a.png", { type: "image/png" });
  const b = new File(["b"], "b.png", { type: "image/png" });
  const image = imageTransfer(
    transfer(
      '<img src="file:///b.png" alt="B"><img src="file:///a.png" alt="A"><img src="file:///b.png" alt="B">',
      [a, b],
    ),
  );
  expect(image?.rich?.images.map((item) => item.file)).toEqual([b, a]);
  expect(image?.rich?.images[0]?.elements).toHaveLength(2);
});

it.each([
  "data:image/png;base64,!!!",
  "data:image/png;base64",
  "data:text/html;base64,cGl4ZWxz",
  "file:///missing.png",
  "blob:https://source.test/missing",
])("round51 unreadable local image bytes report an error for %s", (source) => {
  expect(() => imageTransfer(transfer(`<p>Keep this text</p><img src="${source}">`))).toThrow();
});

it("round51 unrelated fallback files leave plain text and remote HTML to the normal paste filters", () => {
  const file = new File(["pixels"], "fallback.png", { type: "image/png" });
  expect(imageTransfer(null)).toBeUndefined();
  expect(imageTransfer(transfer("", [file], "plain text"))).toBeUndefined();
  expect(
    imageTransfer(transfer('<p>Rich text</p><img src="https://pod.test/a.png">', [file])),
  ).toBeUndefined();
  expect(imageTransfer(transfer('<img src="javascript:alert(1)">', [file]))).toBeUndefined();
  expect(imageTransfer(transfer("", [file]))).toEqual({ file });
});

it.each([
  "complete",
  "cancel",
])("round51 queued uploads retain rich content and mapped selections across retries and %s", async (action) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ClipboardEvent", Event);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(vi.fn(async () => new Response(null, { status: 404 }))),
    content: "<p>Old tail</p>",
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pending = Promise.withResolvers<Response>();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
  fetchImpl.mockImplementationOnce(() => pending.promise);
  const runtime = {
    stored: { url: "https://pod.test/docs/plan.ttl" },
    session: { fetch: fetchImpl },
  } as unknown as DocumentPersistence;
  const html =
    '<p><strong>Before</strong></p><img src="data:image/png;base64,cGl4ZWxz" alt="Chart"><p>Middle</p><img src="data:image/png;base64,cGl4ZWxz" alt="Chart"><blockquote><p>Inside</p><img src="file:///photo.png" alt="Photo"></blockquote><p><a href="javascript:alert(1)">After</a></p>';
  const image = imageTransfer(
    transfer(html, [new File(["photo"], "photo.png", { type: "image/png" })]),
  );
  const close = vi.fn();
  const submit = async () => {
    await act(async () =>
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  };
  try {
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await act(async () =>
      root.render(
        createElement(ImageUpload, {
          editor,
          runtime,
          file: image?.file as File,
          ...(image?.rich ? { transfer: image.rich } : {}),
          close,
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Image 1 of 2");
    await submit();
    expect(fetchImpl).toHaveBeenCalledOnce();
    // Another edit and a moved caret must not steal the pending paste's selection.
    editor.commands.insertContentAt(1, "New ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    await act(async () => {
      pending.resolve(new Response(null, { status: 503 }));
      await pending.promise;
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("couldn't upload");
    expect(editor.getText()).toBe("New Old tail");
    await submit();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Image 2 of 2");
    expect(document.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.value).toBe(
      "Photo",
    );
    if (action === "complete") await submit();
    else {
      await act(async () =>
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent === "Cancel")
          ?.click(),
      );
    }
    expect(close).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(action === "complete" ? 3 : 2);
    expect(editor.getText()).toContain("New Before");
    expect(editor.getText()).toContain("Middle");
    expect(editor.getText()).toContain("Inside");
    expect(editor.getText()).toContain("After tail");
    expect(editor.getText()).not.toContain("Old");
    expect(editor.getHTML()).toContain("<strong>Before</strong>");
    expect(editor.getHTML()).not.toContain("javascript:");
    const images: { src: string; alt: string }[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") images.push(node.attrs as { src: string; alt: string });
    });
    expect(images).toHaveLength(action === "complete" ? 3 : 2);
    expect(images[0]?.src).toMatch(/^https:\/\/pod.test\/docs\/plan\/assets\/.*\.png$/);
    expect(images[1]?.src).toBe(images[0]?.src);
    expect(images.map((item) => item.alt)).toEqual(
      action === "complete" ? ["Chart", "Chart", "Photo"] : ["Chart", "Chart"],
    );
    editor.state.doc.check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    editor.destroy();
  }
});
