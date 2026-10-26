// AUTHORED-BY Codex GPT-6.1-Sol
import { type ListEntry, mimeEssence, validateEntries, validateEntry } from "./entries";
import { requireValid } from "./validation";

export const TYPE_FILTERS = [
  "folders",
  "documents",
  "images",
  "pdfs",
  "audio",
  "video",
  "data",
  "other",
] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

const documents = new Set([
  "application/msword",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const data = new Set([
  "application/json",
  "application/xml",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "text/turtle",
  "text/n3",
  "text/csv",
  "text/tab-separated-values",
  "text/xml",
]);

/** Classify declared MIME, never infer a type from the file name or URL. */
export function getTypeFamily(entry: ListEntry): TypeFilter {
  validateEntry(entry);
  if (entry.kind === "container") return "folders";
  const type = mimeEssence(entry.contentType);
  if (type === null) return "other";
  if (type === "application/pdf") return "pdfs";
  if (type.startsWith("image/")) return "images";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (data.has(type) || type.endsWith("+json") || type.endsWith("+xml")) return "data";
  if (type.startsWith("text/") || documents.has(type)) return "documents";
  return "other";
}

/** Selected chips are ORed; no chips means all entries. The input is never mutated. */
export function filterEntries<T extends ListEntry>(
  entries: readonly T[],
  filters: readonly TypeFilter[],
): T[] {
  validateEntries(entries);
  requireValid(Array.isArray(filters), "invalid-filter");
  for (const filter of filters) requireValid(TYPE_FILTERS.includes(filter), "invalid-filter");
  return entries.filter((entry) => filters.length === 0 || filters.includes(getTypeFamily(entry)));
}
