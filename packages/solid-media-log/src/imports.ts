// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseCsv } from "@jeswr/pod-connectors/core/csv";
import { isMediaDate, type MediaEntry, mediaUrl, validateEntry } from "./model.js";

export interface ImportIssue {
  row: number;
  message: string;
}
export interface MediaImport {
  entries: MediaEntry[];
  issues: ImportIssue[];
}
export const MAX_IMPORT_CHARS = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

/** Identity ignores provider-specific diary/film URLs and presentation whitespace. */
export function mediaImportKey(entry: MediaEntry): string {
  return `${entry.kind}\u0000${entry.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB")}\u0000${entry.year ?? ""}`;
}
export interface MediaImportIndex {
  has(entry: MediaEntry): boolean;
  /** An undated want/in-progress item that this completion should update, if not a duplicate. */
  completionTarget(entry: MediaEntry): MediaEntry | undefined;
  add(entry: MediaEntry): void;
}
/** Build identity keys once: large CSVs and complete libraries need linear indexing. */
export function mediaImportIndex(entries: Iterable<MediaEntry> = []): MediaImportIndex {
  const dates = new Map<string, Set<string>>();
  const unfinished = new Map<string, MediaEntry>();
  let building = true;
  const index: MediaImportIndex = {
    has(entry) {
      const known = dates.get(mediaImportKey(entry));
      if (entry.status !== "finished") return !!known || unfinished.has(mediaImportKey(entry));
      return !!known && (!entry.finished || known.has("") || known.has(entry.finished));
    },
    completionTarget(entry) {
      return entry.status === "finished" && !index.has(entry)
        ? unfinished.get(mediaImportKey(entry))
        : undefined;
    },
    add(entry) {
      const key = mediaImportKey(entry);
      if (!entry.finished && (entry.status === "want" || entry.status === "in-progress")) {
        if (!unfinished.has(key)) unfinished.set(key, entry);
        return;
      }
      // Existing history may coexist with a new watchlist/reread cycle. Only newly
      // accepted completions consume its pending target, once, during this import.
      if (!building && entry.status === "finished") unfinished.delete(key);
      let known = dates.get(key);
      if (!known) {
        known = new Set();
        dates.set(key, known);
      }
      known.add(entry.finished ?? "");
    },
  };
  for (const entry of entries) index.add(entry);
  building = false;
  return index;
}
/** Dated rewatches remain distinct; undated watched/ratings rows match any dated log. */
export function mediaImportDuplicate(entry: MediaEntry, existing: readonly MediaEntry[]): boolean {
  return mediaImportIndex(existing).has(entry);
}
/** Decode legacy exports without silently replacing invalid UTF-8 characters. */
export function decodeMediaCsv(bytes: Uint8Array): { text: string; legacyEncoding: boolean } {
  if (bytes.byteLength > MAX_IMPORT_CHARS) throw new TypeError("Choose a CSV smaller than 4 MiB");
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), legacyEncoding: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), legacyEncoding: true };
  }
}

function date(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const parts = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw.trim());
  const value = parts
    ? `${parts[1]}-${parts[2]?.padStart(2, "0")}-${parts[3]?.padStart(2, "0")}`
    : "";
  if (!isMediaDate(value)) throw new TypeError("Invalid date");
  return value;
}
function number(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) throw new TypeError("Invalid number");
  return Number(raw);
}
function parse(
  text: string,
  required: string[],
  map: (row: Readonly<Record<string, string>>) => MediaEntry,
): MediaImport {
  if (text.length > MAX_IMPORT_CHARS) throw new TypeError("Choose a CSV smaller than 4 MiB");
  const parsed = parseCsv(text);
  if (required.some((key) => !parsed.headers.includes(key)))
    throw new TypeError(`This export needs these columns: ${required.join(", ")}`);
  if (new Set(parsed.headers).size !== parsed.headers.length)
    throw new TypeError("The CSV contains duplicate columns");
  if (parsed.rows.length > MAX_IMPORT_ROWS)
    throw new TypeError("Import up to 5,000 rows at a time");
  const result: MediaImport = { entries: [], issues: [] };
  const known = mediaImportIndex();

  for (const [index, row] of parsed.rows.entries()) {
    try {
      const entry = validateEntry(map(row));
      if (known.has(entry)) {
        result.issues.push({ row: index + 2, message: "Duplicate item" });
        continue;
      }
      known.add(entry);
      result.entries.push(entry);
    } catch (error) {
      result.issues.push({
        row: index + 2,
        message: error instanceof TypeError ? error.message : "Invalid row",
      });
    }
  }
  return result;
}
/** Accepts Letterboxd diary, watched, ratings, reviews and watchlist CSV exports. */
export function parseLetterboxdCsv(
  text: string,
  shelf: "finished" | "want" = "finished",
): MediaImport {
  return parse(text, ["Name", "Year"], (row) => {
    const finished = date(row["Watched Date"]);
    const review = row.Review || undefined;
    const rating = number(row.Rating);
    const rewatch = row.Rewatch?.toLowerCase();
    if (rewatch && rewatch !== "yes" && rewatch !== "no")
      throw new TypeError("Invalid rewatch value");
    const origin = row["Letterboxd URI"] || undefined;
    if (origin && !mediaUrl(origin)) throw new TypeError("Invalid Letterboxd URL");
    return {
      title: row.Name ?? "",
      kind: "film",
      year: number(row.Year),
      status: finished ? "finished" : shelf,
      finished,
      rating,
      review,
      repeatCount: rewatch === "yes" ? 1 : 0,
      source: "Letterboxd",
      origin,
    };
  });
}
/** Goodreads zero ratings mean unrated. Date Added is never treated as Date Read. */
export function parseGoodreadsCsv(text: string): MediaImport {
  return parse(text, ["Title", "Author", "Exclusive Shelf"], (row) => {
    const shelf = row["Exclusive Shelf"];
    const status =
      shelf === "read"
        ? "finished"
        : shelf === "currently-reading"
          ? "in-progress"
          : shelf === "to-read"
            ? "want"
            : shelf === "did-not-finish" || shelf === "dnf"
              ? "abandoned"
              : shelf === "paused"
                ? "in-progress"
                : "want";
    const rating = number(row["My Rating"]);
    const count = number(row["Read Count"]);
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new TypeError("Invalid read count");
    const id = row["Book Id"]?.trim();
    if (id && !/^\d+$/.test(id)) throw new TypeError("Invalid Goodreads book ID");
    // A reread can retain an earlier Date Read while the current shelf is in progress.
    // This entry's completion date belongs to its current cycle; keep the repeat count.
    let finished: string | undefined;
    if (status === "finished") {
      try {
        finished = date(row["Date Read"]);
      } catch {
        /* Keep the book when its date is unreadable. */
      }
    }
    return {
      title: row.Title ?? "",
      kind: "book",
      creator: row.Author || undefined,
      year: number(row["Original Publication Year"] || row["Year Published"]),
      status,
      rating: rating === 0 ? undefined : rating,
      finished,
      review: row["My Review"] || undefined,
      repeatCount: count === undefined ? undefined : Math.max(0, count - 1),
      source: "Goodreads",
      origin: id ? `https://www.goodreads.com/book/show/${id}` : undefined,
    };
  });
}
