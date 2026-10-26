// AUTHORED-BY Codex GPT-6.1-Sol
import { assertLabels, NotesError } from "./validation";

export interface LabelledNote {
  readonly labels: readonly string[];
}

export type LabelFilterMode = "union" | "intersection";

/** Exact label identity; no trimming, case folding, or Unicode normalisation. */
export function unionLabels(left: readonly string[], right: readonly string[]): string[] {
  assertLabels(left);
  assertLabels(right);
  return [...new Set([...left, ...right])];
}

/** Deduplicate while retaining the left operand's first-seen order. */
export function intersectLabels(left: readonly string[], right: readonly string[]): string[] {
  assertLabels(left);
  assertLabels(right);
  const wanted = new Set(right);
  return [...new Set(left)].filter((label) => wanted.has(label));
}

/** Union = any selected label, intersection = all. Empty selection disables filtering. */
export function filterNotesByLabels<T extends LabelledNote>(
  notes: readonly T[],
  selected: readonly string[],
  mode: LabelFilterMode,
): T[] {
  assertLabels(selected);
  if (!Array.isArray(notes) || (mode !== "union" && mode !== "intersection")) {
    throw new NotesError("invalid-input", "Expected notes and a supported label filter mode");
  }
  // Validate every note before filtering, including when the selection is empty.
  for (const note of notes) {
    if (note === null || typeof note !== "object") {
      throw new NotesError("invalid-input", "Expected a labelled note");
    }
    assertLabels(note.labels);
  }
  return notes.filter((note) => {
    if (selected.length === 0) return true;
    const labels = new Set(note.labels);
    return mode === "union"
      ? selected.some((label) => labels.has(label))
      : selected.every((label) => labels.has(label));
  });
}
