// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { MAX_BODY_CHARS } from "../core/export-fields.js";
import { fileImport, memoryFile, streamedBytesFile, TEST_POD_ROOT } from "../core/testing.js";
import { Book, CLASSES } from "../core/vocab.js";
import { goodreadsFileAdapter } from "../goodreads/file-adapter.js";
import {
  readingDialect,
  readingStatus,
  starRating,
  storygraphFileAdapter,
} from "./file-adapter.js";

const DOC = `${TEST_POD_ROOT}integrations/storygraph/documents/storygraph-library.ttl`;
const GOODREADS_DOC = `${TEST_POD_ROOT}integrations/goodreads/documents/goodreads-library.ttl`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// Synthetic StoryGraph export (real column layout, invented values).
const HEADER =
  "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?";
const STORYGRAPH = `${HEADER}
Synthetic Dune,"Frank Synthetic, Second Author",,0441013597,paperback,read,2023/01/05,2023/01/20,2023/01/05-2023/01/20,1,adventurous,medium,Plot,Yes,Yes,No,Yes,4.25,"Loved it, ""truly""",,,"sci-fi, classics",Yes
Unfinished Book,Some Writer,,4f6c1a2e-0000-4000-8000-000000000000,ebook,did-not-finish,2023/02/01,,,0,,,,,,,,,,,,,No
Queued Book,Other Writer,,,audio,to-read,2023/03/01,,,0,,,,,,,,,,,,,No`;

/** One StoryGraph CSV row from named cells (quoted, in header order). */
function row(cells: Record<string, string>): string {
  return HEADER.split(",")
    .map((name) => `"${(cells[name] ?? "").replaceAll('"', '""')}"`)
    .join(",");
}

// Synthetic Open Library reading-log export.
const OPEN_LIBRARY = `Work Id,Title,Author(s),First Publish Year,Edition Id,ISBN 13,ISBN 10,Bookshelf,My Ratings,Date Added
OL123W,Library Book,Synthetic Author,1999,OL456M,,,Want to Read,,2024-05-01 10:00:00
,Edition Only,Synthetic Author,2001,OL789M,9780441013593,,Already Read,4,2024-05-02`;

function books(ds: DatasetCore): Book[] {
  return [...ds]
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === CLASSES.Book)
    .map((q) => new Book(q.subject.value, ds, DataFactory))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

describe("storygraph file adapter", () => {
  it("maps the StoryGraph export onto the Goodreads book model", async () => {
    const { pod, report } = await fileImport(
      storygraphFileAdapter,
      streamedBytesFile("storygraph.csv", STORYGRAPH),
    );
    expect(report.categories).toEqual(["documents"]);
    expect(report.written.map((w) => w.url)).toEqual([DOC]);
    const [queued, dune, unfinished] = books(pod.dataset(DOC));
    expect(dune?.name).toBe("Synthetic Dune");
    expect(dune?.author).toBe("Frank Synthetic, Second Author");
    expect(dune?.isbn).toBe("9780441013593");
    expect(dune?.readingStatus).toBe("read");
    expect(dune?.ratingValue).toBe(4.25);
    expect(dune?.reviewBody).toBe('Loved it, "truly"');
    expect([...(dune?.keywords ?? [])].sort()).toEqual(["classics", "sci-fi"]);
    expect(dune?.dateCreated?.toISOString().slice(0, 10)).toBe("2023-01-05");
    expect(unfinished?.readingStatus).toBe("did-not-finish");
    expect(unfinished?.isbn).toBeUndefined();
    expect(unfinished?.identifier).toBe("4f6c1a2e-0000-4000-8000-000000000000");
    expect(unfinished?.sourceUrl).toBeUndefined();
    expect(queued?.readingStatus).toBe("to-read");
    expect(queued?.ratingValue).toBeUndefined();
    expect(pod.get(report.indexUrl)).toContain(CLASSES.Book);
  });

  it("maps the Open Library reading log", async () => {
    const { pod } = await fileImport(
      storygraphFileAdapter,
      streamedBytesFile("OpenLibrary_ReadingLog.csv", OPEN_LIBRARY),
    );
    const [edition, work] = books(pod.dataset(DOC));
    expect(work?.identifier).toBe("OL123W");
    expect(work?.sourceUrl).toBe("https://openlibrary.org/works/OL123W");
    expect(work?.readingStatus).toBe("to-read");
    expect(work?.dateCreated?.toISOString().slice(0, 10)).toBe("2024-05-01");
    expect(edition?.sourceUrl).toBe("https://openlibrary.org/books/OL789M");
    expect(edition?.readingStatus).toBe("read");
    expect(edition?.ratingValue).toBe(4);
    expect(edition?.isbn).toBe("9780441013593");
  });

  it("dedups the same book across Goodreads and StoryGraph (ISBN-10 vs ISBN-13)", async () => {
    const goodreads = `Book Id,Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Date Added
12345,Dune,Frank Synthetic,"=""""","=""9780441013593""",5,read,2022/01/15
222,The Folded Title,Accent Writer,"=""""","=""""",3,read,2022/01/16`;
    const storygraph = [
      HEADER,
      row({
        Title: "Dune (Synthetic Saga, #1)",
        Authors: "Frank Synthetic",
        "ISBN/UID": "0-441-01359-7",
      }),
      row({ Title: "the  folded title!", Authors: "Accént Writer, Someone Else" }),
    ].join("\n");
    const { pod } = await fileImport(goodreadsFileAdapter, memoryFile("g.csv", goodreads));
    await fileImport(storygraphFileAdapter, streamedBytesFile("s.csv", storygraph), { pod });
    const local = (book: Book) => book.value.split("#")[1];
    const fromGoodreads = books(pod.dataset(GOODREADS_DOC));
    const fromStorygraph = books(pod.dataset(DOC));
    expect(fromStorygraph.map(local).sort()).toEqual(fromGoodreads.map(local).sort());
    const isbnBook = fromStorygraph.find((book) => book.isbn);
    expect(isbnBook?.isbn).toBe("9780441013593");
    expect(isbnBook && local(isbnBook)).toBe("book-isbn-9780441013593");
  });

  it("collapses duplicate rows without clearing earlier fields", async () => {
    const csv = [
      HEADER,
      row({
        Title: "Twice",
        Authors: "Writer",
        "ISBN/UID": "9780441013593",
        "Star Rating": "4",
        Review: "Kept review",
      }),
      row({ Title: "Twice again", Authors: "Writer", "ISBN/UID": "9780441013593", Tags: "extra" }),
    ].join("\n");
    const { pod, report } = await fileImport(
      storygraphFileAdapter,
      streamedBytesFile("s.csv", csv),
    );
    const [only] = books(pod.dataset(DOC));
    expect(books(pod.dataset(DOC))).toHaveLength(1);
    expect(only?.name).toBe("Twice again");
    expect(only?.reviewBody).toBe("Kept review");
    expect(only?.ratingValue).toBe(4);
    expect([...(only?.keywords ?? [])]).toEqual(["extra"]);
    expect(report.state?.counts.items).toBe(1);
  });

  it("re-imports idempotently", async () => {
    const file = streamedBytesFile("s.csv", STORYGRAPH);
    const { pod, report } = await fileImport(storygraphFileAdapter, file);
    const before = [...pod.dataset(DOC)].length;
    const again = await fileImport(storygraphFileAdapter, file, { pod });
    expect([...pod.dataset(DOC)].length).toBe(before);
    expect(again.report.state?.counts).toEqual(report.state?.counts);
  });

  it("skips and counts malformed rows and drops invalid values", async () => {
    const csv = [
      HEADER,
      row({ Authors: "No Title Author", "Read Status": "read", "Star Rating": "5" }),
      row({
        Title: "Bad Values",
        "ISBN/UID": "9780441013594",
        "Read Status": "READ   NOW!",
        "Date Added": "2023/02/30",
        "Star Rating": "Infinity",
      }),
      row({
        Title: "Too High",
        "Date Added": "1969/12/31",
        "Star Rating": "6",
        Review: "r".repeat(MAX_BODY_CHARS + 5),
      }),
      `${row({ Title: "Too many cells" })},extra`,
    ].join("\n");
    const { pod, report } = await fileImport(
      storygraphFileAdapter,
      streamedBytesFile("s.csv", csv, 4096),
    );
    expect(report.skipped).toBe(2);
    const [bad, high] = books(pod.dataset(DOC));
    expect(bad?.isbn).toBeUndefined(); // checksum fails
    expect(bad?.readingStatus).toBeUndefined();
    expect(bad?.dateCreated).toBeUndefined();
    expect(bad?.ratingValue).toBeUndefined();
    expect(high?.ratingValue).toBeUndefined();
    expect(high?.dateCreated).toBeUndefined();
    expect(high?.reviewBody?.length).toBe(MAX_BODY_CHARS);
  });

  it("refuses CSVs that are not StoryGraph or Open Library exports", async () => {
    await expect(
      fileImport(
        storygraphFileAdapter,
        memoryFile("goodreads.csv", "Book Id,Title,Author,Exclusive Shelf\n1,X,Y,read"),
      ),
    ).rejects.toThrow("not a StoryGraph or Open Library");
  });
});

describe("storygraph helpers", () => {
  it("normalises statuses, ratings and dialects", () => {
    expect(readingStatus("Currently Reading")).toBe("currently-reading");
    expect(readingStatus("paused")).toBe("paused");
    expect(readingStatus("constructor")).toBe("constructor");
    expect(readingStatus("__proto__")).toBeUndefined();
    expect(readingStatus("")).toBeUndefined();
    expect(starRating("3.75")).toBe(3.75);
    for (const raw of ["0", "-1", "5.01", "NaN", "Infinity", "1e0", undefined])
      expect(starRating(raw), String(raw)).toBeUndefined();
    expect(readingDialect(["Title", "Read Status"])).toBe("storygraph");
    expect(readingDialect(["Work ID", "Title"])).toBe("openlibrary");
    expect(() => readingDialect(["Title"])).toThrow();
  });
});
