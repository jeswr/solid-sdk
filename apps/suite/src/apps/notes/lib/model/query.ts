// AUTHORED-BY Codex GPT-6.1-Sol
import { filterNotesByLabels, type LabelFilterMode } from "../labels";
import { orderNotes } from "../ordering";
import { rankNotes } from "../organise/search";
import type { Note, NoteLocation } from "./note";
import type { NotesPreferences } from "./prefs";
import { noteText } from "./text";

export interface NotesFilter {
  location: NoteLocation;
  labels?: readonly string[] | undefined;
  labelMode?: LabelFilterMode | undefined;
  query?: string | undefined;
}

export function selectNotes<T extends Note>(
  notes: readonly T[],
  prefs: NotesPreferences,
  filter: NotesFilter,
): { pinned: T[]; others: T[] } {
  const projected = filterNotesByLabels(
    notes.filter((note) => note.location === filter.location),
    filter.labels ?? [],
    filter.labelMode ?? "intersection",
  ).map((note) => {
    const time = Date.parse(note.modified ?? note.created ?? "");
    return {
      original: note,
      title: note.title,
      body: noteText(note.body),
      labels: note.labels,
      updatedAt: Number.isNaN(time) ? 0 : time,
      pinned: note.location === "active" && prefs.pinned.includes(note.url),
    };
  });
  const ordered = orderNotes(projected);
  const selected = filter.query?.trim()
    ? rankNotes(ordered, filter.query).map((hit) => hit.note)
    : ordered;
  return {
    pinned: selected.filter((note) => note.pinned).map((note) => note.original),
    others: selected.filter((note) => !note.pinned).map((note) => note.original),
  };
}
