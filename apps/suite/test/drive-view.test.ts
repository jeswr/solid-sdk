// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import {
  formatModified,
  formatSize,
  friendlyType,
  inModifiedRange,
  MODIFIED_FILTERS,
  parseCsv,
  previewKind,
  TYPE_FILTER_LABELS,
  toListEntry,
  viewItems,
} from "../src/apps/drive/lib/view/view";

// Local calendar dates exercise day/year boundaries independently of the host timezone.
const NOW = new Date(2026, 9, 26, 12);
const DAY = 86_400_000;
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);
const file = (name: string, extra: Partial<DriveItem> = {}): DriveItem => ({
  url: `https://pod.example/drive/${encodeURIComponent(name)}`,
  name,
  kind: "file",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("Drive listing presentation", () => {
  it("exposes the specified filter copy", () => {
    expect(MODIFIED_FILTERS).toEqual([
      { id: "today", label: "Today" },
      { id: "7d", label: "Last 7 days" },
      { id: "30d", label: "Last 30 days" },
      { id: "year", label: "This year" },
    ]);
    expect(Object.values(TYPE_FILTER_LABELS)).toEqual([
      "Folders",
      "Documents",
      "Images",
      "PDFs",
      "Audio",
      "Video",
      "Data",
      "Other",
    ]);
  });

  it("adapts files and folders, preserving zero sizes and the original item", () => {
    const item = file("notes.md", { size: 0, modified: NOW, contentType: "text/markdown" });
    expect(toListEntry(item)).toEqual({
      url: item.url,
      displayName: "notes.md",
      kind: "resource",
      size: 0,
      modified: NOW,
      contentType: "text/markdown",
      item,
    });
    const folder = file("Work", { kind: "folder" });
    expect(toListEntry(folder)).toEqual({
      url: folder.url,
      displayName: "Work",
      kind: "container",
      size: null,
      modified: null,
      contentType: null,
      item: folder,
    });
  });

  it.each([
    "",
    "invalid",
    "text/plain; charset=utf-8",
    "image/*",
  ])("keeps unsupported MIME syntax %j out of the strict list helpers", (contentType) => {
    expect(toListEntry(file("unknown", { contentType })).contentType).toBeNull();
    expect(viewItems([file("unknown", { contentType })], { types: ["other"] })).toHaveLength(1);
  });

  it("hides dot names, sorts folders first naturally, returns originals and leaves input alone", () => {
    const items = [
      file("file10.txt"),
      file(".trash", { kind: "folder" }),
      file("Work", { kind: "folder" }),
      file("file2.txt"),
      file("Archive", { kind: "folder" }),
    ];
    const before = [...items];
    const result = viewItems(items);
    expect(result.map((item) => item.name)).toEqual(["Archive", "Work", "file2.txt", "file10.txt"]);
    expect(result[0]).toBe(items[4]);
    expect(items).toEqual(before);
    expect(viewItems([])).toEqual([]);
    expect(viewItems(items, { types: [] })).toEqual(result);
  });

  it("combines ORed type chips with a modified range before sorting", () => {
    const items = [
      file("Work", { kind: "folder", modified: NOW }),
      file("report.pdf", { contentType: "application/pdf", modified: ago(DAY), size: 1000 }),
      file("old.pdf", { contentType: "application/pdf", modified: ago(8 * DAY), size: 2000 }),
      file("sunset.png", { contentType: "image/png", modified: NOW, size: 200 }),
      file("notes.md", { contentType: "text/markdown", modified: NOW }),
    ];
    expect(
      viewItems(items, {
        types: ["pdfs", "images"],
        modified: "7d",
        now: NOW,
        sort: { key: "size", dir: "desc" },
      }).map((item) => item.name),
    ).toEqual(["report.pdf", "sunset.png"]);
    expect(viewItems(items, { modified: "today" }).map((item) => item.name)).toEqual([
      "Work",
      "notes.md",
      "sunset.png",
    ]);
    expect(
      viewItems(items, { foldersFirst: false, sort: { key: "modified", dir: "desc" } }).map(
        (item) => item.name,
      ),
    ).toEqual(["Work", "sunset.png", "notes.md", "report.pdf", "old.pdf"]);
  });

  it.each([
    [undefined, "today", false],
    [new Date(2026, 9, 26), "today", true],
    [new Date(2026, 9, 25, 23, 59, 59, 999), "today", false],
    [ago(7 * DAY), "7d", true],
    [ago(7 * DAY + 1), "7d", false],
    [ago(30 * DAY), "30d", true],
    [ago(30 * DAY + 1), "30d", false],
    [new Date(2026, 0, 1), "year", true],
    [new Date(2025, 11, 31), "year", false],
    [new Date(2027, 0, 1), "year", false],
  ] as const)("checks %s against %s inclusively", (date, range, expected) => {
    expect(inModifiedRange(date, range, NOW)).toBe(expected);
  });
});

describe("Modified and size copy", () => {
  it.each([
    [undefined, "—"],
    [NOW, "Just now"],
    [ago(59_999), "Just now"],
    [ago(60_000), "1 minute ago"],
    [ago(3_599_999), "59 minutes ago"],
    [ago(3_600_000), "1 hour ago"],
    [ago(3 * 3_600_000), "3 hours ago"],
    [ago(DAY), "yesterday"],
    [ago(6 * DAY), "6 days ago"],
    [ago(7 * DAY), "Oct 19, 2026"],
    [new Date(2026, 9, 27), "Oct 27, 2026"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatModified(date, NOW, "en")).toBe(expected);
  });

  it("uses its clock and English locale defaults", () => {
    expect(formatModified(ago(60_000))).toBe("1 minute ago");
    expect(formatModified(ago(7 * DAY))).toBe("Oct 19, 2026");
  });

  it("uses calendar days across midnight instead of rounding elapsed hours", () => {
    expect(formatModified(new Date(2026, 9, 25, 23), NOW, "en")).toBe("yesterday");
  });

  it("formats known file sizes, rounds bytes and uses a dash for folders/unknowns", () => {
    expect(formatSize({ kind: "folder", size: 1000 }, "en")).toBe("—");
    expect(formatSize({ kind: "file" }, "en")).toBe("—");
    expect(formatSize({ kind: "file", size: 0 })).toBe("0 B");
    expect(formatSize({ kind: "file", size: -2 }, "en")).toBe("0 B");
    expect(formatSize({ kind: "file", size: 12.6 }, "en")).toBe("13 B");
    expect(formatSize({ kind: "file", size: 1200 }, "en")).toBe("1.2 kB");
  });
});

describe("friendly types and preview dispatch", () => {
  it("calls folders Folder regardless of MIME", () => {
    expect(friendlyType({ kind: "folder", name: "Work", contentType: "image/png" })).toBe("Folder");
  });
  it.each([
    [undefined, "File"],
    ["application/octet-stream", "File"],
    ["APPLICATION/PDF", "PDF document"],
    ["image/png", "Image (PNG)"],
    ["image/svg+xml", "Image (SVG)"],
    ["audio/mpeg", "Audio"],
    ["video/mp4", "Video"],
    ["text/markdown", "Markdown document"],
    ["text/csv", "Spreadsheet (CSV)"],
    ["text/turtle", "Data file"],
    ["application/ld+json", "Data file"],
    ["application/n-triples", "Data file"],
    ["application/trig", "Data file"],
    ["text/plain", "Text file"],
  ])("labels %s as %s", (contentType, expected) => {
    expect(
      friendlyType({ kind: "file", name: "file", ...(contentType ? { contentType } : {}) }),
    ).toBe(expected);
  });
  it.each([
    [undefined, "none"],
    ["", "none"],
    ["application/octet-stream", "none"],
    ["image/svg+xml", "none"],
    ["IMAGE/PNG", "image"],
    ["application/pdf", "pdf"],
    ["text/markdown", "markdown"],
    ["text/csv", "csv"],
    ["text/turtle", "rdf"],
    ["application/ld+json", "rdf"],
    ["application/n-triples", "rdf"],
    ["application/trig", "rdf"],
    ["text/n3", "rdf"],
    ["audio/mpeg", "audio"],
    ["video/mp4", "video"],
    ["text/plain", "text"],
    ["application/json", "text"],
  ] as const)("previews %s as %s", (type, expected) => expect(previewKind(type)).toBe(expected));
});

describe("CSV preview", () => {
  it.each([
    ["", []],
    ["a,b", [["a", "b"]]],
    ["a,b\n", [["a", "b"]]],
    [
      "a,b\r\nc,d\r\ne,f\rg,h\n",
      [
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
        ["g", "h"],
      ],
    ],
    ['"a,b","line 1\nline 2","say ""hi"""', [["a,b", "line 1\nline 2", 'say "hi"']]],
    ["\n", [[""]]],
    [",", [["", ""]]],
    ['""', [[""]]],
    ['"",end', [["", "end"]]],
    ['"unterminated', [["unterminated"]]],
  ])("parses %j", (text, expected) => expect(parseCsv(text)).toEqual(expected));

  it("caps completed rows and defaults to the first 200", () => {
    expect(parseCsv("a\nb\nc\n", 2)).toEqual([["a"], ["b"]]);
    expect(parseCsv("row\n".repeat(201))).toEqual(Array.from({ length: 200 }, () => ["row"]));
  });
});
