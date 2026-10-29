// AUTHORED-BY Codex GPT-6.1-Sol
import { tokenize } from "../../../../lib/search";
import type { LabelledNote } from "../labels";
import { assertLabels, assertText, NotesError } from "../validation";

export interface SearchableNote extends LabelledNote {
  readonly title: string;
  /** Already projected plain text, never HTML or an editor document. */
  readonly body: string;
  /** Safe integer epoch milliseconds, matching the existing notes ordering contract. */
  readonly updatedAt: number;
}

export interface NoteSearchHit<T extends SearchableNote> {
  readonly note: T;
  readonly match: "phrase" | "prefix" | "token";
  /** Discrete relevance tier; repetition and field location do not alter the score. */
  readonly score: 3 | 2 | 1;
}

function terms(text: string): string[] {
  return tokenize(text).map((token) => token.term);
}

function sequence(field: readonly string[], query: readonly string[], prefix: boolean): boolean {
  return field.some((_, start) =>
    query.every((term, index) => {
      const word = field[start + index];
      return (
        word !== undefined &&
        (prefix && index === query.length - 1 ? word.startsWith(term) : word === term)
      );
    }),
  );
}

/**
 * Whole-word phrase > final-word prefix > all exact tokens across fields in any order.
 * A phrase cannot cross title/body/label boundaries. Unicode folding follows the suite
 * tokenizer. Equal tiers use recency descending, then stable input order. No pin boost
 * or location filter: the caller supplies the desired notes. Empty/wordless query = [].
 * All inputs are validated even for empty queries; the input array is never sorted.
 */
export function rankNotes<T extends SearchableNote>(
  notes: readonly T[],
  query: string,
): NoteSearchHit<T>[] {
  assertText(query);
  if (!Array.isArray(notes)) throw new NotesError("invalid-input", "Expected a note array");
  for (const note of notes) {
    if (note === null || typeof note !== "object" || !Number.isSafeInteger(note.updatedAt)) {
      throw new NotesError("invalid-input", "Invalid searchable note");
    }
    assertText(note.title);
    assertText(note.body);
    assertLabels(note.labels);
  }
  if (typeof Intl.Segmenter !== "function") {
    throw new NotesError("segmenter-unavailable", "Intl.Segmenter is required for notes search");
  }
  const words = terms(query);
  if (words.length === 0) return [];
  const hits: NoteSearchHit<T>[] = [];
  for (const note of notes) {
    const fields = [note.title, note.body, ...note.labels].map(terms);
    if (fields.some((field) => sequence(field, words, false))) {
      hits.push({ note, match: "phrase", score: 3 });
    } else if (fields.some((field) => sequence(field, words, true))) {
      hits.push({ note, match: "prefix", score: 2 });
    } else {
      const tokens = new Set(fields.flat());
      if (words.every((word) => tokens.has(word))) {
        hits.push({ note, match: "token", score: 1 });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}
