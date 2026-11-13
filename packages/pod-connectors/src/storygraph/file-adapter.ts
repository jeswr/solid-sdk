// AUTHORED-BY Claude Opus 5.5
/**
 * The StoryGraph (and Open Library) → Documents (Tier-C file import).
 *
 * StoryGraph's Manage Account → Export StoryGraph Library gives a CSV with
 * `Title, Authors, Contributors, ISBN/UID, Format, Read Status, Date Added,
 * Last Date Read, Dates Read, Read Count, …, Star Rating, Review, …, Tags, Owned?`.
 * Open Library's reading-log export (My Books → Export) is a CSV keyed by
 * `Work Id`/`Edition Id` with `Title`, `Author(s)`, `ISBN 13`/`ISBN 10`, `Bookshelf`
 * ("Want to Read", "Currently Reading", "Already Read"), a rating and `Date Added`.
 * The header row selects the dialect; other CSVs are refused. Each dialect has its own
 * document (`documents/storygraph-library.ttl`, `documents/openlibrary-library.ttl`), so
 * importing one service's export never replaces the other's books.
 *
 * Both map onto the Goodreads book model (`schema:Book` in Documents) through the shared
 * book identity (core/books.ts): the same book from Goodreads and StoryGraph has the same
 * `#book-…` fragment and the same ISBN-13 (ISBN-10 is converted), else the same folded
 * title and first author. Duplicate rows collapse onto one book. Mapped: title, first
 * author list, ISBN, status, 0–5 star rating (quarter stars kept), review, tags and the
 * date added. Read dates, moods and `Owned?` have no term in the book model and are not
 * imported.
 */
import { DataFactory, Store } from "n3";
import { bookFragment, isbn13, primaryAuthor } from "../core/books.js";
import {
  cappedText,
  finiteNumber,
  MAX_BODY_CHARS,
  MAX_NAME_CHARS,
  MAX_TITLE_CHARS,
  parseDateOnly,
  tagList,
} from "../core/export-fields.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { csvRows } from "../core/file-stream.js";
import { sourceItemUrl } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { Book, CLASSES } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "storygraph";
const SLUGS: Readonly<Record<ReadingDialect, string>> = {
  storygraph: "documents/storygraph-library.ttl",
  openlibrary: "documents/openlibrary-library.ttl",
};

const metadata: IntegrationMetadata = {
  id: ID,
  name: "The StoryGraph",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["documents"],
  whatYouGet:
    "Your StoryGraph or Open Library reading log, ratings and reviews, saved as books in Documents.",
  requirements: [],
};

export type ReadingDialect = "storygraph" | "openlibrary";

export const storygraphFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".csv,text/csv",
  fileHint:
    "The StoryGraph → Manage Account → Export StoryGraph Library, or Open Library → My Books → Export reading log. Select the downloaded CSV.",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your library…", done: 0, total: 1 });
    let doc = "";
    const store = new Store();
    const books = new Set<string>();
    let dialect: ReadingDialect | undefined;
    let rows = 0;
    for await (const row of csvRows(file, ctx.skip)) {
      if (!dialect) {
        dialect = readingDialect(Object.keys(row));
        doc = ctx.resolve(SLUGS[dialect]);
      }
      if (rows >= ctx.maxRows) break;
      rows++;
      const title = cappedText(field(row, "Title"), MAX_TITLE_CHARS);
      if (!title) {
        ctx.skip();
        continue;
      }
      const authors = cappedText(field(row, "Authors", "Author(s)", "Author"), MAX_NAME_CHARS);
      const rawIsbn =
        dialect === "storygraph"
          ? field(row, "ISBN/UID")
          : (field(row, "ISBN 13", "ISBN13") ?? field(row, "ISBN 10", "ISBN10", "ISBN"));
      const isbn = isbn13(rawIsbn);
      const fragment = bookFragment(title, primaryAuthor(authors), isbn);
      books.add(fragment);
      // A duplicate row updates only the fields it carries; it never clears earlier ones.
      const book = new Book(`${doc}#book-${fragment}`, store, DataFactory).mark();
      book.name = title;
      if (authors) book.author = authors;
      if (isbn) book.isbn = isbn;
      const id = dialect === "storygraph" ? storygraphUid(rawIsbn, isbn) : openLibraryId(row);
      if (id) book.identifier = id.identifier;
      if (id?.url) book.sourceUrl = id.url;
      const status = readingStatus(field(row, "Read Status", "Bookshelf", "Shelf"));
      if (status) book.readingStatus = status;
      const rating = starRating(field(row, "Star Rating", "My Ratings", "My Rating", "Rating"));
      if (rating !== undefined) book.ratingValue = rating;
      const review = cappedText(field(row, "Review"), MAX_BODY_CHARS);
      if (review) book.reviewBody = review;
      for (const tag of tagList(field(row, "Tags"), ",")) book.keywords.add(tag);
      const added = parseDateOnly(field(row, "Date Added", "Logged Date")?.trim().split(/[ T]/)[0]);
      if (added) book.dateCreated = added;
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    if (books.size === 0 || !dialect) return;
    await ctx.write({
      slug: SLUGS[dialect],
      category: "documents",
      forClass: CLASSES.Book,
      dataset: store,
    });
  },
};

/** The export dialect from its header row; any other CSV is refused before mapping. */
export function readingDialect(headers: readonly string[]): ReadingDialect {
  if (headers.includes("Read Status") || headers.includes("ISBN/UID")) return "storygraph";
  if (headers.includes("Bookshelf") || headers.includes("Work Id") || headers.includes("Work ID"))
    return "openlibrary";
  throw new Error("This CSV is not a StoryGraph or Open Library reading-log export.");
}

/** The first present column among `names`, read as an own property only. */
function field(row: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    if (Object.hasOwn(row, name) && row[name]) return row[name];
  }
  return undefined;
}

const OPEN_LIBRARY_SHELVES: Readonly<Record<string, string>> = {
  "want to read": "to-read",
  "currently reading": "currently-reading",
  "already read": "read",
};

/** StoryGraph statuses pass through (`read`, `to-read`, `did-not-finish`, …); OL shelves map. */
export function readingStatus(raw: string | undefined): string | undefined {
  const label = raw?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!label) return undefined;
  if (Object.hasOwn(OPEN_LIBRARY_SHELVES, label)) return OPEN_LIBRARY_SHELVES[label];
  const status = label.replace(/[\s_]+/g, "-");
  return /^[a-z][a-z-]{0,63}$/.test(status) ? status : undefined;
}

/** Up to five stars, fractional stars kept; zero, negative and non-finite values omitted. */
export function starRating(raw: string | undefined): number | undefined {
  const value = finiteNumber(raw);
  return value !== undefined && value > 0 && value <= 5 ? value : undefined;
}

/** A StoryGraph UID that is not an ISBN is kept as an inert identifier (no URL is built). */
function storygraphUid(
  raw: string | undefined,
  isbn: string | undefined,
): { identifier: string; url?: string } | undefined {
  const uid = raw?.trim();
  if (isbn || !uid || !/^[A-Za-z0-9-]{1,128}$/.test(uid)) return undefined;
  return { identifier: uid };
}

/** Open Library work (`OL…W`) or edition (`OL…M`) id, linked under openlibrary.org. */
function openLibraryId(
  row: Record<string, string>,
): { identifier: string; url?: string } | undefined {
  const work = field(row, "Work Id", "Work ID")?.trim();
  if (work && /^OL\d{1,12}W$/.test(work))
    return { identifier: work, url: sourceItemUrl("https://openlibrary.org/works/", work) };
  const edition = field(row, "Edition Id", "Edition ID")?.trim();
  if (edition && /^OL\d{1,12}M$/.test(edition))
    return { identifier: edition, url: sourceItemUrl("https://openlibrary.org/books/", edition) };
  return undefined;
}
