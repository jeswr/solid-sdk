// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  deleteLabel,
  mergeLabels,
  type NoteOrganisationAction,
  type NoteOrganisationState,
  NotesError,
  type NotesErrorCode,
  reduceNoteOrganisation,
  renameLabel,
} from "../src/apps/notes/lib/organise";

function fails(code: NotesErrorCode, operation: () => unknown): void {
  expect(operation).toThrow(NotesError);
  expect(operation).toThrow(expect.objectContaining({ name: "NotesError", code }));
}

const labels = Object.freeze(["Work", "Urgent"]);
const active = Object.freeze({ status: "active", pinned: false, labels } as const);
const pinned = Object.freeze({ ...active, pinned: true } as const);
const archived = Object.freeze({ status: "archived", pinned: false, labels } as const);
const trash = (state: NoteOrganisationState) => reduceNoteOrganisation(state, { type: "trash" });
const states = [active, pinned, archived] as const;

describe("note organisation transitions", () => {
  it.each(states)("trashes and exactly restores $status pinned=$pinned", (state) => {
    const trashed = trash(state);
    expect(trashed).toEqual({
      status: "trashed",
      pinned: false,
      labels,
      previous: { status: state.status, pinned: state.pinned },
    });
    expect(trashed).not.toBe(state);
    expect(reduceNoteOrganisation(trashed, { type: "trash" })).toBe(trashed);
    expect(reduceNoteOrganisation(trashed, { type: "restore" })).toEqual(state);
    expect(state.labels).toBe(labels);
    fails("invalid-transition", () => reduceNoteOrganisation(state, { type: "restore" }));
    for (const type of ["pin", "unpin", "archive", "unarchive"] as const) {
      fails("invalid-transition", () => reduceNoteOrganisation(trashed, { type }));
    }
    for (const type of ["add-label", "remove-label"] as const) {
      fails("invalid-transition", () => reduceNoteOrganisation(trashed, { type, label: "Work" }));
    }
  });

  it("pins/unpins active notes idempotently and clears pin when archiving", () => {
    for (const state of [active, pinned]) {
      expect(reduceNoteOrganisation(state, { type: "pin" })).toEqual(pinned);
      expect(reduceNoteOrganisation(state, { type: "unpin" })).toEqual(active);
      expect(reduceNoteOrganisation(state, { type: "archive" })).toEqual(archived);
      expect(reduceNoteOrganisation(state, { type: "unarchive" })).toEqual(state);
    }
    expect(reduceNoteOrganisation(archived, { type: "unarchive" })).toEqual(active);
    expect(reduceNoteOrganisation(archived, { type: "archive" })).toEqual(archived);
    expect(reduceNoteOrganisation(archived, { type: "unpin" })).toEqual(archived);
    fails("invalid-transition", () => reduceNoteOrganisation(archived, { type: "pin" }));
    const roundTrip = reduceNoteOrganisation(reduceNoteOrganisation(pinned, { type: "archive" }), {
      type: "unarchive",
    });
    expect(roundTrip).toEqual(active);
  });

  it.each(states)("adds/removes exact labels on $status pinned=$pinned", (state) => {
    expect(reduceNoteOrganisation(state, { type: "add-label", label: "Work" })).toEqual(state);
    const added = reduceNoteOrganisation(state, { type: "add-label", label: "work" });
    expect(added).toEqual({ ...state, labels: ["Work", "Urgent", "work"] });
    expect(reduceNoteOrganisation(added, { type: "remove-label", label: "work" })).toEqual(state);
    expect(reduceNoteOrganisation(state, { type: "remove-label", label: "missing" })).toEqual(
      state,
    );
    expect(reduceNoteOrganisation(state, { type: "remove-label", label: "Work" })).toEqual({
      ...state,
      labels: ["Urgent"],
    });
    expect(state.labels).toEqual(["Work", "Urgent"]);
  });

  it("preserves unrelated label duplicates and removes every selected occurrence", () => {
    const state = { ...active, labels: Object.freeze(["Work", "Work", "Urgent", "Urgent"]) };
    expect(reduceNoteOrganisation(state, { type: "add-label", label: "new" }).labels).toEqual([
      "Work",
      "Work",
      "Urgent",
      "Urgent",
      "new",
    ]);
    expect(reduceNoteOrganisation(state, { type: "remove-label", label: "Work" }).labels).toEqual([
      "Urgent",
      "Urgent",
    ]);
  });

  it.each([
    null,
    4,
    [],
    {},
    { status: "deleted", pinned: false, labels },
    { status: "active", pinned: 1, labels },
    { status: "archived", pinned: true, labels },
    { ...active, previous: "active" },
    { status: "trashed", pinned: true, previous: active, labels },
    { status: "trashed", pinned: false, labels },
    { status: "trashed", pinned: false, previous: null, labels },
    { status: "trashed", pinned: false, previous: { status: "archived", pinned: true }, labels },
    { status: "trashed", pinned: false, previous: { status: "trashed", pinned: false }, labels },
  ])("rejects invalid or impossible state %j", (state) => {
    fails("invalid-input", () =>
      reduceNoteOrganisation(state as NoteOrganisationState, { type: "trash" }),
    );
  });

  it.each([null, 3, [], {}, { type: "purge" }])("rejects unsupported action %j", (action) => {
    fails("invalid-input", () => reduceNoteOrganisation(active, action as NoteOrganisationAction));
  });

  it.each([
    undefined,
    null,
    [""],
    ["\ud800"],
    [7],
    new Array(1),
  ])("rejects malformed labels %j", (invalid) => {
    fails("invalid-input", () =>
      reduceNoteOrganisation({ ...active, labels: invalid as string[] }, { type: "trash" }),
    );
    for (const type of ["add-label", "remove-label"] as const) {
      fails("invalid-input", () =>
        reduceNoteOrganisation(active, { type, label: invalid as unknown as string }),
      );
    }
  });
});

describe("labels across notes", () => {
  const note = (id: string, state: NoteOrganisationState, values: readonly string[]) =>
    Object.freeze({
      ...state,
      id: `https://example.org/notes/${id}`,
      labels: Object.freeze(values),
    });
  const a = note("active", active, ["old", "keep", "old"]);
  const b = note("archived", archived, ["keep", "old"]);
  const c = note("trashed", trash(pinned), ["old"]);
  const untouched = note("other", active, ["Old", " old ", "é", "e\u0301"]);
  const notes = Object.freeze([a, b, c, untouched]);

  it("renames across every location while preserving note order, payload and inputs", () => {
    const result = renameLabel(notes, "old", "new");
    expect(result.map((n) => n.labels)).toEqual([
      ["new", "keep"],
      ["keep", "new"],
      ["new"],
      untouched.labels,
    ]);
    expect(result.map((n) => n.id)).toEqual(notes.map((n) => n.id));
    expect(result[0]).toEqual({ ...a, labels: ["new", "keep"] });
    expect(result[0]).not.toBe(a);
    expect(result[3]).toBe(untouched);
    expect(a.labels).toEqual(["old", "keep", "old"]);
    const restored = reduceNoteOrganisation(result[2] as NoteOrganisationState, {
      type: "restore",
    });
    expect(restored).toEqual({ ...pinned, labels: ["new"] });
  });

  it("rejects rename collisions anywhere, requiring explicit merge", () => {
    fails("invalid-transition", () => renameLabel(notes, "old", "keep"));
    const elsewhere = note("elsewhere", active, ["new"]);
    fails("invalid-transition", () => renameLabel([...notes, elsewhere], "old", "new"));
    expect(a.labels).toEqual(["old", "keep", "old"]);
  });

  it("merges overlapping memberships at the first resulting position", () => {
    const before = note("before", active, ["keep", "old", "other", "other", "keep"]);
    const result = mergeLabels([...notes, before], "old", "keep");
    expect(result.map((n) => n.labels)).toEqual([
      ["keep"],
      ["keep"],
      ["keep"],
      untouched.labels,
      ["keep", "other", "other"],
    ]);
    expect(result[3]).toBe(untouched);
    expect(before.labels).toEqual(["keep", "old", "other", "other", "keep"]);
    expect(mergeLabels(notes, "old", "new")).toEqual(renameLabel(notes, "old", "new"));
  });

  it("deletes labels without deleting notes or disturbing their saved trash state", () => {
    const result = deleteLabel(notes, "old");
    expect(result.map((n) => n.labels)).toEqual([["keep"], ["keep"], [], untouched.labels]);
    expect(result[3]).toBe(untouched);
    expect(result[2]).toEqual({ ...c, labels: [] });
    expect(reduceNoteOrganisation(result[2] as NoteOrganisationState, { type: "restore" })).toEqual(
      { ...pinned, labels: [] },
    );
    expect(deleteLabel(result, "old")).toEqual(result);
  });

  it("handles empty collections, absent sources and identical names idempotently", () => {
    for (const operation of [renameLabel, mergeLabels]) {
      expect(operation([], "old", "new")).toEqual([]);
      expect(operation(notes, "missing", "new")).toEqual(notes);
      expect(operation(notes, "missing", "keep")).toEqual(notes);
      const result = operation(notes, "old", "old");
      expect(result).toEqual(notes);
      expect(result).not.toBe(notes);
      expect(result[0]).toBe(a);
    }
    expect(deleteLabel([], "old")).toEqual([]);
    expect(deleteLabel(notes, "missing")).toEqual(notes);
  });

  it("validates the full collection and both label arguments before changing anything", () => {
    for (const operation of [renameLabel, mergeLabels]) {
      for (const invalid of [null, "", "\ud800", 5]) {
        fails("invalid-input", () => operation([], invalid as string, "new"));
        fails("invalid-input", () => operation([], "old", invalid as string));
      }
    }
    for (const invalid of [null, "", "\ud800", 5]) {
      fails("invalid-input", () => deleteLabel([], invalid as string));
    }
    for (const collection of [
      null,
      [a, null],
      [a, {}],
      [a, { labels: ["\ud800"] }],
      new Array(1),
    ]) {
      const invalid = collection as unknown as typeof notes;
      fails("invalid-input", () => renameLabel(invalid, "old", "new"));
      fails("invalid-input", () => mergeLabels(invalid, "old", "keep"));
      fails("invalid-input", () => deleteLabel(invalid, "old"));
    }
    expect(a.labels).toEqual(["old", "keep", "old"]);
  });
});
