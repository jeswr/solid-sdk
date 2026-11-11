// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_CHARS,
  MAX_IMPORT_ROWS,
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
    "A,,unknown,,,,,,,",
    "A,,read,6,,,,,,",
    "A,,read,,2026/2/29,,,,,",
    "A,,read,,,1.5,,,,",
    "A,,read,,,,../bad,,,",
    "A,,read,,,,,,2026x,",
    "A,,want,,2026/1/1,,,,,",
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
