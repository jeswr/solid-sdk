// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, generateJSON, type JSONContent } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { displayImageBlob, imagePng } from "../src/apps/docs/editor/image-blob";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";

afterEach(() => vi.unstubAllGlobals());
it.each(["td", "th"])("round34 HTML %s spans are bounded before clipboard parsing", (tag) => {
  for (const key of ["colspan", "rowspan"]) {
    for (const value of ["Infinity", "-Infinity", "NaN", "0", "-1", "1.5", "1001", "1000000000"]) {
      const html = `<table><tr><${tag} ${key}="${value}">Total</${tag}></tr></table>`;
      const extensions = baseExtensions(vi.fn());
      // Fail before invoking table plugins on an unsafe span: the original
      // Infinity payload would otherwise hang the whole test worker.
      expect(
        generateJSON(html, extensions).content?.[0]?.content?.[0]?.content?.[0]?.attrs?.[key],
      ).toBe(1);
      const editor = new Editor({ extensions });
      try {
        expect(editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent)).toBe(true);
        expect(editor.getText()).toContain("Total");
        expect(
          (editor.getJSON() as JSONContent).content?.[0]?.content?.[0]?.content?.[0]?.attrs?.[key],
        ).toBe(1);
      } finally {
        editor.destroy();
      }
    }
  }
});

it("round34 SVG display never publishes active bytes in a suite-origin blob", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><script>indexedDB.open("documents")</script><rect width="10" height="10"/></svg>';
  const createObjectURL = vi.fn((_blob: Blob) => "blob:passive-png");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 10, height: 10, close })),
  );
  const png = new Blob(["rasterized pixels"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
  const fetchImpl = vi.fn(
    async () => new Response(source, { headers: { "content-type": "image/svg+xml" } }),
  );
  const editor = new Editor({
    extensions: baseExtensions(fetchImpl),
    content: importMarkdown("![Chart](https://attacker.test/chart.svg)", "chart.md").json,
  });
  try {
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(createObjectURL.mock.calls[0]?.[0]).toBe(png);
    expect(createImageBitmap).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(vi.mocked(createImageBitmap).mock.calls.length);
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe("blob:passive-png");
  } finally {
    editor.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:passive-png");
    vi.restoreAllMocks();
  }
});

it("round34 passive raster formats retain their bytes and animation", async () => {
  for (const type of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
  ]) {
    const blob = new Blob(["raster bytes"], { type });
    expect(await displayImageBlob(blob)).toBe(blob);
  }
  await expect(displayImageBlob(new Blob(["<script/>"]))).rejects.toThrow("Image unavailable");
});

it.each([
  "decode",
  "context",
  "encode",
])("round34 SVG %s failure never falls back to publishing active bytes", async (failure) => {
  // Both decoders fail for corrupt images; SVG compatibility is covered in round35.
  vi.stubGlobal(
    "Image",
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    },
  );
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (failure === "decode") throw new Error("Decode failed");
      return { width: 10, height: 10, close };
    }),
  );
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(
      failure === "context"
        ? null
        : ({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D),
    );
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => callback(null));
  try {
    await expect(
      imagePng(new Blob(["<svg><script/></svg>"], { type: "image/svg+xml" })),
    ).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(failure === "decode" ? 0 : 1);
  } finally {
    getContext.mockRestore();
    toBlob.mockRestore();
  }
});
