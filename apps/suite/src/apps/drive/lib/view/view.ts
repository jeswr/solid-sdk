// AUTHORED-BY Claude Opus 5.5
/**
 * Pure helpers the Drive screens use to present listings: adapting
 * {@link DriveItem}s to the list helpers, the "Modified" column text, friendly
 * type names (04-drive §2.8), the Modified filter chips and the folder list
 * pipeline (hide dot-names → filter → sort, folders first).
 */

import type { DriveItem } from "../client/client";
import { formatFileSize } from "../files";
import { createListComparator, filterEntries, type ListEntry, type TypeFilter } from "../list";

export type SortKey = "name" | "modified" | "size";
export type ModifiedFilter = "today" | "7d" | "30d" | "year";
export const MODIFIED_FILTERS: readonly { id: ModifiedFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "year", label: "This year" },
];
export const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  folders: "Folders",
  documents: "Documents",
  images: "Images",
  pdfs: "PDFs",
  audio: "Audio",
  video: "Video",
  data: "Data",
  other: "Other",
};

const DAY = 86_400_000;

export function toListEntry(item: DriveItem): ListEntry & { item: DriveItem } {
  return {
    url: item.url,
    kind: item.kind === "folder" ? "container" : "resource",
    displayName: item.name,
    size: item.size ?? null,
    modified: item.modified ?? null,
    contentType: safeContentType(item.contentType),
    item,
  };
}

/** Only well-formed MIME types reach the list helpers (they reject the rest). */
function safeContentType(value: string | undefined): string | null {
  return value && /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Within the modified range relative to `now` (local calendar days). */
export function inModifiedRange(
  modified: Date | undefined,
  range: ModifiedFilter,
  now: Date,
): boolean {
  if (!modified) return false;
  const time = modified.getTime();
  switch (range) {
    case "today":
      return time >= startOfDay(now);
    case "7d":
      return time >= now.getTime() - 7 * DAY;
    case "30d":
      return time >= now.getTime() - 30 * DAY;
    case "year":
      return modified.getFullYear() === now.getFullYear();
  }
}

export interface ViewOptions {
  readonly types?: readonly TypeFilter[];
  readonly modified?: ModifiedFilter | undefined;
  readonly sort?: { key: SortKey; dir: "asc" | "desc" };
  readonly now?: Date;
  readonly foldersFirst?: boolean;
}

/** Hide dot-names, apply the chips, then sort (folders first by default). */
export function viewItems<T extends DriveItem>(
  items: readonly T[],
  options: ViewOptions = {},
): T[] {
  const visible = items.filter((item) => !item.name.startsWith("."));
  const byUrl = new Map(visible.map((item) => [item.url, item]));
  let entries = visible.map(toListEntry);
  if (options.types && options.types.length > 0) entries = filterEntries(entries, options.types);
  if (options.modified) {
    const range = options.modified;
    const now = options.now ?? new Date();
    entries = entries.filter((entry) => inModifiedRange(entry.item.modified, range, now));
  }
  const comparator = createListComparator({
    key: options.sort?.key ?? "name",
    dir: options.sort?.dir ?? "asc",
    foldersFirst: options.foldersFirst ?? true,
  });
  return [...entries].sort(comparator).map((entry) => byUrl.get(entry.url) as T);
}

/** "Modified" text: relative within 7 days, else a medium date. */
export function formatModified(date: Date | undefined, now = new Date(), locale = "en"): string {
  if (!date) return "—";
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 7 * DAY) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
    if (startOfDay(date) === startOfDay(now))
      return rtf.format(-Math.floor(diff / 3_600_000), "hour");
    const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
    return rtf.format(-days, "day");
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatSize(item: Pick<DriveItem, "kind" | "size">, locale = "en"): string {
  if (item.kind === "folder" || item.size === undefined) return "—";
  return formatFileSize(Math.max(0, Math.round(item.size)), locale);
}

/** Friendly type label for the details pane. */
export function friendlyType(item: Pick<DriveItem, "kind" | "contentType" | "name">): string {
  if (item.kind === "folder") return "Folder";
  const type = item.contentType?.toLowerCase() ?? "";
  if (type === "application/pdf") return "PDF document";
  if (type.startsWith("image/"))
    return `Image (${type
      .slice(6)
      .replace(/^svg\+xml$/, "svg")
      .toUpperCase()})`;
  if (type.startsWith("audio/")) return "Audio";
  if (type.startsWith("video/")) return "Video";
  if (type === "text/markdown") return "Markdown document";
  if (type === "text/csv") return "Spreadsheet (CSV)";
  if (
    ["text/turtle", "application/ld+json", "application/n-triples", "application/trig"].includes(
      type,
    )
  )
    return "Data file";
  if (type.startsWith("text/")) return "Text file";
  return "File";
}

/** How Drive previews a file. */
export type PreviewKind =
  | "image"
  | "pdf"
  | "text"
  | "markdown"
  | "csv"
  | "rdf"
  | "audio"
  | "video"
  | "none";

export function previewKind(contentType: string | undefined): PreviewKind {
  const type = contentType?.toLowerCase() ?? "";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type === "application/pdf") return "pdf";
  if (type === "text/markdown") return "markdown";
  if (type === "text/csv") return "csv";
  if (
    [
      "text/turtle",
      "application/ld+json",
      "application/n-triples",
      "application/trig",
      "text/n3",
    ].includes(type)
  )
    return "rdf";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("text/") || type === "application/json") return "text";
  return "none";
}

/** Minimal RFC 4180 CSV parse for the preview table (first `maxRows` rows). */
export function parseCsv(text: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= maxRows) return rows;
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
