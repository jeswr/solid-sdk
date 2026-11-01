// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ImageUpload } from "../src/apps/docs/components/image-upload";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { imageTransfer } from "../src/apps/docs/editor/image-transfer";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";

// jsdom has no layout; retain real editor focus/selection behavior with inert geometry.
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(Range.prototype, "getClientRects", { value: () => [new DOMRect()] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => new DOMRect() });

afterEach(() => vi.unstubAllGlobals());

it.each(
  ["toolbar", "clipboard", "rich clipboard"].flatMap((origin) =>
    ["title", "popover"].flatMap((focus) =>
      ["PUT", "draft save"].map((pending) => ({ origin, focus, pending })),
    ),
  ),
)("round57 $origin completion during $pending preserves $focus typing focus", async ({
  origin,
  focus,
  pending,
}) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ClipboardEvent", Event);
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: baseExtensions(vi.fn(async () => new Response(null, { status: 404 }))),
    content: "<p>Body text</p>",
  });
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
    const title = document.querySelector<HTMLInputElement>('[aria-label="Document title"]');
    expect(title).not.toBeNull();
    if (focus === "title") {
      await act(async () => title?.focus());
      expect(document.activeElement).toBe(title);
    }
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    // Include TipTap's deferred focus and Radix's close autofocus in the assertion.
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(focus === "title" ? title : editor.view.dom);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(editor.getHTML()).toContain("<img");
    expect(editor.getText().replaceAll("\n", "")).toBe(
      origin === "rich clipboard" ? "BodyBeforeAfter text" : "Body text",
    );
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement) focused.setRangeText(" continued");
    if (focus === "title") expect(title?.value).toBe("Title continued");
    expect(editor.getText()).not.toContain("continued");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    editor.destroy();
    element.remove();
  }
});
