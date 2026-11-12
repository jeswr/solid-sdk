// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * Goodreads → Documents (Tier-C file import).
 *
 * Goodreads "Export Library" gives `goodreads_library_export.csv`. The
 * load-bearing columns are `Book Id, Title, Author, ISBN, ISBN13, My Rating,
 * Exclusive Shelf, Date Read, Date Added`. ISBNs are wrapped by Goodreads as
 * `="0123456789"` to stop spreadsheets mangling them — we strip that wrapper.
 * Each book becomes a `schema:Book` in Documents, with the reader's rating and
 * shelf (read / currently-reading / to-read).
 *
 * Parsed natively (no dependency).
 */
import { DataFactory, Store } from "n3";
import { bookFragment, isbn13 } from "../core/books.js";
import { parseDateOnly } from "../core/export-fields.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { csvRows } from "../core/file-stream.js";
import { sourceItemUrl } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { Book, CLASSES } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "goodreads";

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Goodreads",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["documents"],
  whatYouGet: "Your reading library and ratings, saved as books in Documents.",
  requirements: [],
};

export const goodreadsFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".csv,text/csv",
  fileHint:
    "Goodreads → My Books → Import and export → Export Library. Select goodreads_library_export.csv.",
  exportUrl: "https://www.goodreads.com/review/import",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your library…", done: 0, total: 1 });

    const doc = ctx.resolve("documents/goodreads-library.ttl");
    const store = new Store();
    let count = 0;
    for await (const row of csvRows(file, ctx.skip)) {
      if (count >= ctx.maxRows) break;
      const title = row.Title?.trim();
      if (!title) continue;
      const bookId = row["Book Id"]?.trim();
      const author = row.Author?.trim();
      // Normalised ISBN-13 when valid, so the same book shares its identity with StoryGraph.
      const normalisedIsbn = isbn13(row.ISBN13) ?? isbn13(row.ISBN);
      const frag = bookFragment(title, author, normalisedIsbn);
      const book = new Book(`${doc}#book-${frag}`, store, DataFactory).mark();
      book.name = title;
      if (bookId) {
        book.identifier = bookId;
        book.sourceUrl = sourceItemUrl("https://www.goodreads.com/book/show/", bookId);
      }
      if (author) book.author = author;
      const isbn = normalisedIsbn ?? (cleanIsbn(row.ISBN13) || cleanIsbn(row.ISBN));
      if (isbn) book.isbn = isbn;
      const rating = Number.parseInt(row["My Rating"] ?? "", 10);
      if (Number.isFinite(rating) && rating > 0) book.ratingValue = rating;
      const shelf = row["Exclusive Shelf"]?.trim();
      if (shelf) book.readingStatus = shelf;
      const added = parseDateOnly(row["Date Added"]);
      if (added) book.dateCreated = added;
      count++;
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    await ctx.write({
      slug: "documents/goodreads-library.ttl",
      category: "documents",
      forClass: CLASSES.Book,
      dataset: store,
    });
  },
};

/** Goodreads wraps ISBNs as `="0123456789"`; unwrap and validate digits. */
export function cleanIsbn(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const inner = raw
    .trim()
    .replace(/^="?|"?$/g, "")
    .trim();
  return /^[0-9Xx]{10,13}$/.test(inner) ? inner : undefined;
}

/** Goodreads dates are `YYYY/MM/DD`; the shared strict parser also keeps 1970..2100 only. */
export { parseDateOnly };
