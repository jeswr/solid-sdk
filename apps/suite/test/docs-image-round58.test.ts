// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { ImageUpload } from "../src/apps/docs/components/image-upload";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { imageTransfer } from "../src/apps/docs/editor/image-transfer";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";

// jsdom has no layout; retain real editor focus/selection behavior with inert geometry.
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(Range.prototype, "getClientRects", { value: () => [new DOMRect()] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => new DOMRect() });

afterEach(() => vi.unstubAllGlobals());

it.each(
  ["toolbar", "clipboard", "rich clipboard"].flatMap((origin) =>
    [false, true].flatMap((collaboration) =>
      ["PUT", "draft save"].map((pending) => ({ origin, collaboration, pending })),
    ),
  ),
)("round58 $origin completion during $pending preserves body typing (collaboration=$collaboration)", async ({
  origin,
  collaboration,
  pending,
}) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ClipboardEvent", Event);
  const element = document.createElement("div");
  document.body.append(element);
  const doc = new Doc();
  const readImage = vi.fn(async () => new Response(null, { status: 404 }));
  const editor = new Editor({
    element,
    extensions: collaboration ? editorExtensions(doc, readImage) : baseExtensions(readImage),
  });
  editor.commands.setContent("<p>Body text</p><p>Last paragraph</p>");
  editor.commands.setTextSelection(5);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const gate = Promise.withResolvers<void>();
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (pending === "PUT") await gate.promise;
    return new Response(null, { status: 201 });
  });
  const stored = { url: "https://pod.test/docs/plan.ttl" };
  const runtime = {
    stored: pending === "PUT" ? stored : null,
    session: { fetch: fetchImpl },
    change: vi.fn(),
    flush: vi.fn(async () => {
      await gate.promise;
      runtime.stored = stored;
    }),
  };
  const file = new File(["pixels"], "chart.png", { type: "image/png" });
  const image = imageTransfer({
    files: [file],
    getData: (type: string) =>
      type === "text/html" && origin === "rich clipboard"
        ? '<p>Before</p><img src="file:///chart.png" alt="Chart"><p>After</p>'
        : "",
  } as unknown as DataTransfer);
  function Harness() {
    const [open, setOpen] = useState(true);
    return h(
      "div",
      null,
      h("input", { "aria-label": "Document title", defaultValue: "Title" }),
      open
        ? h(ImageUpload, {
            editor,
            runtime: runtime as unknown as DocumentPersistence,
            file: origin === "toolbar" ? file : (image?.file as File),
            ...(image?.rich ? { transfer: image.rich } : {}),
            close: () => setOpen(false),
          })
        : null,
    );
  }
  try {
    await act(async () => root.render(h(Harness)));
    // Choose decorative so toolbar and plain clipboard uploads can submit too.
    await act(async () => document.querySelector<HTMLInputElement>('[type="checkbox"]')?.click());
    await act(async () =>
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Uploading");
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
      editor.commands.insertContent(" while waiting");
    });
    expect(document.activeElement).toBe(editor.view.dom);
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    // Include TipTap's deferred focus and Radix's close autofocus in the assertion.
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(editor.view.dom);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(editor.getHTML()).toContain("<img");
    expect(editor.state.selection.$from.parent.textContent).toBe("Last paragraph while waiting");
    editor.commands.insertContent(" continued");
    expect(editor.state.doc.lastChild?.textContent).toBe("Last paragraph while waiting continued");
    expect(editor.getText().replaceAll("\n", "")).toBe(
      `${origin === "rich clipboard" ? "BodyBeforeAfter text" : "Body text"}Last paragraph while waiting continued`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    editor.destroy();
    doc.destroy();
    element.remove();
  }
});
