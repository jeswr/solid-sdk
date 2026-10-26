// AUTHORED-BY Codex GPT-6.1-Sol
import { filterNotesByLabels, type LabelledNote } from "../labels";
import { assertLabels, NotesError } from "../validation";

function replaceLabel<T extends LabelledNote>(notes: readonly T[], from: string, to: string): T[] {
  return notes.map((note) => {
    if (!note.labels.includes(from) || from === to) return note;
    const labels = note.labels.map((label) => (label === from ? to : label));
    // Collapse only collisions introduced at the destination, preserving other labels.
    return {
      ...note,
      labels: labels.filter((label, index) => label !== to || labels.indexOf(label) === index),
    };
  });
}

/** Exact identity, atomic validation; a collision requires an explicit merge. */
export function renameLabel<T extends LabelledNote>(
  notes: readonly T[],
  from: string,
  to: string,
): T[] {
  assertLabels([from, to]);
  const validated = filterNotesByLabels(notes, [], "union");
  if (
    from !== to &&
    validated.some((note) => note.labels.includes(from)) &&
    validated.some((note) => note.labels.includes(to))
  ) {
    throw new NotesError("invalid-transition", "The destination label already exists; use merge");
  }
  return replaceLabel(validated, from, to);
}

/** Replace every source occurrence, keeping the first resulting destination position. */
export function mergeLabels<T extends LabelledNote>(
  notes: readonly T[],
  from: string,
  into: string,
): T[] {
  assertLabels([from, into]);
  return replaceLabel(filterNotesByLabels(notes, [], "union"), from, into);
}

/** Remove the label across all supplied notes, including archived and trashed notes. */
export function deleteLabel<T extends LabelledNote>(notes: readonly T[], label: string): T[] {
  assertLabels([label]);
  return filterNotesByLabels(notes, [], "union").map((note) =>
    note.labels.includes(label)
      ? { ...note, labels: note.labels.filter((candidate) => candidate !== label) }
      : note,
  );
}
