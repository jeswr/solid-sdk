// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { strToU8, zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { MAX_TITLE_CHARS } from "../core/export-fields.js";
import { MAX_FILE_BYTES } from "../core/file-import.js";
import { MAX_CSV_RECORD_BYTES } from "../core/file-stream.js";
import { fileImport, memoryFile, streamedBytesFile, TEST_POD_ROOT } from "../core/testing.js";
import { CLASSES, Movie, WatchAction } from "../core/vocab.js";
import {
  letterboxdCsvKind,
  letterboxdEntryKind,
  letterboxdFileAdapter,
  letterboxdRating,
  letterboxdUrl,
} from "./file-adapter.js";

const ROOT = `${TEST_POD_ROOT}integrations/letterboxd/`;
const DIARY_DOC = `${ROOT}media/letterboxd-diary.ttl`;
const WATCHLIST_DOC = `${ROOT}media/letterboxd-watchlist.ttl`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// Synthetic export rows only (invented films, links and dates).
const DIARY = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-03,Synthetic Orbit,2019,https://boxd.it/aaa01,4.5,,"space, cosy",2024-01-02
2024-02-10,Synthetic Orbit,2019,https://boxd.it/aaa02,5,Yes,,2024-02-09
2024-03-01,"Quiet, Loud",2021,https://boxd.it/aaa03,,,,2024-02-28`;
const REVIEWS = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
2024-01-03,Synthetic Orbit,2019,https://boxd.it/aaa01,4.5,,"A ""synthetic"" review,
over two lines",,2024-01-02`;
const WATCHED = `Date,Name,Year,Letterboxd URI
2023-12-01,Synthetic Orbit,2019,https://boxd.it/film01
2023-12-02,Never Logged,2001,https://boxd.it/film02`;
const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2023-12-02,Never Logged,2001,https://boxd.it/film02,3`;
const WATCHLIST = `Date,Name,Year,Letterboxd URI
2024-04-01,Someday Film,2024,https://boxd.it/film03`;

function zipFile(entries: Record<string, string | Uint8Array>, level: 0 | 6 = 6) {
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        name,
        typeof value === "string" ? strToU8(value) : value,
      ]),
    ),
    { level },
  );
  return { zip, file: streamedBytesFile("letterboxd-export.zip", zip, 97, "application/zip") };
}

function subjectsOf(ds: DatasetCore, type: string) {
  return [...ds]
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === type)
    .map((q) => q.subject.value)
    .sort();
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}

function watchByUri(ds: DatasetCore, uri: string): string {
  const quad = [...ds].find(
    (q) => q.predicate.value === "https://schema.org/url" && q.object.value === uri,
  );
  return required(quad?.subject.value);
}

describe("letterboxd file adapter", () => {
  it("maps diary entries to watch actions linked to films", async () => {
    const { pod, report } = await fileImport(
      letterboxdFileAdapter,
      streamedBytesFile("diary.csv", DIARY),
    );
    expect(report.categories).toEqual(["media"]);
    expect(report.written.map((w) => w.url)).toEqual([DIARY_DOC]);
    const ds = pod.dataset(DIARY_DOC);
    expect(subjectsOf(ds, CLASSES.WatchAction)).toHaveLength(3);
    expect(subjectsOf(ds, CLASSES.Movie)).toHaveLength(2);
    const first = new WatchAction(watchByUri(ds, "https://boxd.it/aaa01"), ds, DataFactory);
    expect(first.name).toBe("Synthetic Orbit");
    expect(first.startTime?.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    expect(first.dateCreated?.toISOString()).toBe("2024-01-03T00:00:00.000Z");
    expect(first.ratingValue).toBe(4.5);
    expect(first.rewatch).toBe(false);
    expect([...first.keywords].sort()).toEqual(["cosy", "space"]);
    const film = new Movie(required(first.watchedWork), ds, DataFactory);
    expect(film.name).toBe("Synthetic Orbit");
    expect(film.copyrightYear).toBe(2019);
    expect(film.watchStatus).toBe("watched");
    const second = new WatchAction(watchByUri(ds, "https://boxd.it/aaa02"), ds, DataFactory);
    expect(second.rewatch).toBe(true);
    expect(second.ratingValue).toBe(5);
    expect(second.watchedWork).toBe(first.watchedWork);
    expect(pod.get(report.indexUrl)).toContain(CLASSES.WatchAction);
  });

  it("imports the whole export ZIP, merging reviews and ignoring other entries", async () => {
    const { file } = zipFile({
      "watchlist.csv": WATCHLIST,
      "ratings.csv": RATINGS,
      "reviews.csv": REVIEWS,
      "watched.csv": WATCHED,
      "diary.csv": DIARY,
      "profile.csv": "Date Joined,Username\n2020-01-01,synthetic",
      "deleted/diary.csv": DIARY.replace("aaa03", "zzz99").replace("Quiet, Loud", "Deleted Film"),
      "lists/synthetic.csv": "Letterboxd list export v7\n",
      "likes/films.csv": WATCHED,
    });
    const { pod, report } = await fileImport(letterboxdFileAdapter, file);
    expect(report.written.map((w) => w.url).sort()).toEqual([DIARY_DOC, WATCHLIST_DOC]);
    expect(report.skipped).toBeUndefined();
    const ds = pod.dataset(DIARY_DOC);
    // The review merged into the logged entry instead of adding a fourth viewing.
    expect(subjectsOf(ds, CLASSES.WatchAction)).toHaveLength(3);
    const reviewed = new WatchAction(watchByUri(ds, "https://boxd.it/aaa01"), ds, DataFactory);
    expect(reviewed.reviewBody).toBe('A "synthetic" review,\nover two lines');
    expect([...reviewed.keywords].sort()).toEqual(["cosy", "space"]);
    const names = [...ds]
      .filter((q) => q.predicate.value === "https://schema.org/name")
      .map((q) => q.object.value);
    expect(names).not.toContain("Deleted Film");
    // A film from watched.csv/ratings.csv carries its film link and the film rating.
    const never = subjectsOf(ds, CLASSES.Movie)
      .map((iri) => new Movie(iri, ds, DataFactory))
      .find((film) => film.name === "Never Logged");
    expect(never?.sourceUrl).toBe("https://boxd.it/film02");
    expect(never?.ratingValue).toBe(3);
    expect(never?.watchStatus).toBe("watched");
    const watchlist = pod.dataset(WATCHLIST_DOC);
    const [someday] = subjectsOf(watchlist, CLASSES.Movie);
    const film = new Movie(required(someday), watchlist, DataFactory);
    expect(film.watchStatus).toBe("watchlist");
    expect(film.dateCreated?.toISOString().slice(0, 10)).toBe("2024-04-01");
    expect(pod.get(report.indexUrl)).toContain(CLASSES.Movie);
  });

  it("re-imports idempotently with deterministic subjects", async () => {
    const { file } = zipFile({ "diary.csv": DIARY, "watchlist.csv": WATCHLIST });
    const { pod, report } = await fileImport(letterboxdFileAdapter, file);
    const before = report.written.map((w) => [...pod.dataset(w.url)].length);
    const subjects = subjectsOf(pod.dataset(DIARY_DOC), CLASSES.WatchAction);
    const again = await fileImport(letterboxdFileAdapter, file, { pod });
    expect(again.report.written.map((w) => [...pod.dataset(w.url)].length)).toEqual(before);
    expect(subjectsOf(pod.dataset(DIARY_DOC), CLASSES.WatchAction)).toEqual(subjects);
    expect(again.report.state?.counts).toEqual(report.state?.counts);
  });

  it("dedups repeated rows and merges reviews without a URI by film and date", async () => {
    const noUri = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-03,Synthetic Orbit,2019,,4,,,2024-01-02
2024-01-03,Synthetic Orbit,2019,,4,,,2024-01-02`;
    const review = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
2024-01-03,Synthetic Orbit,2019,,,,Merged by date,,2024-01-02`;
    const { file } = zipFile({ "diary.csv": noUri, "reviews.csv": review });
    const { pod } = await fileImport(letterboxdFileAdapter, file);
    const ds = pod.dataset(DIARY_DOC);
    const [only] = subjectsOf(ds, CLASSES.WatchAction);
    expect(subjectsOf(ds, CLASSES.WatchAction)).toHaveLength(1);
    const event = new WatchAction(required(only), ds, DataFactory);
    expect(event.reviewBody).toBe("Merged by date");
    // The review row had no rating: the diary's rating survives.
    expect(event.ratingValue).toBe(4);
  });

  it("skips and counts malformed rows, dropping invalid values", async () => {
    const csv = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-03,,2019,https://boxd.it/x1,4,,,2024-01-02
2024-02-30,Bad Values,3000,https://boxd.it/x2,7,,,1969-12-31
2024-01-05,Infinite,2019,https://boxd.it/x3,Infinity,,,2024-13-01
${"x".repeat(MAX_CSV_RECORD_BYTES + 1)}
2024-01-06,Good,2019,https://boxd.it/x4,0.5,,,2024-01-06`;
    const { pod, report } = await fileImport(
      letterboxdFileAdapter,
      streamedBytesFile("diary.csv", csv, 4096),
    );
    expect(report.skipped).toBe(2);
    expect(report.state?.counts.skipped).toBe(2);
    const ds = pod.dataset(DIARY_DOC);
    const bad = new WatchAction(watchByUri(ds, "https://boxd.it/x2"), ds, DataFactory);
    expect(bad.ratingValue).toBeUndefined();
    expect(bad.startTime).toBeUndefined();
    expect(bad.dateCreated).toBeUndefined();
    expect(new Movie(required(bad.watchedWork), ds, DataFactory).copyrightYear).toBeUndefined();
    const infinite = new WatchAction(watchByUri(ds, "https://boxd.it/x3"), ds, DataFactory);
    expect(infinite.ratingValue).toBeUndefined();
    expect(infinite.startTime).toBeUndefined();
    const good = new WatchAction(watchByUri(ds, "https://boxd.it/x4"), ds, DataFactory);
    expect(good.ratingValue).toBe(0.5);
  });

  it("caps long names and refuses links outside Letterboxd", async () => {
    const long = "N".repeat(MAX_TITLE_CHARS + 50);
    const csv = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-03,${long},2019,javascript:alert(1),,,,2024-01-02
2024-01-04,Elsewhere,2019,https://evil.example/boxd.it,,,,2024-01-04
2024-01-05,Data,2019,"data:text/html;base64,PHNjcmlwdD4=",,,,2024-01-05`;
    const { pod } = await fileImport(letterboxdFileAdapter, streamedBytesFile("diary.csv", csv));
    const ds = pod.dataset(DIARY_DOC);
    const urls = [...ds].filter((q) => q.predicate.value === "https://schema.org/url");
    expect(urls).toEqual([]);
    const names = [...ds]
      .filter((q) => q.predicate.value === "https://schema.org/name")
      .map((q) => q.object.value);
    expect(names).toContain("N".repeat(MAX_TITLE_CHARS));
    expect(subjectsOf(ds, CLASSES.WatchAction)).toHaveLength(3);
  });

  it("counts corrupt archive entries instead of importing them", async () => {
    const { zip } = zipFile({ "diary.csv": DIARY, "ratings.csv": RATINGS }, 0);
    // Stored (level 0) data: flip a byte of ratings.csv so its CRC no longer matches.
    const text = new TextDecoder("latin1").decode(zip);
    const at = text.indexOf("Never Logged,2001,https://boxd.it/film02,3");
    const corrupt = zip.slice();
    corrupt[at] = "M".charCodeAt(0);
    const { pod, report } = await fileImport(
      letterboxdFileAdapter,
      streamedBytesFile("export.zip", corrupt, 97),
    );
    expect(report.skipped).toBe(1);
    const names = [...pod.dataset(DIARY_DOC)]
      .filter((q) => q.predicate.value === "https://schema.org/name")
      .map((q) => q.object.value);
    expect(names).not.toContain("Never Logged");
    expect(names).not.toContain("Mever Logged");
  });

  it("enforces the 64 MiB stream cap on a standalone CSV it streams itself", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
    let pulls = 0;
    const file = {
      name: "diary.csv",
      type: "text/csv",
      size: (MAX_FILE_BYTES / chunk.length + 2) * chunk.length,
      text: () => Promise.reject(new Error("must stream")),
      stream: () => {
        let first = true;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            if (first) {
              first = false;
              controller.enqueue(strToU8("Date,Name,Year,Letterboxd URI,Watched Date\n"));
            } else controller.enqueue(chunk);
          },
        });
      },
    };
    expect(letterboxdFileAdapter.streaming).toBe(true);
    await expect(fileImport(letterboxdFileAdapter, file)).rejects.toThrow("64 MiB");
    expect(pulls).toBeLessThan(MAX_FILE_BYTES / chunk.length + 8);
  });

  it("refuses an archive through the text-only port and non-Letterboxd CSVs", async () => {
    await expect(
      fileImport(
        letterboxdFileAdapter,
        memoryFile("export.zip", "PK\u0003\u0004", "application/zip"),
      ),
    ).rejects.toThrow("require file.stream()");
    await expect(
      fileImport(letterboxdFileAdapter, memoryFile("other.csv", "Title,Date\nX,2024-01-01")),
    ).rejects.toThrow("not a Letterboxd");
  });

  it("accepts a standalone CSV through the text-only port", async () => {
    const { pod } = await fileImport(
      letterboxdFileAdapter,
      memoryFile("my-watchlist.csv", WATCHLIST, "text/csv"),
    );
    expect(subjectsOf(pod.dataset(WATCHLIST_DOC), CLASSES.Movie)).toHaveLength(1);
  });
});

describe("letterboxd helpers", () => {
  it("selects only the five root files (or one re-zipped folder)", () => {
    expect(letterboxdEntryKind("diary.csv")).toBe("diary");
    expect(letterboxdEntryKind("Watchlist.CSV")).toBe("watchlist");
    expect(letterboxdEntryKind("letterboxd-synthetic-2024/ratings.csv")).toBe("ratings");
    for (const name of [
      "deleted/diary.csv",
      "orphaned/reviews.csv",
      "../diary.csv",
      "/diary.csv",
      "a/b/diary.csv",
      "letterboxd-x\\diary.csv",
      "profile.csv",
      "diary.csv.exe",
    ])
      expect(letterboxdEntryKind(name), name).toBeUndefined();
  });

  it("detects a standalone CSV by name, else by header", () => {
    expect(letterboxdCsvKind("watched.csv", [])).toBe("watched");
    expect(letterboxdCsvKind("x.csv", ["Name", "Review", "Watched Date"])).toBe("reviews");
    expect(letterboxdCsvKind("x.csv", ["Name", "Watched Date"])).toBe("diary");
    expect(letterboxdCsvKind("x.csv", ["Name", "Rating"])).toBe("ratings");
    expect(letterboxdCsvKind("old-watchlist.csv", ["Name", "Letterboxd URI"])).toBe("watchlist");
    expect(letterboxdCsvKind("x.csv", ["Name", "Letterboxd URI"])).toBe("watched");
    expect(letterboxdCsvKind("x.csv", ["Name"])).toBeUndefined();
    expect(letterboxdCsvKind("x.csv", ["Title"])).toBeUndefined();
  });

  it("keeps half-star ratings and Letterboxd links only", () => {
    expect(letterboxdRating("3.5")).toBe(3.5);
    for (const raw of ["0", "5.5", "3.25", "-1", "NaN", "1e1", "", undefined])
      expect(letterboxdRating(raw), String(raw)).toBeUndefined();
    expect(letterboxdUrl("https://letterboxd.com/synthetic/film/x/")).toBe(
      "https://letterboxd.com/synthetic/film/x/",
    );
    expect(letterboxdUrl("https://boxd.it.evil.example/x")).toBeUndefined();
    expect(letterboxdUrl("https://user:pw@boxd.it/x")).toBeUndefined();
  });
});
