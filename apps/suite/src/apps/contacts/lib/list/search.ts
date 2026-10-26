// AUTHORED-BY Codex GPT-6.1-Sol
import { normalisePhone } from "../dedupe/normalise";
import { compareContacts, compareText, mappedText, nameFields, type SearchField } from "./text";
import type { ContactSearchResult, HighlightRange, ListContact, ListOptions } from "./types";
import { ContactListError, context, type ListContext, text, validateContacts } from "./validation";

interface Match {
  score: number;
  range: HighlightRange;
}

/** One insertion, deletion or substitution over Unicode code points; no transposition. */
function oneEdit(a: string, b: string): boolean {
  const left = Array.from(a);
  const right = Array.from(b);
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return true;
}

function substring(
  field: SearchField,
  term: string,
  ctx: ListContext,
  score: number,
  digits = false,
): Match[] {
  const mapped = mappedText(field.value, ctx, digits);
  const start = mapped.folded.indexOf(term);
  if (start < 0) return [];
  return [
    {
      score,
      range: {
        field: field.field,
        index: field.index,
        start: mapped.starts[start] as number,
        end: mapped.ends[start + term.length - 1] as number,
      },
    },
  ];
}

function matches(contact: ListContact, term: string, ctx: ListContext): Match | undefined {
  const hits: Match[] = [];
  for (const field of nameFields(contact)) {
    for (const word of ctx.words.segment(field.value)) {
      if (!word.isWordLike) continue;
      const mapped = mappedText(word.segment, ctx);
      if (mapped.folded.startsWith(term)) {
        hits.push({
          score: 500,
          range: {
            field: field.field,
            index: 0,
            start: word.index,
            end: word.index + (mapped.ends[term.length - 1] as number),
          },
        });
      } else if (Array.from(term).length >= 3 && oneEdit(term, mapped.folded)) {
        hits.push({
          score: 50,
          range: {
            field: field.field,
            index: 0,
            start: word.index,
            end: word.index + word.segment.length,
          },
        });
      }
    }
    hits.push(...substring(field, term, ctx, 100));
  }
  for (const [index, value] of (contact.emails ?? []).entries()) {
    hits.push(...substring({ field: "emails", index, value }, term, ctx, 400));
  }
  if (/^[0-9]+$/.test(term)) {
    for (const [index, value] of (contact.phones ?? []).entries()) {
      hits.push(...substring({ field: "phones", index, value }, term, ctx, 300, true));
    }
  }
  if (contact.organization !== undefined) {
    hits.push(
      ...substring(
        { field: "organization", index: 0, value: contact.organization },
        term,
        ctx,
        200,
      ),
    );
  }
  // Stable construction order selects the first field/array entry for equal tiers.
  return hits.sort((a, b) => b.score - a.score)[0];
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  ranges.sort((a, b) => compareText(a.field, b.field) || a.index - b.index || a.start - b.start);
  const result: HighlightRange[] = [];
  for (const range of ranges) {
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.field === range.field &&
      previous.index === range.index &&
      previous.end >= range.start
    ) {
      result[result.length - 1] = { ...previous, end: Math.max(previous.end, range.end) };
    } else result.push(range);
  }
  return result;
}

function queryTerms(query: string, ctx: ListContext): string[] {
  text(query, "invalid-query");
  if (query.length > 256) throw new ContactListError("invalid-query");
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (/^[+0-9 .()-]+$/.test(trimmed) && /[0-9]/.test(trimmed)) {
    try {
      return [normalisePhone(trimmed).replace("+", "")];
    } catch {
      throw new ContactListError("invalid-query");
    }
  }
  const terms = trimmed.split(/\s+/u).map((term) => mappedText(term, ctx).folded);
  if (terms.length > 16 || terms.some((term) => !term)) throw new ContactListError("invalid-query");
  return [...new Set(terms)];
}

/** AND search, strongest field per term. An empty query returns all contacts alphabetically. */
export function searchContacts(
  contacts: readonly ListContact[],
  query: string,
  options: ListOptions = {},
): ContactSearchResult[] {
  validateContacts(contacts);
  const ctx = context(options);
  const terms = queryTerms(query, ctx);
  const results: { result: ContactSearchResult; total: number }[] = [];
  for (const contact of contacts) {
    const hits: Match[] = [];
    for (const term of terms) {
      const match = matches(contact, term, ctx);
      if (!match) break;
      hits.push(match);
    }
    if (hits.length !== terms.length) continue;
    const score = hits.length ? Math.min(...hits.map((hit) => hit.score)) : 0;
    results.push({
      result: { contact, score, highlights: mergeRanges(hits.map((hit) => hit.range)) },
      total: hits.reduce((sum, hit) => sum + hit.score, 0),
    });
  }
  return results
    .sort(
      (a, b) =>
        b.result.score - a.result.score ||
        b.total - a.total ||
        compareContacts(a.result.contact, b.result.contact, ctx),
    )
    .map(({ result }) => result);
}
