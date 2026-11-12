// AUTHORED-BY Claude Opus 5.5
/**
 * Field bounds shared by the export-file adapters (Letterboxd, Pocket, StoryGraph,
 * Telegram, Goodreads). Every value read from an export is untrusted: text is capped
 * at a code-point boundary, dates are kept only between 1970 and 2100, numbers must be
 * finite, and links must be credential-free absolute http(s) URLs. Values that fail a
 * check are dropped (`undefined`), never coerced into something plausible.
 */
import { safeIri } from "./vocab.js";

/** Titles, film/book names and chat names. */
export const MAX_TITLE_CHARS = 1024;
/** Person/sender/author display names and attachment file names. */
export const MAX_NAME_CHARS = 512;
/** Reviews and message bodies (UTF-16 code units, truncated at a code point). */
export const MAX_BODY_CHARS = 64 * 1024;
/** Longest link kept; longer links are rejected, never truncated. */
export const MAX_URL_CHARS = 8192;
/** Tags per record and characters per tag. */
export const MAX_TAGS = 64;
export const MAX_TAG_CHARS = 128;

/** Earliest and latest instants an export date may carry (1970-01-01 .. 2100-12-31). */
export const MIN_EXPORT_TIME = Date.UTC(1970, 0, 1);
export const MAX_EXPORT_TIME = Date.UTC(2101, 0, 1) - 1;

/** Trimmed non-empty text capped at `max` UTF-16 units without splitting a surrogate pair. */
export function cappedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  let end = max;
  const last = trimmed.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return trimmed.slice(0, end).trimEnd() || undefined;
}

/** A valid Date inside the accepted export range, else undefined. */
export function exportDate(date: Date | undefined): Date | undefined {
  if (!date) return undefined;
  const time = date.getTime();
  return Number.isFinite(time) && time >= MIN_EXPORT_TIME && time <= MAX_EXPORT_TIME
    ? date
    : undefined;
}

/** Unix seconds (a finite number or a plain decimal digit string) as an in-range Date. */
export function unixSecondsDate(raw: unknown): Date | undefined {
  let seconds: number;
  if (typeof raw === "number") seconds = raw;
  else if (typeof raw === "string" && /^\d{1,12}(?:\.\d{1,9})?$/.test(raw.trim()))
    seconds = Number(raw.trim());
  else return undefined;
  if (!Number.isFinite(seconds)) return undefined;
  return exportDate(new Date(seconds * 1000));
}

/** `YYYY-MM-DD` or `YYYY/MM/DD` as UTC midnight; calendar overflow (2023-02-30) is rejected. */
export function parseDateOnly(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return exportDate(date);
}

/** A finite number from a plain decimal string, else undefined (no hex, exponent or Infinity). */
export function finiteNumber(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!/^-?\d{1,9}(?:\.\d{1,9})?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * An absolute http(s) link without embedded credentials, in its parsed form, or undefined.
 * `javascript:`, `data:`, `file:` and every other scheme are rejected, as are links longer
 * than {@link MAX_URL_CHARS} and any value the RDF IRI guard refuses.
 */
export function httpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text || text.length > MAX_URL_CHARS || !URL.canParse(text)) return undefined;
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password || !url.hostname) return undefined;
  if (url.href.length > MAX_URL_CHARS) return undefined;
  return safeIri(url.href);
}

/** Split a tag list, capping each tag and the number of tags; duplicates collapse. */
export function tagList(raw: string | undefined, separator: string | RegExp): string[] {
  if (!raw) return [];
  const tags = new Set<string>();
  for (const part of raw.split(separator)) {
    if (tags.size >= MAX_TAGS) break;
    const tag = cappedText(part, MAX_TAG_CHARS);
    if (tag) tags.add(tag);
  }
  return [...tags];
}
