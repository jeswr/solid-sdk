// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  decodeMediaCsv,
  MAX_IMPORT_CHARS,
  MAX_IMPORT_ROWS,
  mediaImportDuplicate,
  mediaImportIndex,
  mediaImportKey,
  parseGoodreadsCsv,
  parseLetterboxdCsv,
} from "../src/imports.js";

const lb = "Name,Year,Watched Date,Rating,Review,Rewatch,Letterboxd URI\n";
const gr =
  "Title,Author,Exclusive Shelf,My Rating,Date Read,Read Count,Book Id,Original Publication Year,Year Published,My Review\n";
describe("Letterboxd CSV", () => {
  it("reads quoted commas, quotes, multiline review, BOM and CRLF", () => {
    const result = parseLetterboxdCsv(
      `\uFEFF${lb.replace("\n", "\r\n")}"Paper, Moons",2025,2026-01-02,4.5,"A ""lovely"" film.\nSecond line.",Yes,https://letterboxd.com/film/paper-moons/\r\n`,
    );
    expect(result.issues).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      title: "Paper, Moons",
      status: "finished",
      finished: "2026-01-02",
      rating: 4.5,
      review: 'A "lovely" film.\nSecond line.',
      repeatCount: 1,
      source: "Letterboxd",
    });
  });
  it("handles watched and watchlist exports without inventing dates", () => {
    expect(parseLetterboxdCsv("Name,Year\nA,2024").entries[0]).toMatchObject({
      status: "finished",
    });
    expect(parseLetterboxdCsv("Name,Year\nA,2024", "want").entries[0]).toMatchObject({
      status: "want",
    });
    expect(parseLetterboxdCsv("Name,Year\nA,2024").entries[0]?.finished).toBeUndefined();
    expect(parseLetterboxdCsv(`${lb}A,2024,,5,Great,No,`).entries[0]).toMatchObject({
      rating: 5,
      repeatCount: 0,
    });
  });
  it.each([
    ",2026,,,,,",
    "A,no,,,,,",
    "A,2026,2026-02-30,,,,",
    "A,2026,,bad,,,",
    "A,2026,,0,,,",
    "A,2026,,3.25,,,",
    "A,2026,,,,maybe,",
    "A,2026,,,,,javascript:bad",
  ])("reports invalid rows without throwing: %s", (row) => {
    const result = parseLetterboxdCsv(`${lb + row}\nValid,2025,2026-03-01,5,,No,`);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.row).toBe(2);
    expect(result.entries).toHaveLength(1);
  });
  it("deduplicates identical rows", () => {
    const result = parseLetterboxdCsv("Name,Year\nA,2025\nA,2025");
    expect(result.entries).toHaveLength(1);
    expect(result.issues).toEqual([{ row: 3, message: "Duplicate item" }]);
  });
});
describe("Goodreads CSV", () => {
  it("maps shelves, dates, zero ratings, review, source IDs, publication year and rereads", () => {
    const result = parseGoodreadsCsv(
      gr +
        "A,Aster,read,5,2026/2/28,3,42,2024,2025,Wonderful\nB,Ellis,currently-reading,0,,0,,,2022,\nC,,to-read,,,,,,,\nD,,did-not-finish,,,,,,,",
    );
    expect(result.issues).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      kind: "book",
      status: "finished",
      finished: "2026-02-28",
      repeatCount: 2,
      year: 2024,
      origin: "https://www.goodreads.com/book/show/42",
      review: "Wonderful",
    });
    expect(result.entries[1]).toMatchObject({ status: "in-progress", year: 2022, repeatCount: 0 });
    expect(result.entries[1]?.rating).toBeUndefined();
    expect(result.entries[2]?.status).toBe("want");
    expect(result.entries[3]?.status).toBe("abandoned");
  });
  it("does not infer completion from Date Added or a missing Date Read", () => {
    const result = parseGoodreadsCsv(
      "Title,Author,Exclusive Shelf,Date Added\nA,Aster,read,2026/1/1",
    );
    expect(result.entries[0]?.finished).toBeUndefined();
  });
  it.each([
    "A,,read,6,,,,,,",
    "A,,read,,,1.5,,,,",
    "A,,read,,,,../bad,,,",
    "A,,read,,,,,,2026x,",
  ])("reports invalid Goodreads row: %s", (row) =>
    expect(parseGoodreadsCsv(gr + row).issues).toHaveLength(1));
});
describe("CSV bounds and schema", () => {
  it.each([
    "",
    "Title\nA",
    "Name,Name,Year\nA,A,2026",
  ])("refuses missing or duplicate columns", (csv) =>
    expect(() => parseLetterboxdCsv(csv)).toThrow(TypeError));
  it("handles a header-only valid export", () =>
    expect(parseLetterboxdCsv("Name,Year")).toEqual({ entries: [], issues: [] }));
  it("caps input characters and row count", () => {
    expect(() => parseLetterboxdCsv("x".repeat(MAX_IMPORT_CHARS + 1))).toThrow(/4 MiB/);
    expect(() =>
      parseLetterboxdCsv(`Name,Year\n${"A,2024\n".repeat(MAX_IMPORT_ROWS + 1)}`),
    ).toThrow(/5,000/);
  });
});
it("keeps separate dated rewatches of one Letterboxd work", () => {
  const result = parseLetterboxdCsv(
    `${lb}A,2025,2026-01-01,4,,No,https://letterboxd.com/film/a/\nA,2025,2026-02-01,4.5,,Yes,https://letterboxd.com/film/a/`,
  );
  expect(result.entries).toHaveLength(2);
  expect(result.issues).toEqual([]);
});
it("reports unsupported date spelling, blank required titles and impossible read counts", () => {
  expect(parseLetterboxdCsv(`${lb}A,2025,February 1,,,,`).issues).toHaveLength(1);
  expect(parseGoodreadsCsv(`${gr},,read,,,,,,,`).issues).toHaveLength(1);
  expect(parseGoodreadsCsv(`${gr}A,,read,,,9007199254740992,,,,`).issues).toHaveLength(1);
});
it("imports a Goodreads reread without treating its previous Date Read as this cycle's finish", () => {
  const result = parseGoodreadsCsv(
    `${gr}A,Aster,currently-reading,4,2025/03/01,2,42,2024,,A favourite`,
  );
  expect(result.issues).toEqual([]);
  expect(result.entries[0]).toMatchObject({
    status: "in-progress",
    repeatCount: 1,
    finished: undefined,
  });
});

it("matches realistic watched, ratings and diary exports by normalised title/year, not diary URLs", () => {
  const watched = parseLetterboxdCsv(
    "Date,Name,Year,Letterboxd URI\n2026-11-10,The Copper Shore,2025,https://letterboxd.com/film/the-copper-shore/",
  ).entries;
  const diary = parseLetterboxdCsv(
    "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Watched Date\n2026-11-10,The Copper Shore,2025,https://letterboxd.com/aster-fiction/film/the-copper-shore/1/,4.5,No,2026-11-09",
  ).entries;
  const ratings = parseLetterboxdCsv(
    "Date,Name,Year,Letterboxd URI,Rating\n2026-11-10,  THE COPPER SHORE  ,2025,https://letterboxd.com/film/the-copper-shore/,4.5",
  ).entries;
  const film = diary[0];
  const rated = ratings[0];
  if (!film || !rated) throw new Error("Missing fixture");
  expect(mediaImportDuplicate(film, watched)).toBe(true);
  expect(mediaImportDuplicate(rated, diary)).toBe(true);
  expect(mediaImportKey(film)).toBe(mediaImportKey(rated));
  expect(mediaImportDuplicate({ ...film, finished: "2026-11-11" }, diary)).toBe(false);
  expect(mediaImportDuplicate({ ...film, year: 2001 }, watched)).toBe(false);
  expect(mediaImportDuplicate({ ...film, kind: "book" }, watched)).toBe(false);
});
it.each([
  ["dnf", "abandoned"],
  ["paused", "in-progress"],
  ["special-shelf", "want"],
])("maps custom exclusive shelf %s without dropping the book", (shelf, status) => {
  const result = parseGoodreadsCsv(`${gr}The Orchard Letters,Aster Vale,${shelf},4,,,,,,`);
  expect(result.issues).toEqual([]);
  expect(result.entries[0]?.status).toBe(status);
});
it.each([
  "2026/02/30",
  "Not a date",
])("drops only an unreadable Goodreads Date Read: %s", (date) => {
  const result = parseGoodreadsCsv(
    `${gr}The Orchard Letters,Aster Vale,read,4,${date},1,42,2024,,A favourite`,
  );
  expect(result.issues).toEqual([]);
  expect(result.entries[0]).toMatchObject({
    title: "The Orchard Letters",
    status: "finished",
    finished: undefined,
    rating: 4,
  });
});
it("decodes valid UTF-8 and falls back to Windows-1252 for legacy exports with a notice", () => {
  expect(decodeMediaCsv(new TextEncoder().encode("Café"))).toEqual({
    text: "Café",
    legacyEncoding: false,
  });
  expect(decodeMediaCsv(new Uint8Array([67, 97, 102, 233]))).toEqual({
    text: "Café",
    legacyEncoding: true,
  });
  expect(() => decodeMediaCsv(new Uint8Array(MAX_IMPORT_CHARS + 1))).toThrow(/4 MiB/);
});
it.each([
  "want",
  "in-progress",
] as const)("matches a later diary completion to an undated %s record without skipping it", (status) => {
  const watchlist = parseLetterboxdCsv("Name,Year\nThe Copper Shore,2025", "want").entries[0];
  const diary = parseLetterboxdCsv(`${lb}The Copper Shore,2025,2026-11-09,4.5,A favourite,No,`)
    .entries[0];
  if (!watchlist || !diary) throw new Error("Missing fixture");
  const pending = { ...watchlist, status };
  const index = mediaImportIndex([pending]);
  expect(index.has(pending)).toBe(true);
  expect(index.has(diary)).toBe(false);
  expect(index.completionTarget(diary)).toBe(pending);
  expect(index.completionTarget(pending)).toBeUndefined();
  index.add(diary);
  expect(index.has(diary)).toBe(true);
  expect(index.completionTarget(diary)).toBeUndefined();
  const rewatch = { ...diary, finished: "2026-11-10" };
  expect(index.has(rewatch)).toBe(false);
  expect(index.completionTarget(rewatch)).toBeUndefined();
  expect(index.has({ ...diary, finished: undefined })).toBe(true);
});
it("updates a watchlist item from an undated finished export as well", () => {
  const [want] = parseLetterboxdCsv("Name,Year\nA,2025", "want").entries;
  const [finished] = parseLetterboxdCsv("Name,Year\nA,2025").entries;
  if (!want || !finished) throw new Error("Missing fixture");
  expect(mediaImportIndex([want]).completionTarget(finished)).toBe(want);
  expect(mediaImportIndex().completionTarget(finished)).toBeUndefined();
});
it("keeps a pending reread as a completion target alongside existing dated history in either order", () => {
  const pending = { title: "A", kind: "book" as const, status: "in-progress" as const };
  const history = { ...pending, status: "finished" as const, finished: "2025-01-01" };
  const completion = { ...history, finished: "2026-11-10" };
  for (const records of [
    [pending, history],
    [history, pending],
  ]) {
    const index = mediaImportIndex(records);
    expect(index.has(history)).toBe(true);
    expect(index.completionTarget(history)).toBeUndefined();
    expect(index.completionTarget(completion)).toBe(pending);
    index.add(completion);
    expect(index.completionTarget({ ...completion, finished: "2026-11-11" })).toBeUndefined();
  }
});
