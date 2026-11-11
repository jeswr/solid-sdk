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

/** Rewatches with a different date are distinct logs, even with one source work URL. */
export function mediaImportKey(entry: MediaEntry): string {
  const identity =
    entry.origin ??
    `${entry.kind}\u0000${entry.title}\u0000${entry.creator ?? ""}\u0000${entry.year ?? ""}`;
  return `${identity}\u0000${entry.finished ?? ""}`;
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
  const seen = new Set<string>();
  for (const [index, row] of parsed.rows.entries()) {
    try {
      const entry = validateEntry(map(row));
      const key = mediaImportKey(entry);
      if (seen.has(key)) {
        result.issues.push({ row: index + 2, message: "Duplicate item" });
        continue;
      }
      seen.add(key);
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
            : shelf === "did-not-finish"
              ? "abandoned"
              : undefined;
    if (!status) throw new TypeError("Unknown Goodreads shelf");
    const rating = number(row["My Rating"]);
    const count = number(row["Read Count"]);
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new TypeError("Invalid read count");
    const id = row["Book Id"]?.trim();
    if (id && !/^\d+$/.test(id)) throw new TypeError("Invalid Goodreads book ID");
    // A reread can retain an earlier Date Read while the current shelf is in progress.
    // This entry's completion date belongs to its current cycle; keep the repeat count.
    const finished = status === "finished" ? date(row["Date Read"]) : undefined;
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
