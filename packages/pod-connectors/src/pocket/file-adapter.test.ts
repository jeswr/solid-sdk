// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { MAX_TITLE_CHARS } from "../core/export-fields.js";
import { MAX_XML_TAG_BYTES, MAX_XML_TEXT_BYTES } from "../core/file-stream.js";
import { fileImport, memoryFile, streamedBytesFile, TEST_POD_ROOT } from "../core/testing.js";
import { Bookmark, CLASSES, SCHEMA_HTTP } from "../core/vocab.js";
import { pocketFileAdapter } from "./file-adapter.js";

const DOC = `${TEST_POD_ROOT}integrations/pocket/documents/pocket-bookmarks.ttl`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// Synthetic Pocket exports (invented links, titles and times).
const CSV = `title,url,time_added,tags,status
"Synthetic, quoted ""title""",https://example.org/a,1700000000,reading|later,unread
Archived piece,https://example.org/b?x=1#frag,1600000000,,archive
Insecure but fine,http://example.org/c,1500000000,tech,unread`;

const HTML = `<!DOCTYPE html>
<html><head><title>Pocket Export</title></head><body>
<!-- <a href="https://example.org/commented">ignored</a> -->
<h1>Unread</h1>
<ul>
<li><a href="https://example.org/a" time_added="1700000000" tags="reading,later">Synthetic &amp; <b>bold</b> title</a></li>
</ul>
<h1>Read Archive</h1>
<ul>
<li><a href='https://example.org/b' time_added="1600000000" tags="">Archived &#x1F30D;</a></li>
</ul>
</body></html>`;

function bookmarks(ds: DatasetCore): Bookmark[] {
  return [...ds]
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === CLASSES.Bookmark)
    .map((q) => new Bookmark(q.subject.value, ds, DataFactory))
    .sort((a, b) => (a.url ?? "").localeCompare(b.url ?? ""));
}

const bookmarkShapes = new Store(
  new Parser().parse(
    readFileSync(new URL("../../../solid-bookmark/bookmark.shacl.ttl", import.meta.url), "utf8"),
  ),
);

describe("pocket file adapter", () => {
  it("maps the CSV export to solid-bookmark bookmarks", async () => {
    const { pod, report } = await fileImport(
      pocketFileAdapter,
      streamedBytesFile("part_000000.csv", CSV),
    );
    expect(report.categories).toEqual(["documents"]);
    expect(report.written.map((w) => w.url)).toEqual([DOC]);
    const [c, a, b] = bookmarks(pod.dataset(DOC));
    expect(a?.url).toBe("https://example.org/a");
    expect(a?.title).toBe('Synthetic, quoted "title"');
    expect(a?.created?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(a?.archived).toBe(false);
    expect([...(a?.tags ?? [])].sort()).toEqual(["later", "reading"]);
    expect(b?.url).toBe("https://example.org/b?x=1#frag");
    expect(b?.archived).toBe(true);
    expect(c?.url).toBe("http://example.org/c");
    expect(pod.get(report.indexUrl)).toContain(CLASSES.Bookmark);
  });

  it("writes data that conforms to the @jeswr/solid-bookmark SHACL shape", async () => {
    const { pod } = await fileImport(pocketFileAdapter, streamedBytesFile("pocket.csv", CSV));
    const ds = pod.dataset(DOC);
    const report = await new SHACLValidator(bookmarkShapes).validate(ds);
    expect(report.conforms).toBe(true);
    // The saved page uses solid-bookmark's schema:url, not the provenance source URL.
    expect([...ds].some((q) => q.predicate.value === `${SCHEMA_HTTP}url`)).toBe(true);
    expect([...ds].some((q) => q.predicate.value === "https://schema.org/url")).toBe(false);
  });

  it("maps the legacy ril_export.html, honouring sections and skipping comments", async () => {
    for (const chunk of [1, 7, 4096]) {
      const { pod } = await fileImport(
        pocketFileAdapter,
        streamedBytesFile("ril_export.html", HTML, chunk),
      );
      const [a, b] = bookmarks(pod.dataset(DOC));
      expect(bookmarks(pod.dataset(DOC))).toHaveLength(2);
      expect(a?.title).toBe("Synthetic & bold title");
      expect(a?.archived).toBe(false);
      expect([...(a?.tags ?? [])].sort()).toEqual(["later", "reading"]);
      expect(b?.title).toBe("Archived 🌍");
      expect(b?.archived).toBe(true);
      expect(b?.created?.toISOString()).toBe("2020-09-13T12:26:40.000Z");
    }
  });

  it("skips and counts non-http(s) and malformed links", async () => {
    const hostile = `title,url,time_added,tags,status
Script,javascript:alert(1),1700000000,,unread
Data,"data:text/html;base64,PHNjcmlwdD4=",1700000000,,unread
File,file:///etc/passwd,1700000000,,unread
Creds,https://user:secret@example.org/x,1700000000,,unread
Relative,/relative/path,1700000000,,unread
Missing,,1700000000,,unread
Kept,https://example.org/kept,1700000000,,unread`;
    const { pod, report } = await fileImport(
      pocketFileAdapter,
      streamedBytesFile("p.csv", hostile),
    );
    expect(report.skipped).toBe(6);
    expect(report.state?.counts.skipped).toBe(6);
    expect(bookmarks(pod.dataset(DOC)).map((b) => b.url)).toEqual(["https://example.org/kept"]);
    const html = `<h1>Unread</h1><a href="javascript:alert(1)">x</a><a href="  https://example.org/ok  ">ok</a>`;
    const second = await fileImport(pocketFileAdapter, streamedBytesFile("ril_export.html", html));
    expect(second.report.skipped).toBe(1);
    expect(bookmarks(second.pod.dataset(DOC)).map((b) => b.url)).toEqual([
      "https://example.org/ok",
    ]);
  });

  it("dedups a link saved twice, merging its tags", async () => {
    const dup = `title,url,time_added,tags,status
First,https://example.org/a,1700000000,one,unread
Second,https://example.org/a,1710000000,two|one,archive`;
    const { pod, report } = await fileImport(pocketFileAdapter, streamedBytesFile("p.csv", dup));
    const [only] = bookmarks(pod.dataset(DOC));
    expect(bookmarks(pod.dataset(DOC))).toHaveLength(1);
    expect(only?.title).toBe("First");
    expect(only?.archived).toBe(false);
    expect([...(only?.tags ?? [])].sort()).toEqual(["one", "two"]);
    expect(report.skipped).toBeUndefined();
    expect(report.state?.counts.items).toBe(1);
  });

  it("re-imports idempotently", async () => {
    const file = streamedBytesFile("p.csv", CSV);
    const { pod, report } = await fileImport(pocketFileAdapter, file);
    const before = [...pod.dataset(DOC)].length;
    const subjects = bookmarks(pod.dataset(DOC)).map((b) => b.value);
    const again = await fileImport(pocketFileAdapter, file, { pod });
    expect([...pod.dataset(DOC)].length).toBe(before);
    expect(bookmarks(pod.dataset(DOC)).map((b) => b.value)).toEqual(subjects);
    expect(again.report.state?.counts).toEqual(report.state?.counts);
  });

  it("drops out-of-range or non-numeric times and caps titles", async () => {
    const long = "T".repeat(MAX_TITLE_CHARS + 10);
    const csv = `title,url,time_added,tags,status
${long},https://example.org/a,7258118400,,unread
Neg,https://example.org/b,-5,,unread
Hex,https://example.org/c,0x10,,odd`;
    const { pod } = await fileImport(pocketFileAdapter, streamedBytesFile("p.csv", csv));
    const [a, b, c] = bookmarks(pod.dataset(DOC));
    expect(a?.title).toBe("T".repeat(MAX_TITLE_CHARS));
    expect(a?.created).toBeUndefined();
    expect(b?.created).toBeUndefined();
    expect(c?.created).toBeUndefined();
    expect(c?.archived).toBeUndefined();
  });

  it("bounds HTML tags and anchor text, and fails on unterminated markup", async () => {
    const huge = `<h1>Unread</h1><a href="https://example.org/big">${"x".repeat(MAX_XML_TEXT_BYTES + 1)}</a><a href="https://example.org/small">small</a><p ${"a".repeat(MAX_XML_TAG_BYTES)}>`;
    const { pod, report } = await fileImport(
      pocketFileAdapter,
      streamedBytesFile("ril_export.html", huge, 65536),
    );
    expect(report.skipped).toBe(2);
    expect(bookmarks(pod.dataset(DOC)).map((b) => b.url)).toEqual(["https://example.org/small"]);
    await expect(
      fileImport(
        pocketFileAdapter,
        streamedBytesFile("ril_export.html", '<a href="https://x.example/">x</a><a href="'),
      ),
    ).rejects.toThrow("Unterminated HTML tag");
  });

  it("works through the text-only port and refuses an empty export", async () => {
    const { pod } = await fileImport(pocketFileAdapter, memoryFile("p.csv", CSV, "text/csv"));
    expect(bookmarks(pod.dataset(DOC))).toHaveLength(3);
    await expect(fileImport(pocketFileAdapter, memoryFile("p.csv", "  \n"))).rejects.toThrow(
      "No importable records",
    );
  });
});
