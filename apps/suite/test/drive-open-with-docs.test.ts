// AUTHORED-BY Codex GPT-6.1
import { describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES } from "../src/apps/docs/lib/convert/import-file";
import { DOCX_FORMATTING_WARNING } from "../src/apps/docs/lib/convert/skipped";
import {
  canWriteFromWacAllow,
  DOCS_READ_ONLY_REASON,
  docsHref,
  FOREIGN_FILE_REASON,
  isDocsDocument,
  openWithDocsState,
  probeDocsWritable,
  skippedSummary,
  TOO_LARGE_REASON,
} from "../src/apps/drive/lib/open-with/docs";
import { decodeRef } from "../src/lib/refs";

const ROOT = "https://pod.test/alice/";
const file = (url: string, extra: { size?: number } = {}) => ({
  url,
  name: url.split("/").pop() as string,
  kind: "file" as const,
  ...extra,
});

describe("Docs documents in Drive", () => {
  it("are direct .ttl children of the Docs containers the editor can open", () => {
    expect(isDocsDocument(file(`${ROOT}docs/plan.ttl`), ROOT)).toBe(true);
    expect(isDocsDocument(file(`${ROOT}pod-docs/legacy.ttl`), ROOT)).toBe(true);
    for (const url of [
      `${ROOT}docs/plan/`,
      `${ROOT}docs/plan/assets/a.ttl`,
      `${ROOT}docs/plan.md`,
      `${ROOT}drive/plan.ttl`,
      `${ROOT}docs/a%2Fb.ttl`,
      "https://other.test/alice/docs/plan.ttl",
      `${ROOT}docs/plan.ttl?x=1`,
    ])
      expect(isDocsDocument(file(url), ROOT), url).toBe(false);
    expect(isDocsDocument({ url: `${ROOT}docs/plan.ttl`, kind: "folder" }, ROOT)).toBe(false);
  });
  it("open at the Docs editor route", () => {
    const href = docsHref(`${ROOT}docs/plan.ttl`);
    expect(href.startsWith("/docs/d/")).toBe(true);
    expect(decodeRef(href.slice("/docs/d/".length))).toBe(`${ROOT}docs/plan.ttl`);
  });
});

describe("Open with Docs availability", () => {
  const context = { storageUrl: ROOT };
  it("opens Docs documents directly, even offline or without Docs write access", () => {
    expect(
      openWithDocsState(file(`${ROOT}docs/plan.ttl`), {
        ...context,
        offlineReason: "Offline",
        docsWritable: false,
      }),
    ).toEqual({ kind: "open", href: docsHref(`${ROOT}docs/plan.ttl`) });
  });
  it("converts the formats Docs imports and nothing else", () => {
    expect(openWithDocsState(file(`${ROOT}drive/notes.md`), context)).toEqual({
      kind: "convert",
    });
    expect(openWithDocsState(file(`${ROOT}drive/Plan.DOCX`), context)).toEqual({
      kind: "convert",
    });
    expect(openWithDocsState(file(`${ROOT}drive/photo.png`), context)).toBeUndefined();
    for (const name of ["page.html", "page.HTM", "notes.txt", "notes.markdown"])
      expect(openWithDocsState(file(`${ROOT}drive/${name}`), context)).toEqual({ kind: "convert" });
    expect(
      openWithDocsState(
        { url: `${ROOT}drive/notes.md/`, name: "notes.md", kind: "folder" },
        context,
      ),
    ).toBeUndefined();
  });
  it("explains why a conversion is disabled, most fundamental reason first", () => {
    const foreign = file("https://other.test/bob/report.docx", { size: MAX_IMPORT_BYTES + 1 });
    expect(openWithDocsState(foreign, { ...context, offlineReason: "Offline" })).toEqual({
      kind: "convert",
      disabledReason: FOREIGN_FILE_REASON,
    });
    const large = file(`${ROOT}drive/big.docx`, { size: MAX_IMPORT_BYTES + 1 });
    expect(openWithDocsState(large, { ...context, offlineReason: "Offline" })).toEqual({
      kind: "convert",
      disabledReason: TOO_LARGE_REASON,
    });
    const notes = file(`${ROOT}drive/notes.md`, { size: MAX_IMPORT_BYTES });
    expect(
      openWithDocsState(notes, { ...context, offlineReason: "Offline", docsWritable: false }),
    ).toEqual({ kind: "convert", disabledReason: "Offline" });
    expect(openWithDocsState(notes, { ...context, docsWritable: false })).toEqual({
      kind: "convert",
      disabledReason: DOCS_READ_ONLY_REASON,
    });
    // An unknown probe result never blocks; the conversion itself reports failures.
    expect(openWithDocsState(notes, { ...context, docsWritable: undefined })).toEqual({
      kind: "convert",
    });
    expect(openWithDocsState(notes, { ...context, docsWritable: true })).toEqual({
      kind: "convert",
    });
  });
});

describe("Docs folder write access", () => {
  it("reads the user's WAC-Allow modes", () => {
    expect(canWriteFromWacAllow('user="read write append control",public="read"')).toBe(true);
    expect(canWriteFromWacAllow('public="read write", user="read"')).toBe(false);
    expect(canWriteFromWacAllow('USER="Write"')).toBe(true);
    expect(canWriteFromWacAllow('user="read append"')).toBe(false);
    expect(canWriteFromWacAllow('public="read"')).toBeUndefined();
    expect(canWriteFromWacAllow(null)).toBeUndefined();
  });
  it("probes the Docs container without following redirects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { headers: { "wac-allow": 'user="read write"' } }),
    );
    await expect(probeDocsWritable({ storageUrl: ROOT, fetch })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${ROOT}docs/`, {
      method: "HEAD",
      redirect: "error",
      headers: { "cache-control": "no-cache" },
    });
  });
  it("falls back to the storage root while the Docs container does not exist yet", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      input === `${ROOT}docs/`
        ? new Response(null, { status: 404 })
        : new Response(null, { headers: { "wac-allow": 'user="read"' } }),
    );
    await expect(probeDocsWritable({ storageUrl: ROOT, fetch })).resolves.toBe(false);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ROOT}docs/`, ROOT]);
  });
  it("treats refusals as read-only and anything else as unknown", async () => {
    const status = (code: number) => async () => new Response(null, { status: code });
    await expect(probeDocsWritable({ storageUrl: ROOT, fetch: status(403) })).resolves.toBe(false);
    await expect(probeDocsWritable({ storageUrl: ROOT, fetch: status(401) })).resolves.toBe(false);
    await expect(
      probeDocsWritable({ storageUrl: ROOT, fetch: status(500) }),
    ).resolves.toBeUndefined();
    await expect(
      probeDocsWritable({ storageUrl: ROOT, fetch: async () => new Response(null) }),
    ).resolves.toBeUndefined();
    await expect(
      probeDocsWritable({
        storageUrl: ROOT,
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("Skipped import summary", () => {
  it("lists counted items and keeps the formatting warning as a sentence", () => {
    expect(
      skippedSummary([
        { label: "Footnotes", count: 2 },
        { label: DOCX_FORMATTING_WARNING, count: 1 },
        { label: "Comments", count: 1 },
      ]),
    ).toBe(`Footnotes (2), Comments (1). ${DOCX_FORMATTING_WARNING}`);
    expect(skippedSummary([{ label: DOCX_FORMATTING_WARNING, count: 1 }])).toBe(
      DOCX_FORMATTING_WARNING,
    );
    expect(skippedSummary([{ label: "Footnotes", count: 1 }])).toBe("Footnotes (1).");
  });
});
