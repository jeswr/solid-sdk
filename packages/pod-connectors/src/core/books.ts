// AUTHORED-BY Claude Opus 5.5
/**
 * The shared book identity for reading-library exports (Goodreads, StoryGraph, Open
 * Library). Every adapter derives a book's fragment from the same key, so one book
 * imported from two services has the same `#book-…` local name and the same normalised
 * `schema:isbn` in each connector's document, and duplicate rows in one export collapse
 * onto one subject:
 *
 * - a valid ISBN-13, or an ISBN-10 converted to ISBN-13 (checksums verified), else
 * - the case-, accent- and punctuation-folded title plus primary author, plus the
 *   source's own book id when the export has one (two ISBN-less editions that share a
 *   title and author stay apart; such books then do not match across services).
 */
import { recordFragment } from "./slug.js";

/** Strip Goodreads' `="…"` spreadsheet wrapper, hyphens and spaces. */
function isbnDigits(raw: string | undefined): string | undefined {
  if (typeof raw !== "string" || raw.length > 64) return undefined;
  const inner = raw
    .trim()
    .replace(/^="?|"?$/g, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return /^(?:\d{9}[\dX]|\d{13})$/.test(inner) ? inner : undefined;
}

function isbn13Valid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

function isbn10Valid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const char = digits[i] as string;
    if (char === "X" && i !== 9) return false;
    sum += (char === "X" ? 10 : Number(char)) * (10 - i);
  }
  return sum % 11 === 0;
}

/** A checksum-valid ISBN-13 (ISBN-10 input is converted with the 978 prefix), else undefined. */
export function isbn13(raw: string | undefined): string | undefined {
  const digits = isbnDigits(raw);
  if (!digits) return undefined;
  if (digits.length === 13) {
    return (digits.startsWith("978") || digits.startsWith("979")) && isbn13Valid(digits)
      ? digits
      : undefined;
  }
  if (!isbn10Valid(digits)) return undefined;
  const stem = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(stem[i]) * (i % 2 === 0 ? 1 : 3);
  return `${stem}${(10 - (sum % 10)) % 10}`;
}

/** Fold for matching: accents, case and punctuation never distinguish two books. */
function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The cross-service identity key of a book. */
export function bookKey(
  title: string,
  author: string | undefined,
  isbn?: string,
  sourceId?: string,
): string {
  if (isbn) return `isbn:${isbn}`;
  const key = `title:${fold(title)}|author:${fold(author ?? "")}`;
  return sourceId ? `${key}|source:${sourceId}` : key;
}

/** The deterministic fragment (without the `book-` prefix) shared by every reading adapter. */
export function bookFragment(
  title: string,
  author: string | undefined,
  isbn?: string,
  sourceId?: string,
): string {
  // The readable part must depend only on the key: services spell titles differently.
  return isbn
    ? `isbn-${isbn}`
    : recordFragment(fold(title), bookKey(title, author, undefined, sourceId));
}

/** The first author of a comma-separated author list. */
export function primaryAuthor(authors: string | undefined): string | undefined {
  return authors?.split(",")[0]?.trim() || undefined;
}
