// AUTHORED-BY Claude Opus 5.5
/**
 * Letterboxd → Media (Tier-C file import).
 *
 * Letterboxd's Settings → Data → Export your data gives a ZIP of CSV files. The
 * importer reads the five root-level files that describe the user's viewing:
 *
 *   diary.csv     `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date`
 *   reviews.csv   `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date`
 *   watched.csv   `Date,Name,Year,Letterboxd URI`
 *   ratings.csv   `Date,Name,Year,Letterboxd URI,Rating`
 *   watchlist.csv `Date,Name,Year,Letterboxd URI`
 *
 * Each diary or review entry becomes a `schema:WatchAction` (the class Netflix and
 * Twitch use) with the watched date, the 0.5–5 star rating, the rewatch flag, tags and
 * review text, linked through `schema:object` to a `schema:Movie` for the film (name and
 * release year). Watched and rated films are films with the status `watched`; watchlist
 * films go to a separate document with the status `watchlist`. A review of a logged
 * entry merges into that entry: by its Letterboxd URI, else by film and watched date.
 *
 * The archive is read with the shared bounded ZIP reader (size, CRC, DEFLATE-boundary
 * and total-inflation checks); other files and subfolders (`deleted/`, `lists/`, …) are
 * never inflated. A single extracted CSV is also accepted: its file name, else its
 * header row, selects the kind (`watchlist` only by name: its header equals watched.csv's).
 */
import { DataFactory, Store } from "n3";
import {
  cappedText,
  finiteNumber,
  httpUrl,
  MAX_BODY_CHARS,
  MAX_TITLE_CHARS,
  parseDateOnly,
  tagList,
} from "../core/export-fields.js";
import {
  type FileImportAdapter,
  type FileImportContext,
  type ImportFile,
  MAX_FILE_BYTES,
} from "../core/file-import.js";
import { csvRows, csvRowsFromChunks } from "../core/file-stream.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES, Movie, WatchAction } from "../core/vocab.js";
import {
  cappedSink,
  InflationBudget,
  readZip,
  zipDirectory,
} from "../google-takeout/zip-reader.js";
import { vocabMap } from "./vocab-map.js";

const ID = "letterboxd";
const DIARY = "media/letterboxd-diary.ttl";
const WATCHLIST = "media/letterboxd-watchlist.ttl";

/** Central-directory records read from an archive (Letterboxd exports hold a few hundred). */
export const MAX_LETTERBOXD_ZIP_ENTRIES = 10_000;
/** Inflated bytes across every selected CSV in one archive. */
export const MAX_LETTERBOXD_INFLATED_BYTES = 256 * 1024 * 1024;

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Letterboxd",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["media"],
  whatYouGet: "Your film diary, ratings, reviews and watchlist, saved as films in Media.",
  requirements: [],
};

export type LetterboxdKind = "diary" | "reviews" | "watched" | "ratings" | "watchlist";
const KINDS: readonly LetterboxdKind[] = ["diary", "reviews", "watched", "ratings", "watchlist"];

export const letterboxdFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".zip,application/zip,.csv,text/csv",
  // Byte limits are enforced here: the ZIP reader bounds the directory, each selected entry
  // and total inflation; a standalone CSV is capped by the shared 64 MiB stream reader.
  streaming: true,
  fileHint:
    "Letterboxd → Settings → Data → Export your data. Select the downloaded .zip (no need to unzip), or one of its CSV files such as diary.csv.",
  exportUrl: "https://letterboxd.com/settings/data/",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your Letterboxd export…", done: 0, total: 1 });
    const library = new LetterboxdLibrary(ctx);
    if (await isZipArchive(file)) await importArchive(file, ctx, library);
    else await library.rows(csvRows(file, ctx.skip), file.name);
    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    await library.save();
  },
};

/** Sniff the ZIP signature, never trusting the name; the text-only port cannot carry one. */
async function isZipArchive(file: ImportFile): Promise<boolean> {
  if (!file.stream) {
    if (/\.zip$/i.test(file.name) || file.type === "application/zip")
      throw new Error("Letterboxd ZIP imports require file.stream().");
    return false;
  }
  const reader = file.stream().getReader();
  const signature: number[] = [];
  try {
    while (signature.length < 4) {
      const next = await reader.read();
      if (next.done) break;
      for (const byte of next.value.subarray(0, 4 - signature.length)) signature.push(byte);
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
  return signature.join(",") === "80,75,3,4";
}

/**
 * The kind of an archive entry: one of the five files at the archive root, or inside a
 * single `letterboxd-…` folder (a re-zipped export). Anything else, including
 * `deleted/diary.csv`, traversal and absolute names, is ignored.
 */
export function letterboxdEntryKind(name: string): LetterboxdKind | undefined {
  if (name.includes("\\") || name.includes("\0")) return undefined;
  const match = name.match(/^(?:(letterboxd-[^/]+)\/)?([a-z]+)\.csv$/i);
  if (!match) return undefined;
  const kind = (match[2] as string).toLowerCase() as LetterboxdKind;
  return KINDS.includes(kind) ? kind : undefined;
}

async function importArchive(
  file: ImportFile,
  ctx: FileImportContext,
  library: LetterboxdLibrary,
): Promise<void> {
  if (!file.slice) throw new Error("Letterboxd ZIP imports require file.slice().");
  const entries = (await zipDirectory(file, MAX_LETTERBOXD_ZIP_ENTRIES))
    .filter((entry) => letterboxdEntryKind(entry.name) !== undefined)
    // Diary entries first, so reviews merge into them and watched films know their events.
    .sort(
      (a, b) =>
        KINDS.indexOf(letterboxdEntryKind(a.name) as LetterboxdKind) -
        KINDS.indexOf(letterboxdEntryKind(b.name) as LetterboxdKind),
    );
  const decoder = new TextDecoder();
  await readZip(
    file,
    {
      inflationBudget: new InflationBudget(MAX_LETTERBOXD_INFLATED_BYTES),
      limit: () => MAX_FILE_BYTES,
      // Corrupt or oversized entries are counted, never partially imported.
      skip: () => ctx.skip(),
      entry: (name) =>
        cappedSink(MAX_FILE_BYTES, async (bytes) => {
          if (!bytes) {
            ctx.skip();
            return;
          }
          ctx.signal?.throwIfAborted();
          const text = decoder.decode(bytes);
          await library.rows(
            csvRowsFromChunks(
              (async function* () {
                yield text;
              })(),
              ctx.skip,
            ),
            name,
            letterboxdEntryKind(name),
          );
        }),
    },
    entries,
  );
}

/** Kind of a standalone CSV: its exact file name, else its header row. */
export function letterboxdCsvKind(
  fileName: string,
  headers: readonly string[],
): LetterboxdKind | undefined {
  const base = (fileName.split(/[/\\]/).pop() ?? "").toLowerCase();
  const named = KINDS.find((kind) => base === `${kind}.csv`);
  if (named) return named;
  const has = (header: string) => headers.includes(header);
  if (!has("Name")) return undefined;
  if (has("Review")) return "reviews";
  if (has("Watched Date")) return "diary";
  if (has("Rating")) return "ratings";
  if (base.includes("watchlist")) return "watchlist";
  return has("Letterboxd URI") ? "watched" : undefined;
}

/** Letterboxd's own links only (boxd.it short links or letterboxd.com pages). */
export function letterboxdUrl(raw: string | undefined): string | undefined {
  const url = httpUrl(raw);
  if (!url) return undefined;
  const host = new URL(url).hostname;
  return host === "boxd.it" || host === "letterboxd.com" || host.endsWith(".letterboxd.com")
    ? url
    : undefined;
}

/** Letterboxd ratings are half stars from 0.5 to 5; anything else is omitted. */
export function letterboxdRating(raw: string | undefined): number | undefined {
  const value = finiteNumber(raw);
  return value !== undefined && value >= 0.5 && value <= 5 && Number.isInteger(value * 2)
    ? value
    : undefined;
}

function releaseYear(raw: string | undefined): number | undefined {
  const value = finiteNumber(raw);
  return value !== undefined && Number.isInteger(value) && value >= 1870 && value <= 2100
    ? value
    : undefined;
}

/** Buffers the run's two documents; deterministic subjects make re-imports idempotent. */
class LetterboxdLibrary {
  private readonly diary = new Store();
  private readonly watchlist = new Store();
  private readonly diaryDoc: string;
  private readonly watchlistDoc: string;
  /** Watch-event subjects by Letterboxd URI and by film + watched date. */
  private readonly events = new Map<string, string>();
  private rowsRead = 0;
  private eventCount = 0;

  constructor(private readonly ctx: FileImportContext) {
    this.diaryDoc = ctx.resolve(DIARY);
    this.watchlistDoc = ctx.resolve(WATCHLIST);
  }

  async rows(
    rows: AsyncIterable<Record<string, string>>,
    fileName: string,
    knownKind?: LetterboxdKind,
  ): Promise<void> {
    let kind = knownKind;
    let checked = knownKind !== undefined;
    for await (const row of rows) {
      if (!checked) {
        kind = letterboxdCsvKind(fileName, Object.keys(row));
        checked = true;
        if (!kind)
          throw new Error(
            "This CSV is not a Letterboxd diary, review, rating or watchlist export.",
          );
      }
      if (this.rowsRead >= this.ctx.maxRows) return;
      this.rowsRead++;
      if (!this.row(kind as LetterboxdKind, row)) this.ctx.skip();
    }
  }

  /** Map one row; false when it lacks the film name every kind needs. */
  private row(kind: LetterboxdKind, row: Record<string, string>): boolean {
    const name = cappedText(row.Name, MAX_TITLE_CHARS);
    if (!name) return false;
    const year = releaseYear(row.Year);
    const filmKey = `${name}|${year ?? ""}`;
    const uri = letterboxdUrl(row["Letterboxd URI"]);
    const store = kind === "watchlist" ? this.watchlist : this.diary;
    const doc = kind === "watchlist" ? this.watchlistDoc : this.diaryDoc;
    const film = new Movie(
      `${doc}#film-${recordFragment(name, filmKey)}`,
      store,
      DataFactory,
    ).mark();
    film.name = name;
    if (year !== undefined) film.copyrightYear = year;
    const logged = parseDateOnly(row.Date);
    if (kind === "watchlist") {
      film.watchStatus = "watchlist";
      if (uri) film.sourceUrl = uri;
      if (logged) film.dateCreated = logged;
      return true;
    }
    film.watchStatus = "watched";
    if (kind === "watched" || kind === "ratings") {
      // These files link the film itself; diary and review links name the entry.
      if (uri) film.sourceUrl = uri;
      const rating = letterboxdRating(row.Rating);
      if (kind === "ratings" && rating !== undefined) film.ratingValue = rating;
      return true;
    }
    this.watch(film, filmKey, uri, logged, row);
    return true;
  }

  private watch(
    film: Movie,
    filmKey: string,
    uri: string | undefined,
    logged: Date | undefined,
    row: Record<string, string>,
  ): void {
    const watchedRaw = row["Watched Date"]?.trim() ?? "";
    const keys = [`film:${filmKey}|${watchedRaw}`];
    if (uri) keys.unshift(`uri:${uri}`);
    let subject = keys.map((key) => this.events.get(key)).find((found) => found !== undefined);
    if (!subject) {
      subject = `${this.diaryDoc}#watch-${recordFragment(film.name ?? "", uri ?? keys[0])}`;
      this.eventCount++;
    }
    for (const key of keys) this.events.set(key, subject);
    const event = new WatchAction(subject, this.diary, DataFactory).mark();
    // Only present values are written: a review row never clears its diary entry's fields.
    event.name = film.name;
    event.watchedWork = film.value;
    const watched = parseDateOnly(watchedRaw);
    if (watched) event.startTime = watched;
    if (logged) event.dateCreated = logged;
    if (uri) event.sourceUrl = uri;
    const rating = letterboxdRating(row.Rating);
    if (rating !== undefined) event.ratingValue = rating;
    if (/^yes$/i.test(row.Rewatch?.trim() ?? "")) event.rewatch = true;
    for (const tag of tagList(row.Tags, ",")) event.keywords.add(tag);
    const review = cappedText(row.Review, MAX_BODY_CHARS);
    if (review) event.reviewBody = review;
  }

  async save(): Promise<void> {
    if (this.diary.size > 0)
      await this.ctx.write({
        slug: DIARY,
        category: "media",
        forClass: this.eventCount > 0 ? CLASSES.WatchAction : CLASSES.Movie,
        dataset: this.diary,
      });
    if (this.watchlist.size > 0)
      await this.ctx.write({
        slug: WATCHLIST,
        category: "media",
        forClass: CLASSES.Movie,
        dataset: this.watchlist,
      });
  }
}
