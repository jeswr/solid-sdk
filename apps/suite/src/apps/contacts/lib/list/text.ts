// AUTHORED-BY Codex GPT-6.1-Sol
import { caseFolding } from "../dedupe/case-folding";
import type { HighlightField, ListContact } from "./types";
import type { ListContext } from "./validation";

export function nameParts(contact: ListContact, ctx: ListContext): string[] {
  const parts =
    ctx.nameOrder === "given-family"
      ? [contact.givenName, contact.familyName]
      : [contact.familyName, contact.givenName];
  const named = parts
    .filter((part): part is string => part !== undefined)
    .map((part) => part.trim());
  return named.length ? named : [contact.displayName?.trim() ?? ""];
}

export function listName(contact: ListContact, ctx: ListContext): string {
  return nameParts(contact, ctx).join(" ");
}

export function compareContacts(a: ListContact, b: ListContact, ctx: ListContext): number {
  return ctx.collator.compare(listName(a, ctx), listName(b, ctx)) || compareText(a.id, b.id);
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function firstGrapheme(value: string, ctx: ListContext): string {
  const first = ctx.graphemes.segment(value)[Symbol.iterator]().next();
  return first.done ? "" : first.value.segment;
}

/** Accent removal is limited to Latin graphemes so other scripts retain vowel marks. */
export function fold(value: string, ctx: ListContext): string {
  const lower = Array.from(
    value.toLocaleLowerCase(ctx.locale).normalize("NFD"),
    (point) => caseFolding[point] ?? point,
  ).join("");
  return /\p{Script=Latin}/u.test(lower) ? lower.replace(/\p{M}/gu, "") : lower;
}

export interface SearchField {
  field: HighlightField;
  index: number;
  value: string;
}

export function nameFields(contact: ListContact): SearchField[] {
  const fields: SearchField[] = [];
  for (const field of ["displayName", "givenName", "familyName"] as const) {
    if (contact[field] !== undefined) fields.push({ field, index: 0, value: contact[field] });
  }
  return fields;
}

/** Each folded UTF-16 unit maps back to the entire source grapheme. */
export function mappedText(value: string, ctx: ListContext, digits = false) {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const part of ctx.graphemes.segment(value)) {
    const normalized = digits ? part.segment.replace(/[^0-9]/g, "") : fold(part.segment, ctx);
    folded += normalized;
    for (let unit = 0; unit < normalized.length; unit++) {
      starts.push(part.index);
      ends.push(part.index + part.segment.length);
    }
  }
  return { folded, starts, ends };
}
