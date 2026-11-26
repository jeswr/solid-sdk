// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES } from "../src/apps/docs/lib/convert/import-file";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import {
  openWithSheets,
  openWithSheetsState,
  probeSheetsWritable,
  SHEETS_FOREIGN_REASON,
  SHEETS_READ_ONLY_REASON,
  SHEETS_TOO_LARGE_REASON,
} from "../src/apps/drive/lib/open-with/sheets";
import { encodeRef } from "../src/lib/refs";

const ROOT = "https://pod.test/alice/";
const csv: DriveItem = { url: `${ROOT}drive/Budget.CSV`, name: "Budget.CSV", kind: "file" };
const session = (fetch: typeof globalThis.fetch) => ({
  storageUrl: ROOT,
  webId: `${ROOT}me`,
  fetch,
});
const service = () => ({
  createFromCsv: vi.fn().mockResolvedValue({ container: `${ROOT}sheets/budget/` }),
});

describe("Open with Sheets", () => {
  it("offers CSV by extension or MIME, and opens validated workbooks", () => {
    const state = (item: DriveItem, extra = {}) =>
      openWithSheetsState(item, { storageUrl: ROOT, ...extra });
    expect(state(csv)).toEqual({ kind: "convert" });
    expect(state({ ...csv, name: "data", contentType: "TEXT/CSV; charset=utf-8" })).toEqual({
      kind: "convert",
    });
    expect(state({ ...csv, name: "data" })).toBeUndefined();
    expect(state({ ...csv, name: "data", contentType: "text/plain" })).toBeUndefined();
    expect(state({ ...csv, kind: "folder" })).toBeUndefined();
    const book = { ...csv, kind: "folder" as const, workbook: true as const };
    expect(state(book, { offlineReason: "Offline", sheetsWritable: false })).toEqual({
      kind: "open",
      href: `/sheets/s/${encodeRef(book.url)}`,
    });
    expect(state(csv, { offlineReason: "Offline", sheetsWritable: false })).toEqual({
      kind: "convert",
      disabledReason: "Offline",
    });
    expect(state(csv, { sheetsWritable: false })).toEqual({
      kind: "convert",
      disabledReason: SHEETS_READ_ONLY_REASON,
    });
    expect(state(csv, { sheetsWritable: true })).toEqual({ kind: "convert" });
    expect(state({ ...csv, size: MAX_IMPORT_BYTES + 1 })).toEqual({
      kind: "convert",
      disabledReason: SHEETS_TOO_LARGE_REASON,
    });
    for (const url of [
      "https://other.test/data.csv",
      "https://pod.test/bob/data.csv",
      `${ROOT}../bob/data.csv`,
      "https://user:pass@pod.test/alice/data.csv",
      "file:///alice/data.csv",
      "bad URL",
    ]) {
      expect(state({ ...csv, url })).toEqual({
        kind: "convert",
        disabledReason: SHEETS_FOREIGN_REASON,
      });
    }
  });

  it("probes folder access and falls back to the pod before Sheets exists", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).endsWith("sheets/")
        ? new Response(null, { status: 404 })
        : new Response(null, { headers: { "wac-allow": 'user="read write"' } }),
    );
    expect(await probeSheetsWritable(session(fetch))).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ROOT}sheets/`, ROOT]);
    for (const [, init] of fetch.mock.calls)
      expect(init).toMatchObject({ method: "HEAD", redirect: "manual" });
    for (const status of [401, 403, 500, 200]) {
      const result = await probeSheetsWritable(session(async () => new Response(null, { status })));
      expect(result).toBe(status === 401 || status === 403 ? false : undefined);
    }
    expect(
      await probeSheetsWritable(
        session(async () => {
          throw new TypeError("offline");
        }),
      ),
    ).toBeUndefined();
  });

  it("reads only the source and passes its exact text and title to the shared CSV importer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) =>
      init?.method === "HEAD" ? new Response(null) : new Response('ID,Formula\r\n001,"=1+1"\r\n'),
    );
    const importer = service();
    await expect(openWithSheets(csv, session(fetch), importer)).resolves.toEqual({
      container: `${ROOT}sheets/budget/`,
    });
    expect(importer.createFromCsv).toHaveBeenCalledWith({
      title: "Budget",
      csv: 'ID,Formula\r\n001,"=1+1"\r\n',
    });
    expect(fetch.mock.calls).toHaveLength(2);
    expect(fetch.mock.calls[1]).toEqual([csv.url, expect.objectContaining({ redirect: "manual" })]);
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "HEAD")).toBe(
      true,
    );
  });

  it("rejects unsupported, foreign, oversized, unreadable, redirected and read-only sources before creating", async () => {
    const importer = service();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
    for (const item of [
      { ...csv, name: "photo.png" },
      { ...csv, workbook: true as const },
      { ...csv, url: "https://pod.test/bob/data.csv" },
      { ...csv, size: MAX_IMPORT_BYTES + 1 },
    ])
      await expect(openWithSheets(item, session(fetch), importer)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      openWithSheets(
        csv,
        session(async () => new Response(null, { status: 403 })),
        importer,
      ),
    ).rejects.toThrow(SHEETS_READ_ONLY_REASON);
    for (const response of [
      new Response(null, { status: 403 }),
      new Response(null, { status: 302, headers: { location: "https://other.test/a.csv" } }),
      new Response(null, { headers: { "content-length": String(MAX_IMPORT_BYTES + 1) } }),
    ]) {
      await expect(
        openWithSheets(
          csv,
          session(async (_url, init) => (init?.method === "HEAD" ? new Response(null) : response)),
          importer,
        ),
      ).rejects.toThrow();
    }
    expect(importer.createFromCsv).not.toHaveBeenCalled();
  });

  it("bounds streamed bytes, cancels oversized downloads and propagates read failures", async () => {
    const importer = service();
    const cancel = vi.fn(async () => {
      throw new Error("cancel failed");
    });
    const large = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES + 1));
      },
      cancel,
    });
    const download = (response: Response) =>
      session(async (_url, init) => (init?.method === "HEAD" ? new Response(null) : response));
    await expect(openWithSheets(csv, download(new Response(large)), importer)).rejects.toThrow(
      SHEETS_TOO_LARGE_REASON,
    );
    expect(cancel).toHaveBeenCalledOnce();
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("Read failed"));
      },
    });
    await expect(openWithSheets(csv, download(new Response(broken)), importer)).rejects.toThrow(
      "Read failed",
    );
    expect(importer.createFromCsv).not.toHaveBeenCalled();
    await openWithSheets(
      { ...csv, name: "data", contentType: "text/csv" },
      download(new Response(null)),
      importer,
    );
    expect(importer.createFromCsv).toHaveBeenCalledWith({ title: "data", csv: "" });
  });

  it("cancels a declared oversized body and decodes UTF-8 across streamed chunk boundaries", async () => {
    const importer = service();
    const cancel = vi.fn(async () => {
      throw new Error("cancel failed");
    });
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(MAX_IMPORT_BYTES + 1) },
    });
    const download = (response: Response) =>
      session(async (_url, init) => (init?.method === "HEAD" ? new Response(null) : response));
    await expect(openWithSheets(csv, download(response), importer)).rejects.toThrow(
      SHEETS_TOO_LARGE_REASON,
    );
    expect(cancel).toHaveBeenCalledOnce();
    const bytes = new TextEncoder().encode("Name\nCafé");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, bytes.length - 1));
        controller.enqueue(bytes.subarray(bytes.length - 1));
        controller.close();
      },
    });
    await openWithSheets(
      { ...csv, size: MAX_IMPORT_BYTES },
      download(
        new Response(body, {
          headers: { "content-length": String(MAX_IMPORT_BYTES) },
        }),
      ),
      importer,
    );
    expect(importer.createFromCsv).toHaveBeenCalledWith({ title: "Budget", csv: "Name\nCafé" });
  });
});
