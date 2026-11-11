// AUTHORED-BY Codex GPT-6.1-Sol
import type { NoteColour, NotesPreferences } from "./model/prefs";
import type { NoteChanges, StoredNote } from "./model/store";

export type NotesBulkAction =
  | { type: "archive" | "unarchive" | "trash" | "restore" | "deleteForever" | "pin" | "unpin" }
  | { type: "colour"; value: NoteColour }
  | { type: "addLabel" | "removeLabel"; label: string };

export const bulkActionLabels = {
  archive: "Archive",
  unarchive: "Unarchive",
  trash: "Move to trash",
  restore: "Restore",
  deleteForever: "Delete forever",
  pin: "Pin",
  unpin: "Unpin",
  colour: "Colour",
  addLabel: "Add label",
  removeLabel: "Remove label",
};

/** Intersect folder permissions; pending captures and read-only notes cannot be mutated. */
export function notesBulkActions(notes: readonly StoredNote[]): NotesBulkAction["type"][] {
  if (
    !notes.length ||
    notes.some((note) => note.readOnly || (note.etag === null && note.url.includes("/pending-")))
  )
    return [];
  if (notes.every((note) => note.location === "trashed")) return ["restore", "deleteForever"];
  if (notes.some((note) => note.location === "trashed")) return [];
  return [
    ...(notes.some((note) => note.location === "active") ? ["archive" as const] : []),
    ...(notes.some((note) => note.location === "archived") ? ["unarchive" as const] : []),
    "trash",
    "colour",
    "addLabel",
    "removeLabel",
    ...(notes.every((note) => note.location === "active")
      ? ["pin" as const, "unpin" as const]
      : []),
  ];
}

export function bulkNeedsConnection(type: NotesBulkAction["type"]) {
  return !["pin", "unpin", "colour"].includes(type);
}

export interface NotesBulkPaths {
  move: (
    note: StoredNote,
    action: "archive" | "unarchive" | "trash" | "restore",
  ) => Promise<unknown>;
  save: (note: StoredNote, changes: NoteChanges) => Promise<unknown>;
  deleteForever: (note: StoredNote) => Promise<unknown>;
  pin: (url: string) => void;
  colour: (url: string, value: NoteColour) => void;
  prefs: NotesPreferences;
}

/** Each note follows its single-note write path. A failure never rolls back another note. */
export async function applyNotesBulk(
  notes: readonly StoredNote[],
  action: NotesBulkAction,
  paths: NotesBulkPaths,
) {
  const succeeded: StoredNote[] = [];
  const failed: { note: StoredNote; error: unknown }[] = [];
  for (const note of notes) {
    try {
      const allowed = notesBulkActions([note]);
      const atDestination =
        (action.type === "archive" && note.location === "archived") ||
        (action.type === "unarchive" && note.location === "active");
      if (!allowed.includes(action.type) && !(atDestination && allowed.includes("trash")))
        throw new Error("This action is unavailable for this note");
      // Search and reminders can mix active and archived notes. Already at the
      // requested destination counts as success without another move or new ETag.
      if (atDestination) {
        succeeded.push(note);
        continue;
      }
      switch (action.type) {
        case "pin":
        case "unpin":
          if (paths.prefs.pinned.includes(note.url) !== (action.type === "pin"))
            paths.pin(note.url);
          break;
        case "colour":
          paths.colour(note.url, action.value);
          break;
        case "addLabel":
        case "removeLabel": {
          const labels =
            action.type === "addLabel"
              ? [...new Set([...note.labels, action.label])]
              : note.labels.filter((label) => label !== action.label);
          await paths.save(note, { labels });
          break;
        }
        case "deleteForever":
          await paths.deleteForever(note);
          break;
        default:
          await paths.move(note, action.type);
      }
      succeeded.push(note);
    } catch (error) {
      failed.push({ note, error });
    }
  }
  return { succeeded, failed };
}

export function bulkFailureMessage(failed: number, total: number, action: NotesBulkAction) {
  const outcome = {
    archive: "archived",
    unarchive: "unarchived",
    trash: "moved to trash",
    restore: "restored",
    deleteForever: "deleted forever",
    pin: "pinned",
    unpin: "unpinned",
    colour: "coloured",
    addLabel: "labelled",
    removeLabel: "updated",
  };
  return `${failed} of ${total} notes couldn't be ${outcome[action.type]}`;
}
