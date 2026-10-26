// AUTHORED-BY Codex GPT-6.1-Sol
import { NotesError } from "./validation";

export type NoteLocation = "active" | "archived";
export type NoteState =
  | { readonly status: NoteLocation }
  | { readonly status: "trashed"; readonly previous: NoteLocation };
export type NoteAction =
  | { readonly type: "archive" }
  | { readonly type: "unarchive" }
  | { readonly type: "trash" }
  | { readonly type: "restore" };

function isLocation(value: unknown): value is NoteLocation {
  return value === "active" || value === "archived";
}

/** Location only: no clock, persistence, purge, metadata changes, or hidden side effects. */
export function reduceNoteState(state: NoteState, action: NoteAction): NoteState {
  if (
    state === null ||
    typeof state !== "object" ||
    (!isLocation(state.status) && !(state.status === "trashed" && isLocation(state.previous)))
  ) {
    throw new NotesError("invalid-input", "Invalid note state");
  }
  if (action === null || typeof action !== "object") {
    throw new NotesError("invalid-input", "Expected a note action");
  }
  switch (action.type) {
    case "archive":
    case "unarchive":
      if (state.status === "trashed") {
        throw new NotesError("invalid-transition", "Restore the note before changing its location");
      }
      return { status: action.type === "archive" ? "archived" : "active" };
    case "trash":
      return state.status === "trashed" ? state : { status: "trashed", previous: state.status };
    case "restore":
      if (state.status !== "trashed") {
        throw new NotesError("invalid-transition", "Only trashed notes can be restored");
      }
      return { status: state.previous };
    default:
      throw new NotesError("invalid-input", "Unknown note action");
  }
}
