// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { SuiteNativeError } from "./errors.js";
import {
  clearPdfPreviews,
  openPdf,
  PDF_PREVIEW_CHUNK_BYTES,
  PDF_PREVIEW_MAX_BYTES,
  PDF_PREVIEW_NAME_CODE_POINTS,
  PdfPreviewError,
  type PdfPreviewPlugin,
} from "./pdf-preview.js";

const pdf = (size: number) => {
  const bytes = new Uint8Array(size).fill(0x41);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return bytes;
};

function plugin(overrides: Partial<PdfPreviewPlugin> = {}) {
  return {
    pdfBegin: vi.fn(async () => ({ handle: "h1" })),
    pdfChunk: vi.fn(async () => undefined),
    pdfOpen: vi.fn(async () => undefined),
    pdfClear: vi.fn(async () => undefined),
    ...overrides,
  } satisfies PdfPreviewPlugin;
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof PdfPreviewError ? error.code : "other"),
  );

describe("openPdf", () => {
  it("sends the declared size, 1 MiB base64 chunks in order, then opens the handle", async () => {
    const native = plugin();
    const bytes = pdf(PDF_PREVIEW_CHUNK_BYTES * 2 + 3);
    await openPdf(native, "Report.pdf", bytes);
    expect(native.pdfBegin).toHaveBeenCalledWith({ name: "Report.pdf", size: bytes.byteLength });
    const chunks = native.pdfChunk.mock.calls.map(([options]) => options);
    expect(chunks.map((chunk) => chunk.handle)).toEqual(["h1", "h1", "h1"]);
    const decoded = chunks.map((chunk) => Buffer.from(chunk.data, "base64"));
    expect(decoded.map((chunk) => chunk.byteLength)).toEqual([
      PDF_PREVIEW_CHUNK_BYTES,
      PDF_PREVIEW_CHUNK_BYTES,
      3,
    ]);
    expect(Buffer.concat(decoded).equals(Buffer.from(bytes))).toBe(true);
    expect(native.pdfOpen).toHaveBeenCalledWith({ handle: "h1" });
  });

  it("stops before the next native call once the signal aborts", async () => {
    const before = new AbortController();
    before.abort();
    const idle = plugin();
    expect(await code(openPdf(idle, "a.pdf", pdf(10), before.signal))).toBe("cancelled");
    expect(idle.pdfBegin).not.toHaveBeenCalled();

    const during = new AbortController();
    const native = plugin({
      pdfChunk: vi.fn(async () => {
        during.abort();
      }),
    });
    const bytes = pdf(PDF_PREVIEW_CHUNK_BYTES * 2);
    expect(await code(openPdf(native, "a.pdf", bytes, during.signal))).toBe("cancelled");
    expect(native.pdfChunk).toHaveBeenCalledTimes(1);
    expect(native.pdfOpen).not.toHaveBeenCalled();

    const last = new AbortController();
    const single = plugin({
      pdfChunk: vi.fn(async () => {
        last.abort();
      }),
    });
    expect(await code(openPdf(single, "a.pdf", pdf(10), last.signal))).toBe("cancelled");
    expect(single.pdfOpen).not.toHaveBeenCalled();
  });

  it("cuts long display names on a code point boundary", async () => {
    const native = plugin();
    await openPdf(native, "😀".repeat(PDF_PREVIEW_NAME_CODE_POINTS + 10), pdf(10));
    const [[{ name }]] = native.pdfBegin.mock.calls as unknown as [[{ name: string }]];
    expect(Array.from(name)).toHaveLength(PDF_PREVIEW_NAME_CODE_POINTS);
    expect(name).toBe("😀".repeat(PDF_PREVIEW_NAME_CODE_POINTS));
  });

  it("refuses an oversized file before anything crosses the bridge", async () => {
    const native = plugin();
    const oversized = { byteLength: PDF_PREVIEW_MAX_BYTES + 1 } as Uint8Array;
    expect(await code(openPdf(native, "a.pdf", oversized))).toBe("too-large");
    expect(native.pdfBegin).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly the cap", async () => {
    const native = plugin();
    await openPdf(native, "a.pdf", pdf(PDF_PREVIEW_MAX_BYTES));
    expect(native.pdfChunk).toHaveBeenCalledTimes(PDF_PREVIEW_MAX_BYTES / PDF_PREVIEW_CHUNK_BYTES);
  });

  it.each([
    ["HTML", new TextEncoder().encode("<html><script>")],
    ["a short prefix", new TextEncoder().encode("%PD")],
    ["nothing", new Uint8Array()],
  ])("refuses %s without the PDF signature", async (_, bytes) => {
    const native = plugin();
    expect(await code(openPdf(native, "a.pdf", bytes))).toBe("not-pdf");
    expect(native.pdfBegin).not.toHaveBeenCalled();
  });

  it.each([
    ["no-viewer", "no-viewer"],
    ["too-large", "too-large"],
    ["not-pdf", "not-pdf"],
    ["invalid", "failed"],
    [undefined, "failed"],
  ])("maps a native %s rejection to %s", async (nativeCodeValue, expected) => {
    const native = plugin({
      pdfOpen: vi.fn(async () => {
        throw Object.assign(new Error("native"), { code: nativeCodeValue });
      }),
    });
    const error = await openPdf(native, "a.pdf", pdf(10)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SuiteNativeError);
    expect((error as PdfPreviewError).code).toBe(expected);
    expect((error as PdfPreviewError).name).toBe("PdfPreviewError");
  });

  it.each([
    ["a missing handle", async () => ({}) as { handle: string }],
    ["an empty handle", async () => ({ handle: "" })],
    ["no result", async () => undefined as unknown as { handle: string }],
  ])("fails on %s without sending bytes", async (_, pdfBegin) => {
    const native = plugin({ pdfBegin: vi.fn(pdfBegin) });
    expect(await code(openPdf(native, "a.pdf", pdf(10)))).toBe("failed");
    expect(native.pdfChunk).not.toHaveBeenCalled();
  });

  it("maps a non-object rejection to failed", async () => {
    const native = plugin({
      pdfChunk: vi.fn(async () => {
        throw null;
      }),
    });
    expect(await code(openPdf(native, "a.pdf", pdf(10)))).toBe("failed");
    expect(native.pdfOpen).not.toHaveBeenCalled();
  });
});

describe("clearPdfPreviews", () => {
  it("asks native code to clear every preview", async () => {
    const native = plugin();
    await clearPdfPreviews(native);
    expect(native.pdfClear).toHaveBeenCalledOnce();
    expect(native.pdfBegin).not.toHaveBeenCalled();
  });

  it("reports a native failure as failed", async () => {
    const native = plugin({
      pdfClear: vi.fn(async () => {
        throw Object.assign(new Error("io"), { code: "too-large" });
      }),
    });
    expect(await code(clearPdfPreviews(native))).toBe("failed");
  });
});
