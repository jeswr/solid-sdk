// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import {
  MAX_CSV_COLUMNS,
  MAX_CSV_HEADER_CHARS,
  parseCsvRows,
} from "@jeswr/pod-connectors/core/csv";
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

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

/** Use Goodreads book IDs when available. Letterboxd diary URLs identify individual logs. */
export function mediaImportKey(entry: MediaEntry): string {
  const id =
    entry.kind === "book" &&
    /^https?:\/\/(?:www\.)?goodreads\.com\/book\/show\/([0-9]+)(?=[./?&#-]|$)/i.exec(
      entry.origin ?? "",
    )?.[1];
  if (id) return JSON.stringify(["goodreads", id.replace(/^0+(?=\d)/, "")]);
  return JSON.stringify([
    entry.kind,
    normalized(entry.title),
    entry.year ?? "",
    entry.kind === "book" ? normalized(entry.creator ?? "") : "",
  ]);
}

/** The same dated occurrence shares a claim across independent imports. */
export function mediaImportOccurrence(entry: MediaEntry): string {
  return JSON.stringify([mediaImportKey(entry), entry.status === "finished", entry.finished ?? ""]);
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
/** Frame one logical record at a time so limits apply before token and object allocation. */
function* boundedRows(text: string): Generator<string[], void> {
  const source = text.replace(/^\uFEFF/, "");
  let start = 0;
  let quoted = false;
  let columns = 1;
  let rows = 0;
  for (let i = 0; i <= source.length; i++) {
    const char = source[i];
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "," && ++columns > MAX_CSV_COLUMNS)
      throw new TypeError("The CSV contains too many columns");
    if (char !== undefined && (quoted || (char !== "\r" && char !== "\n"))) continue;
    if (rows === 0 && i - start > MAX_CSV_HEADER_CHARS)
      throw new TypeError("The CSV header exceeds the import limit");
    const cells = parseCsvRows(source.slice(start, i))[0];
    if (cells) {
      if (++rows > MAX_IMPORT_ROWS + 1) throw new TypeError("Import up to 5,000 rows at a time");
      yield cells;
    }
    if (char === "\r" && source[i + 1] === "\n") i++;
    start = i + 1;
    columns = 1;
  }
}
function parse(
  text: string,
  required: string[],
  map: (row: Readonly<Record<string, string>>) => MediaEntry,
): MediaImport {
  if (text.length > MAX_IMPORT_CHARS) throw new TypeError("Choose a CSV smaller than 4 MiB");
  const rows = boundedRows(text);
  const headers = (rows.next().value ?? []).map((header) => header.trim());
  if (required.some((key) => !headers.includes(key)))
    throw new TypeError(`This export needs these columns: ${required.join(", ")}`);
  if (new Set(headers).size !== headers.length)
    throw new TypeError("The CSV contains duplicate columns");
  const result: MediaImport = { entries: [], issues: [] };
  const known = mediaImportIndex();

  let rowNumber = 1;
  for (const cells of rows) {
    const row = Object.fromEntries(
      cells.slice(0, headers.length).map((cell, i) => [headers[i], cell.trim()]),
    );
    rowNumber++;
    try {
      const entry = validateEntry(map(row));
      if (known.has(entry)) {
        result.issues.push({ row: rowNumber, message: "Duplicate item" });
        continue;
      }
      known.add(entry);
      result.entries.push(entry);
    } catch (error) {
      result.issues.push({
        row: rowNumber,
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
