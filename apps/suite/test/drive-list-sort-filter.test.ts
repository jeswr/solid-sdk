// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  createListComparator,
  filterEntries,
  getTypeFamily,
  type ListEntry,
  ListError,
  type ListErrorCode,
  type SortOptions,
  sortEntries,
  TYPE_FILTERS,
  type TypeFilter,
} from "../src/apps/drive/lib/list";

function entry(displayName: string, overrides: Partial<ListEntry> = {}): ListEntry {
  return {
    url: `https://example.org/drive/${displayName}`,
    kind: "resource",
    displayName,
    ...overrides,
  };
}
function fails(run: () => unknown, code: ListErrorCode): void {
  expect(run).toThrow(ListError);
  expect(run).toThrow(expect.objectContaining({ name: "ListError", code }));
}
const names = (items: readonly ListEntry[]) => items.map((item) => item.displayName);

describe("Drive list sorting", () => {
  const files = Object.freeze([
    Object.freeze(entry("file10", { size: 20, modified: new Date(20), contentType: "text/plain" })),
    Object.freeze(entry("file2", { size: 10, modified: new Date(10), contentType: "image/png" })),
    Object.freeze(entry("Folder", { kind: "container", size: 999 })),
  ]);

  it("sorts natural names with folders first, independent of sort direction", () => {
    expect(names(sortEntries(files))).toEqual(["Folder", "file2", "file10"]);
    expect(names(sortEntries(files, { dir: "desc" }))).toEqual(["Folder", "file10", "file2"]);
    expect(names(sortEntries(files, { foldersFirst: false }))).toEqual([
      "file2",
      "file10",
      "Folder",
    ]);
    expect(createListComparator()(files[0] as ListEntry, files[2] as ListEntry)).toBe(1);
    expect(files[0]?.displayName).toBe("file10");
    expect(sortEntries([])).toEqual([]);
    expect(sortEntries([files[0] as ListEntry])[0]).toBe(files[0]);
  });

  it.each(["size", "modified", "type"] as const)("sorts %s ascending/descending", (key) => {
    expect(names(sortEntries(files, { key }))).toEqual(["Folder", "file2", "file10"]);
    expect(names(sortEntries(files, { key, dir: "desc" }))).toEqual(["Folder", "file10", "file2"]);
  });

  it("supports explicit locales and stable collation/numeric ties", () => {
    const input = [entry("File02"), entry("file2"), entry("file10")];
    expect(sortEntries(input, { locale: "en-GB" })).toEqual(input);
    expect(names(sortEntries([entry("ä"), entry("z")], { locale: "sv" }))).toEqual(["z", "ä"]);
    const tied = [entry("z", { size: 1 }), entry("a", { size: 1 })];
    expect(sortEntries(tied, { key: "size" })).toEqual(tied);
    expect(createListComparator()(input[0] as ListEntry, input[0] as ListEntry)).toBe(0);
  });

  it.each([
    "size",
    "modified",
    "type",
  ] as const)("keeps unknown %s last in both directions", (key) => {
    const known = entry("known", { size: 0, modified: new Date(0), contentType: "text/plain" });
    const absent = entry("absent");
    const nulled = entry("null", { size: null, modified: null, contentType: null });
    for (const dir of ["asc", "desc"] as const) {
      const compare = createListComparator({ key, dir });
      expect(compare(absent, known)).toBe(1);
      expect(compare(known, absent)).toBe(-1);
      expect(compare(absent, nulled)).toBe(0);
      expect(sortEntries([absent, known, nulled], { key, dir })).toEqual([known, absent, nulled]);
    }
    const folder = entry("folder", { kind: "container", size: 7 });
    if (key === "size") {
      expect(sortEntries([folder, known], { key, foldersFirst: false })).toEqual([known, folder]);
    }
  });

  it("compares MIME essence without case or parameter differences", () => {
    const compare = createListComparator({ key: "type" });
    expect(
      compare(
        entry("a", { contentType: "TEXT/PLAIN; charset=utf-8" }),
        entry("b", { contentType: "text/plain" }),
      ),
    ).toBe(0);
  });

  it.each([
    null,
    [],
    { key: "owner" },
    { key: null },
    { dir: "up" },
    { dir: null },
    { foldersFirst: 1 },
    { locale: 1 },
    { locale: "" },
    { locale: "en_US" },
    { locale: "zz-ZZ" },
  ])("rejects malformed options even for an empty list (%j)", (options) => {
    fails(() => sortEntries([], options as SortOptions), "invalid-options");
  });

  it.each([
    null,
    [],
    {},
    { url: "" },
    { url: 7 },
    { displayName: " " },
    { displayName: "\ud800" },
    { kind: "folder" },
    { size: -1 },
    { size: 0.5 },
    { size: NaN },
    { size: Infinity },
    { size: Number.MAX_SAFE_INTEGER + 1 },
    { size: "1" },
    { modified: new Date(NaN) },
    { modified: "2026-10-26" },
    { modified: 0 },
  ])("rejects invalid entries, including singletons (%j)", (overrides) => {
    const value =
      overrides === null || Array.isArray(overrides) || Object.keys(overrides).length === 0
        ? overrides
        : entry("file", overrides as Partial<ListEntry>);
    fails(() => sortEntries([value as ListEntry]), "invalid-entry");
    fails(() => createListComparator()(value as ListEntry, entry("valid")), "invalid-entry");
    fails(() => createListComparator()(entry("valid"), value as ListEntry), "invalid-entry");
  });

  it("rejects non-arrays, sparse arrays and duplicate identities", () => {
    fails(() => sortEntries(null as unknown as ListEntry[]), "invalid-entry");
    fails(() => sortEntries(new Array(1)), "invalid-entry");
    fails(() => sortEntries([entry("same"), entry("same")]), "invalid-entry");
  });
});

describe("Drive MIME family filters", () => {
  it.each([
    ["image/png", "images"],
    ["image/svg+xml", "images"],
    ["audio/ogg", "audio"],
    ["video/mp4", "video"],
    ["application/pdf", "pdfs"],
    ["text/plain", "documents"],
    ["text/markdown", "documents"],
    ["text/html", "documents"],
    ["application/msword", "documents"],
    ["application/rtf", "documents"],
    ["application/vnd.ms-excel", "documents"],
    ["application/vnd.ms-powerpoint", "documents"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "documents"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "documents"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "documents"],
    ["application/vnd.oasis.opendocument.text", "documents"],
    ["application/vnd.oasis.opendocument.spreadsheet", "documents"],
    ["application/vnd.oasis.opendocument.presentation", "documents"],
    ["application/json", "data"],
    ["application/ld+json", "data"],
    ["application/xml", "data"],
    ["application/rdf+xml", "data"],
    ["application/n-triples", "data"],
    ["application/n-quads", "data"],
    ["application/trig", "data"],
    ["text/n3", "data"],
    ["text/turtle", "data"],
    ["text/csv", "data"],
    ["text/tab-separated-values", "data"],
    ["text/xml", "data"],
    ["application/octet-stream", "other"],
    ["application/zip", "other"],
    ["application/x-fictional", "other"],
    [null, "other"],
    [undefined, "other"],
    ['IMAGE/PNG; name="synthetic \\"picture\\""; charset=UTF-8\t', "images"],
  ])("classifies %j as %s", (contentType, expected) => {
    const value =
      contentType === undefined ? entry("report.pdf") : entry("report.pdf", { contentType });
    expect(getTypeFamily(value)).toBe(expected);
  });

  it("uses kind for folders and declared MIME rather than an extension", () => {
    expect(getTypeFamily(entry("photos", { kind: "container", contentType: "image/png" }))).toBe(
      "folders",
    );
    expect(getTypeFamily(entry("photo.png", { contentType: "application/octet-stream" }))).toBe(
      "other",
    );
  });

  it("ORs chips, leaves an unfiltered copy, and preserves order and identities", () => {
    const entries = Object.freeze(
      TYPE_FILTERS.map((family) =>
        entry(family, {
          kind: family === "folders" ? "container" : "resource",
          contentType: {
            folders: null,
            documents: "text/plain",
            images: "image/png",
            pdfs: "application/pdf",
            audio: "audio/mpeg",
            video: "video/mp4",
            data: "text/turtle",
            other: null,
          }[family],
        }),
      ),
    );
    expect(filterEntries(entries, [])).toEqual(entries);
    expect(filterEntries(entries, [])).not.toBe(entries);
    expect(names(filterEntries(entries, ["images", "pdfs", "images"]))).toEqual(["images", "pdfs"]);
    for (const family of TYPE_FILTERS)
      expect(names(filterEntries(entries, [family]))).toEqual([family]);
    expect(filterEntries([], ["images"])).toEqual([]);
    expect(filterEntries([entry("other")], ["folders"])).toEqual([]);
  });

  it.each([
    "",
    "image",
    "image/*",
    "*/*",
    "image/",
    "image/png\n",
    "image/png; x",
    "image/png; x=",
    'image/png; x="unfinished',
    7,
  ])("rejects malformed MIME (%j)", (contentType) => {
    const value = entry("file", { contentType: contentType as string });
    fails(() => getTypeFamily(value), "invalid-mime");
    fails(() => filterEntries([value], []), "invalid-mime");
  });

  it("validates filters and entries even when a result would be empty", () => {
    fails(() => filterEntries([], null as unknown as TypeFilter[]), "invalid-filter");
    fails(() => filterEntries([], ["unknown" as TypeFilter]), "invalid-filter");
    fails(() => filterEntries([null as unknown as ListEntry], []), "invalid-entry");
    fails(() => getTypeFamily(null as unknown as ListEntry), "invalid-entry");
  });

  it("never includes caller data in typed errors", () => {
    const secretLike = "unsupported sensitive value";
    try {
      getTypeFamily(entry(secretLike, { contentType: secretLike }));
    } catch (error) {
      expect(String(error)).toBe("ListError: Drive list: invalid-mime");
    }
  });
});
