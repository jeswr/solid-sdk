// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { MediaRecord } from "@jeswr/solid-media-log";
import { expect, it } from "vitest";
import { entryPatch, filterMedia, type MediaFilters } from "../../src/apps/media/lib/view";

const records: MediaRecord[] = [
  {
    id: "a",
    url: null,
    etag: null,
    data: { title: "Zulu", kind: "film", status: "want", creator: "Aster Vale", year: 2025 },
  },
  {
    id: "b",
    url: null,
    etag: null,
    data: {
      title: "Episode",
      kind: "episode",
      status: "finished",
      review: "A quiet ending",
      rating: 4,
      source: "Netflix",
    },
  },
  {
    id: "c",
    url: null,
    etag: null,
    data: { title: "Book", kind: "book", status: "in-progress", rating: 0.5 },
  },
];
const all: MediaFilters = { kind: "all", status: "all", query: "", rated: false };
it("filters kind (including TV episodes), shelf, query and rated-only and sorts titles", () => {
  expect(filterMedia(records, all).map((record) => record.id)).toEqual(["c", "b", "a"]);
  expect(filterMedia(records, { ...all, kind: "tv" }).map((record) => record.id)).toEqual(["b"]);
  expect(filterMedia(records, { ...all, status: "want" }).map((record) => record.id)).toEqual([
    "a",
  ]);
  expect(filterMedia(records, { ...all, query: "  ASTER  " }).map((record) => record.id)).toEqual([
    "a",
  ]);
  expect(filterMedia(records, { ...all, query: "2025" })).toHaveLength(1);
  expect(filterMedia(records, { ...all, query: "quiet" })).toHaveLength(1);
  expect(filterMedia(records, { ...all, query: "Netflix" })).toHaveLength(1);
  expect(filterMedia(records, { ...all, rated: true })).toHaveLength(2);
  expect(filterMedia(records, { ...all, kind: "game" })).toEqual([]);
});
it("patches only changed fields, including explicit removal", () => {
  const before = records[1]?.data;
  if (!before) throw new Error("Missing media fixture");
  expect(entryPatch(before, { ...before, rating: 5, review: undefined })).toEqual({
    rating: 5,
    review: undefined,
  });
  expect(entryPatch(before, before)).toEqual({});
  const without = { title: "New", kind: "film" as const, status: "want" as const };
  expect(entryPatch(without, { ...without, creator: "Someone" })).toEqual({ creator: "Someone" });
});
