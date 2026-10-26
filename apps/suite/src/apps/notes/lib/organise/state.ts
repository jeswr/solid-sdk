// AUTHORED-BY Codex GPT-6.1-Sol
import type { LabelledNote } from "../labels";
import { assertLabels, NotesError } from "../validation";

export type LiveNoteOrganisation =
  | { readonly status: "active"; readonly pinned: boolean }
  | { readonly status: "archived"; readonly pinned: false };

/** Labels remain on the note when trashed; only location and pin are snapshotted. */
export type NoteOrganisationState = LabelledNote &
  (
    | LiveNoteOrganisation
    | {
        readonly status: "trashed";
        readonly pinned: false;
        readonly previous: LiveNoteOrganisation;
      }
  );

export type NoteOrganisationAction =
  | { readonly type: "pin" | "unpin" | "archive" | "unarchive" | "trash" | "restore" }
  | { readonly type: "add-label" | "remove-label"; readonly label: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function live(value: unknown): value is LiveNoteOrganisation {
  return (
    record(value) &&
    !("previous" in value) &&
    ((value.status === "active" && typeof value.pinned === "boolean") ||
      (value.status === "archived" && value.pinned === false))
  );
}

/** Pure organisation projection; no note content, timestamps, persistence or purge. */
export function reduceNoteOrganisation(
  state: NoteOrganisationState,
  action: NoteOrganisationAction,
): NoteOrganisationState {
  if (
    !live(state) &&
    !(record(state) && state.status === "trashed" && state.pinned === false && live(state.previous))
  ) {
    throw new NotesError("invalid-input", "Invalid note organisation state");
  }
  assertLabels(state.labels);
  if (!record(action)) throw new NotesError("invalid-input", "Expected an organisation action");
  if (action.type === "trash") {
    return state.status === "trashed"
      ? state
      : {
          status: "trashed",
          pinned: false,
          previous: { status: state.status, pinned: state.pinned } as LiveNoteOrganisation,
          labels: state.labels,
        };
  }
  if (action.type === "restore") {
    if (state.status !== "trashed") {
      throw new NotesError("invalid-transition", "Only trashed notes can be restored");
    }
    return { ...state.previous, labels: state.labels };
  }
  if (state.status === "trashed") {
    throw new NotesError("invalid-transition", "Restore the note before editing its organisation");
  }
  switch (action.type) {
    case "pin":
      if (state.status === "archived") {
        throw new NotesError("invalid-transition", "Archived notes cannot be pinned");
      }
      return { ...state, pinned: true };
    case "unpin":
      return { ...state, pinned: false };
    case "archive":
      return { status: "archived", pinned: false, labels: state.labels };
    case "unarchive":
      return { status: "active", pinned: state.pinned, labels: state.labels };
    case "add-label":
    case "remove-label": {
      assertLabels([action.label]);
      const labels =
        action.type === "add-label"
          ? state.labels.includes(action.label)
            ? state.labels
            : [...state.labels, action.label]
          : state.labels.filter((label) => label !== action.label);
      return { ...state, labels };
    }
    default:
      throw new NotesError("invalid-input", "Unknown organisation action");
  }
}
