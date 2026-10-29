// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  dayKey,
  groupPhotos,
  monthKey,
  setFavourite,
} from "../../src/apps/photos/lib/model/timeline.js";
import {
  documentUrl,
  httpIri,
  identifier,
  isoDate,
} from "../../src/apps/photos/lib/model/validation.js";

it("groups UTC days and months newest first, with undated last and stable ties", () => {
  const undated = { name: "None", contentUrl: "z", keywords: [], exif: {} };
  const created = { ...undated, contentUrl: "b", created: "2026-05-01T00:00:00.000Z" };
  const captured = {
    ...undated,
    contentUrl: "a",
    exif: { dateTimeOriginal: "2026-06-15T00:00:00.000Z" },
  };
  const tie = { ...captured, contentUrl: "b" };
  const photos = [undated, created, tie, captured];
  expect(dayKey(undated)).toBe("undated");
  expect(dayKey(created)).toBe("2026-05-01");
  expect(monthKey(captured)).toBe("2026-06");
  expect([...groupPhotos(photos, "day")]).toEqual([
    ["2026-06-15", [captured, tie]],
    ["2026-05-01", [created]],
    ["undated", [undated]],
  ]);
  expect([...groupPhotos(photos, "month").keys()]).toEqual(["2026-06", "2026-05", "undated"]);
  expect(groupPhotos([], "day").size).toBe(0);
  expect(photos[0]).toBe(undated);
  expect(setFavourite(["a", "a"], "b", true)).toEqual(["a", "b"]);
  expect(setFavourite(["a", "b"], "a", false)).toEqual(["b"]);
  expect(setFavourite(["a"], "a", true)).toEqual(["a"]);
});
it("validates dates, resource URLs and path-safe identifiers", () => {
  expect(httpIri("https://pod.example/x>y")).toBe("https://pod.example/x%3Ey");
  for (const url of [
    "no",
    "ftp://pod.example/a",
    "https://user@pod.example/a",
    "https://:password@pod.example/a",
  ])
    expect(() => httpIri(url)).toThrow();
  for (const url of [
    "https://pod.example/a#it",
    "https://pod.example/a?q=1",
    "https://pod.example/a/",
  ])
    expect(() => documentUrl(url)).toThrow();
  expect(documentUrl("https://pod.example/a.ttl")).toBe("https://pod.example/a.ttl");
  expect(identifier("a-1_2")).toBe("a-1_2");
  for (const id of ["", "../a", "a/b", "a%2fb"]) expect(() => identifier(id)).toThrow();
  expect(isoDate("2026-10-25T00:00:00Z")).toBe("2026-10-25T00:00:00.000Z");
  expect(() => isoDate("invalid")).toThrow();
  expect(() => isoDate("2026-02-30T00:00:00Z")).toThrow();
});

it("groups and sorts explicit timezone offsets by the UTC instant", () => {
  const early = {
    name: "",
    contentUrl: "a",
    keywords: [],
    exif: { dateTimeOriginal: "2026-06-01T00:30:00+02:00" },
  };
  const late = { ...early, contentUrl: "b", exif: { dateTimeOriginal: "2026-05-31T23:30:00Z" } };
  expect([...groupPhotos([early, late], "day")]).toEqual([["2026-05-31", [late, early]]]);
});

it("sorts undated photos deterministically beside dated entries", () => {
  const dated = {
    name: "",
    contentUrl: "c",
    keywords: [],
    exif: {},
    created: "2026-10-25T00:00:00Z",
  };
  const undated = { name: "", contentUrl: "b", keywords: [], exif: {} };
  const first = { ...undated, contentUrl: "a" };
  expect([...groupPhotos([dated, undated, first], "day")]).toEqual([
    ["2026-10-25", [dated]],
    ["undated", [first, undated]],
  ]);
});
