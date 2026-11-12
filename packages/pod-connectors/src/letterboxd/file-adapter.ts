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
 * Each kind has its own document, `media/letterboxd/<kind>.ttl`: an import replaces the
 * kinds it contains and leaves every other kind untouched, so a later ratings.csv (or a
 * ZIP without a diary) never deletes earlier viewings.
 *
 * Each diary entry becomes a `schema:WatchAction` (the class Netflix and Twitch use) with
 * the watched date, the 0.5–5 star rating, the rewatch flag and tags, linked through
 * `schema:object` to a `schema:Movie` for the film (name and release year). A diary entry
 * is identified by its own Letterboxd URI (entries without one, by film and watched date).
 * A review attaches to a diary entry of the same import: by its URI, else by film and
 * watched date when exactly one entry matches and that entry has no different URI. The
 * review text is then merged into the diary entry, and reviews.ttl records the review on
 * that entry's subject; an unattached review is its own viewing in reviews.ttl. Watched
 * and rated films are films with the status `watched` (ratings.csv adds the film rating);
 * watchlist films have the status `watchlist`.
 *
 * The archive is read with the shared bounded ZIP reader (size, CRC, DEFLATE-boundary
 * and total-inflation checks, the total capped at the shared 64 MiB file limit); other
 * files and subfolders (`deleted/`, `lists/`, …) are never inflated. The five files are
 * read from the archive root or from exactly one `letterboxd-…` folder; an archive with
 * both, or with two folders, is refused. Names that differ only in case are duplicates:
 * the first is read and the rest are counted as skipped. A single extracted CSV is also
 * accepted: its file name, else its header row, selects the kind (`watchlist` only by
 * name: its header equals watched.csv's).
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
/** The document of one export file kind. */
const slugOf = (kind: LetterboxdKind) => `media/letterboxd/${kind}.ttl`;

/** Central-directory records read from an archive (Letterboxd exports hold a few hundred). */
export const MAX_LETTERBOXD_ZIP_ENTRIES = 10_000;
/** Inflated bytes across every selected CSV in one archive: the shared file limit. */
export const MAX_LETTERBOXD_INFLATED_BYTES = MAX_FILE_BYTES;
const MIXED_EXPORTS = "This ZIP holds more than one Letterboxd export.";

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
  // Export folders are `letterboxd-<username>-<timestamp>`: plain ASCII word characters.
  const match = name.match(/^(?:(letterboxd-[A-Za-z0-9_-]{1,128})\/)?([a-z]+)\.csv$/i);
  if (!match) return undefined;
  const kind = (match[2] as string).toLowerCase() as LetterboxdKind;
  return KINDS.includes(kind) ? kind : undefined;
}

/**
 * The archive entries to read, in kind order (diary first, so reviews can attach): files
 * at the root or in exactly one `letterboxd-…` folder; case-only duplicates are counted.
 */
export function letterboxdEntries<T extends { name: string }>(
  entries: readonly T[],
  onSkip: () => void,
): T[] {
  const selected = entries.filter((entry) => letterboxdEntryKind(entry.name) !== undefined);
  const folders = new Set(
    selected.map((entry) => entry.name.slice(0, entry.name.lastIndexOf("/") + 1).toLowerCase()),
  );
  if (folders.size > 1) throw new Error(MIXED_EXPORTS);
  const byKind = new Map<LetterboxdKind, T>();
  for (const entry of selected) {
    const kind = letterboxdEntryKind(entry.name) as LetterboxdKind;
    if (byKind.has(kind)) onSkip();
    else byKind.set(kind, entry);
  }
  return KINDS.flatMap((kind) => {
    const entry = byKind.get(kind);
    return entry ? [entry] : [];
  });
}

async function importArchive(
  file: ImportFile,
  ctx: FileImportContext,
  library: LetterboxdLibrary,
): Promise<void> {
  if (!file.slice) throw new Error("Letterboxd ZIP imports require file.slice().");
  const entries = letterboxdEntries(await zipDirectory(file, MAX_LETTERBOXD_ZIP_ENTRIES), () =>
    ctx.skip(),
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

/** One kind's document as built by this run. */
interface KindDocument {
  readonly doc: string;
  readonly store: Store;
  /** Rows mapped from this kind; a kind with none is not written. */
  rows: number;
}

/** A diary viewing of this run, for reviews to attach to. */
interface Viewing {
  readonly subject: string;
  readonly film: string;
  readonly uri?: string;
}

/**
 * Buffers one document per kind; deterministic subjects make re-imports idempotent.
 * Only the kinds read in this run are written.
 */
class LetterboxdLibrary {
  private readonly kinds = new Map<LetterboxdKind, KindDocument>();
  /** Diary viewings by `uri:<link>` and, for entries without a link, `film:<film>|<date>`. */
  private readonly viewings = new Map<string, Viewing>();
  /** Diary viewings by film and watched date, for the reviews fallback. */
  private readonly byFilmDate = new Map<string, Viewing[]>();
  private rowsRead = 0;

  constructor(private readonly ctx: FileImportContext) {}

  private kind(kind: LetterboxdKind): KindDocument {
    let entry = this.kinds.get(kind);
    if (!entry) {
      entry = { doc: this.ctx.resolve(slugOf(kind)), store: new Store(), rows: 0 };
      this.kinds.set(kind, entry);
    }
    return entry;
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
      if (this.row(kind as LetterboxdKind, row)) this.kind(kind as LetterboxdKind).rows++;
      else this.ctx.skip();
    }
  }

  /** Map one row; false when it lacks the film name every kind needs. */
  private row(kind: LetterboxdKind, row: Record<string, string>): boolean {
    const name = cappedText(row.Name, MAX_TITLE_CHARS);
    if (!name) return false;
    const year = releaseYear(row.Year);
    const filmKey = `${name}|${year ?? ""}`;
    const uri = letterboxdUrl(row["Letterboxd URI"]);
    const { doc, store } = this.kind(kind);
    const watchedRaw = row["Watched Date"]?.trim() ?? "";
    const filmDate = `${filmKey}|${watchedRaw}`;
    const logged = parseDateOnly(row.Date);
    if (kind === "reviews") {
      // Attach to this run's diary viewing (merged there too), else stand alone here.
      const attached = this.attachTarget(uri, filmDate);
      if (attached) {
        const diary = this.kind("diary").store;
        const merged = new WatchAction(attached.subject, diary, DataFactory);
        this.watch(merged, attached.film, uri, logged, row);
        this.watch(
          new WatchAction(attached.subject, store, DataFactory),
          attached.film,
          uri,
          logged,
          row,
        );
        return true;
      }
    }
    const film = new Movie(
      `${doc}#film-${recordFragment(name, filmKey)}`,
      store,
      DataFactory,
    ).mark();
    film.name = name;
    if (year !== undefined) film.copyrightYear = year;
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
    const subject = `${doc}#watch-${recordFragment(name, uri ?? `film:${filmDate}`)}`;
    if (kind === "reviews") {
      this.watch(new WatchAction(subject, store, DataFactory), film.value, uri, logged, row);
      return true;
    }
    const key = uri ? `uri:${uri}` : `film:${filmDate}`;
    let viewing = this.viewings.get(key);
    if (!viewing) {
      viewing = { subject, film: film.value, uri };
      this.viewings.set(key, viewing);
      this.byFilmDate.set(filmDate, [...(this.byFilmDate.get(filmDate) ?? []), viewing]);
    }
    this.watch(new WatchAction(viewing.subject, store, DataFactory), film.value, uri, logged, row);
    return true;
  }

  /**
   * The diary viewing a review attaches to: the one with the same link, else the only
   * viewing of the film on that date, provided its link is not a different one.
   */
  private attachTarget(uri: string | undefined, filmDate: string): Viewing | undefined {
    if (uri) {
      const exact = this.viewings.get(`uri:${uri}`);
      if (exact) return exact;
    }
    const candidates = this.byFilmDate.get(filmDate) ?? [];
    if (candidates.length !== 1) return undefined;
    const [only] = candidates as [Viewing];
    return uri && only.uri && only.uri !== uri ? undefined : only;
  }

  /** Write a viewing's present values; a review row never clears its diary entry's fields. */
  private watch(
    event: WatchAction,
    film: string,
    uri: string | undefined,
    logged: Date | undefined,
    row: Record<string, string>,
  ): void {
    event.mark();
    const name = cappedText(row.Name, MAX_TITLE_CHARS);
    if (name) event.name = name;
    event.watchedWork = film;
    const watched = parseDateOnly(row["Watched Date"]);
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
    for (const kind of KINDS) {
      const entry = this.kinds.get(kind);
      if (!entry || entry.rows === 0) continue;
      await this.ctx.write({
        slug: slugOf(kind),
        category: "media",
        forClass: kind === "diary" || kind === "reviews" ? CLASSES.WatchAction : CLASSES.Movie,
        dataset: entry.store,
      });
    }
  }
}
