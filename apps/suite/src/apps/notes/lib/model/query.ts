// AUTHORED-BY Codex GPT-6.1-Sol
import { filterNotesByLabels, type LabelFilterMode } from "../labels";
import { orderNotes } from "../ordering";
import { rankNotes } from "../organise/search";
import type { Note, NoteLocation } from "./note";
import type { NotesPreferences } from "./prefs";
import { noteText } from "./text";

export interface NotesFilter {
  location: NoteLocation | "reminders";
  now?: number;
  labels?: readonly string[] | undefined;
  labelMode?: LabelFilterMode | undefined;
  query?: string | undefined;
}

export function hasNoteReminder(note: Pick<Note, "reminder">): boolean {
  return Number.isFinite(Date.parse(note.reminder ?? ""));
}

export function selectNotes<T extends Note>(
  notes: readonly T[],
  prefs: NotesPreferences,
  filter: NotesFilter,
): { pinned: T[]; others: T[]; sections?: { title: string; notes: T[] }[] } {
  if (filter.location === "reminders") {
    const now = filter.now ?? Date.now();
    const reminders = notes.filter((note) => note.location !== "trashed" && hasNoteReminder(note));
    return {
      pinned: [],
      others: [],
      sections: [
        {
          title: "Upcoming",
          notes: reminders
            .filter((note) => Date.parse(note.reminder as string) > now)
            .sort((a, b) => Date.parse(a.reminder as string) - Date.parse(b.reminder as string)),
        },
        {
          title: "Past",
          notes: reminders
            .filter((note) => Date.parse(note.reminder as string) <= now)
            .sort((a, b) => Date.parse(b.reminder as string) - Date.parse(a.reminder as string)),
        },
      ],
    };
  }
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
