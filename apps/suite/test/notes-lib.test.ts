// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardTextExcerpt,
  filterNotesByLabels,
  intersectLabels,
  type NoteAction,
  type NoteState,
  NotesError,
  type NotesErrorCode,
  type OrderableNote,
  orderNotes,
  parseQuickCapture,
  reduceNoteState,
  unionLabels,
} from "../src/apps/notes/lib";
import { generateNKeysBetween } from "../src/lib/order";

function fails(code: NotesErrorCode, operation: () => unknown): void {
  expect(operation).toThrow(NotesError);
  expect(operation).toThrow(expect.objectContaining({ name: "NotesError", code }));
}

const note = (id: string, fields: Partial<OrderableNote> = {}) =>
  Object.freeze({ id: `https://example.org/notes/${id}`, pinned: false, updatedAt: 0, ...fields });

const labelled = (id: string, labels: readonly string[]) =>
  Object.freeze({ id, labels: Object.freeze(labels) });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("note ordering", () => {
  it("orders pinned sections before recency, leaves input untouched and ties stable", () => {
    const oldPin = note("pinned-old", { pinned: true, updatedAt: 1 });
    const newPin = note("pinned-new", { pinned: true, updatedAt: 5 });
    const older = note("older", { updatedAt: -10 });
    const newer = note("newer", { updatedAt: 10 });
    const equal = note("equal", { updatedAt: 10 });
    const input = Object.freeze([older, oldPin, newer, equal, newPin]);
    const sorted = orderNotes(input);
    expect(sorted).toEqual([newPin, oldPin, newer, equal, older]);
    expect(input).toEqual([older, oldPin, newer, equal, newPin]);
    expect(sorted).not.toBe(input);
    expect(sorted[0]).toBe(newPin);
    expect(orderNotes([])).toEqual([]);
    expect(orderNotes([older])).toEqual([older]);
  });

  it("uses binary SH-L1 key order rather than locale order or recency", () => {
    const keys = ["a", "Z", "9", "A", "z", "A1"];
    const input = keys.map((orderKey, updatedAt) => note(orderKey, { orderKey, updatedAt }));
    expect(orderNotes(input).map((n) => n.orderKey)).toEqual(["9", "A", "A1", "Z", "a", "z"]);
    const first = note("first", { orderKey: "A", updatedAt: 0 });
    const second = note("second", { orderKey: "A", updatedAt: 1 });
    expect(orderNotes([first, second])).toEqual([first, second]);
  });

  it("accepts shared generated keys and separate ordering modes for each pin section", () => {
    const notes = generateNKeysBetween(null, null, 100).map((orderKey, updatedAt) =>
      note(String(updatedAt), { orderKey, updatedAt }),
    );
    expect(orderNotes([...notes].reverse())).toEqual(notes);
    const pinned = note("pin", { pinned: true });
    expect(orderNotes([...notes, pinned])).toEqual([pinned, ...notes]);
    const keyedPin = note("keyed-pin", { pinned: true, orderKey: "Z" });
    expect(orderNotes([note("regular"), keyedPin])[0]).toBe(keyedPin);
  });

  it.each([false, true])("rejects mixed ordering within pinned=%s", (pinned) => {
    const a = note("a", { pinned });
    const b = note("b", { pinned, orderKey: "Z" });
    fails("mixed-ordering", () => orderNotes([a, b]));
    fails("mixed-ordering", () => orderNotes([b, a]));
  });

  it.each([
    "",
    "A0",
    "has space",
    "é",
    null,
    5,
  ])("rejects invalid key %j even in a singleton", (key) => {
    fails("invalid-order-key", () => orderNotes([note("invalid", { orderKey: key as string })]));
  });

  it.each([
    NaN,
    Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "today",
  ])("rejects invalid updatedAt %j even for keyed notes", (updatedAt) => {
    fails("invalid-input", () =>
      orderNotes([note("bad", { updatedAt: updatedAt as number, orderKey: "Z" })]),
    );
  });

  it("rejects malformed collections and note objects", () => {
    fails("invalid-input", () => orderNotes(null as unknown as OrderableNote[]));
    for (const invalid of [null, 5, {}, { pinned: "yes", updatedAt: 1 }]) {
      fails("invalid-input", () => orderNotes([invalid as OrderableNote]));
    }
  });
});

describe("labels", () => {
  const a = labelled("a", ["Work", "urgent", "Work"]);
  const b = labelled("b", ["Work"]);
  const c = labelled("c", ["urgent"]);
  const d = labelled("d", []);
  const notes = Object.freeze([a, b, c, d]);

  it("filters by any/all labels without mutation or duplication", () => {
    const selected = Object.freeze(["Work", "urgent", "Work"]);
    expect(filterNotesByLabels(notes, selected, "union")).toEqual([a, b, c]);
    expect(filterNotesByLabels(notes, selected, "intersection")).toEqual([a]);
    expect(filterNotesByLabels(notes, ["missing"], "union")).toEqual([]);
    expect(filterNotesByLabels(notes, ["missing"], "intersection")).toEqual([]);
    expect(filterNotesByLabels(notes, ["Work"], "intersection")).toEqual([a, b]);
    expect(notes).toEqual([a, b, c, d]);
  });

  it("treats an empty selection as no filter and returns fresh arrays", () => {
    for (const mode of ["union", "intersection"] as const) {
      const result = filterNotesByLabels(notes, [], mode);
      expect(result).toEqual(notes);
      expect(result).not.toBe(notes);
      expect(result[0]).toBe(a);
      expect(filterNotesByLabels([], [], mode)).toEqual([]);
    }
  });

  it("unions/intersects exact labels in first-seen order", () => {
    const left = Object.freeze(["z", "Work", "z", " work ", "é", "e\u0301"]);
    const right = Object.freeze(["Work", "work", "z", "work"]);
    expect(unionLabels(left, right)).toEqual(["z", "Work", " work ", "é", "e\u0301", "work"]);
    expect(intersectLabels(left, right)).toEqual(["z", "Work"]);
    expect(unionLabels([], [])).toEqual([]);
    expect(intersectLabels(left, [])).toEqual([]);
    expect(intersectLabels([], right)).toEqual([]);
    expect(filterNotesByLabels(notes, ["work"], "union")).toEqual([]);
  });

  it("validates all labels, even without selected filters or matching notes", () => {
    for (const labels of [null, [""], [3], ["\ud800"]]) {
      const invalid = labels as unknown as string[];
      fails("invalid-input", () => unionLabels(invalid, []));
      fails("invalid-input", () => unionLabels([], invalid));
      fails("invalid-input", () => intersectLabels(invalid, []));
      fails("invalid-input", () => intersectLabels([], invalid));
      fails("invalid-input", () => filterNotesByLabels([], invalid, "union"));
      fails("invalid-input", () => filterNotesByLabels([{ labels: invalid }], [], "union"));
    }
    fails("invalid-input", () => filterNotesByLabels(notes, [], "other" as "union"));
    fails("invalid-input", () => filterNotesByLabels(null as unknown as typeof notes, [], "union"));
    for (const invalid of [null, 3]) {
      fails("invalid-input", () =>
        filterNotesByLabels([invalid as unknown as typeof a], [], "union"),
      );
    }
  });
});

describe("location reducer", () => {
  const active = Object.freeze({ status: "active" } as const);
  const archived = Object.freeze({ status: "archived" } as const);
  const trashActive = Object.freeze({ status: "trashed", previous: "active" } as const);
  const trashArchived = Object.freeze({ status: "trashed", previous: "archived" } as const);

  it.each([active, archived])("archives, unarchives and trashes $status", (state) => {
    expect(reduceNoteState(state, { type: "archive" })).toEqual(archived);
    expect(reduceNoteState(state, { type: "unarchive" })).toEqual(active);
    const trashed = reduceNoteState(state, { type: "trash" });
    expect(trashed).toEqual({ status: "trashed", previous: state.status });
    expect(reduceNoteState(trashed, { type: "restore" })).toEqual(state);
    fails("invalid-transition", () => reduceNoteState(state, { type: "restore" }));
  });

  it.each([trashActive, trashArchived])("preserves trash origin $previous", (state) => {
    expect(reduceNoteState(state, { type: "trash" })).toBe(state);
    fails("invalid-transition", () => reduceNoteState(state, { type: "archive" }));
    fails("invalid-transition", () => reduceNoteState(state, { type: "unarchive" }));
  });

  it.each([
    null,
    3,
    {},
    { status: "deleted" },
    { status: "trashed" },
    { status: "trashed", previous: "trashed" },
  ])("rejects invalid state %j", (state) =>
    fails("invalid-input", () => reduceNoteState(state as NoteState, { type: "trash" })));

  it.each([null, 3, {}, { type: "purge" }])("rejects invalid action %j", (action) => {
    fails("invalid-input", () => reduceNoteState(active, action as NoteAction));
  });
});

describe("quick capture", () => {
  it("splits title, prose and checklist lines, normalising only CRLF", () => {
    const text =
      "Market trip\r\n  Remember the bag  \r\n[ ] Apples\r\n[x] Bread\r\n- [ ] Pears\r\n- [x] Tea\r\n\r\nFor Robin";
    expect(parseQuickCapture(text)).toEqual({
      title: "Market trip",
      body: "  Remember the bag  \n\nFor Robin",
      items: [
        { text: "Apples", checked: false },
        { text: "Bread", checked: true },
        { text: "Pears", checked: false },
        { text: "Tea", checked: true },
      ],
    });
  });

  it("supports checklist-only, title-only and body-only capture without inventing titles", () => {
    expect(parseQuickCapture("[x] Done\n[ ] Next")).toEqual({
      title: "",
      body: "",
      items: [
        { text: "Done", checked: true },
        { text: "Next", checked: false },
      ],
    });
    expect(parseQuickCapture("Title")).toEqual({ title: "Title", body: "", items: [] });
    expect(parseQuickCapture("\nBody\n")).toEqual({ title: "", body: "Body\n", items: [] });
    expect(parseQuickCapture("[ ] Item\nProse")).toEqual({
      title: "",
      body: "Prose",
      items: [{ text: "Item", checked: false }],
    });
  });

  it("preserves literal prose, Unicode and item whitespace", () => {
    expect(
      parseQuickCapture(
        "  Title 👩🏽‍💻  \n<a>literal</a>\n[link](https://example.org)\nText [x] inline\n[ ]  café  ",
      ),
    ).toEqual({
      title: "  Title 👩🏽‍💻  ",
      body: "<a>literal</a>\n[link](https://example.org)\nText [x] inline",
      items: [{ text: " café  ", checked: false }],
    });
  });

  it.each([
    "",
    " \n\t",
    "Title\rBody",
    "[ ] ",
    "[x]   ",
    "[ ]",
    "[x]",
    "[x]text",
    "[X] Item",
    " [ ] Item",
    "\t[x] Item",
    "* [ ] Item",
    "+ [x] Item",
    "- - [ ] Nested",
    "[x",
    "[  ] Item",
    "Title\n  - [x] Nested",
  ])("rejects unsupported capture %j", (text) =>
    fails("unsupported-capture", () => parseQuickCapture(text)));

  it.each([null, 4, "bad\ud800", "\udc00bad"])("rejects invalid text %j", (text) => {
    fails("invalid-input", () => parseQuickCapture(text as string));
  });
});

describe("card excerpts", () => {
  it("counts extended graphemes across emoji, combining marks, flags and scripts", () => {
    const graphemes = ["e\u0301", "👩🏽‍💻", "🇬🇧", "👨‍👩‍👧‍👦", "क्‍ष", "\r\n", "Z"];
    const text = graphemes.join("");
    for (let n = 0; n <= graphemes.length + 1; n += 1) {
      expect(cardTextExcerpt(text, n)).toBe(graphemes.slice(0, n).join(""));
    }
  });

  it("preserves plain text and handles empty, zero, exact and oversized limits", () => {
    expect(cardTextExcerpt("", 0)).toBe("");
    expect(cardTextExcerpt("", 5)).toBe("");
    expect(cardTextExcerpt("abc", 0)).toBe("");
    expect(cardTextExcerpt("abc", 3)).toBe("abc");
    expect(cardTextExcerpt(" <b>\n", 100)).toBe(" <b>\n");
  });

  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "3",
  ])("rejects invalid limit %j", (limit) =>
    fails("invalid-input", () => cardTextExcerpt("text", limit as number)));

  it("rejects malformed Unicode and unavailable Segmenter without a fallback", () => {
    fails("invalid-input", () => cardTextExcerpt("\ud800", 0));
    fails("invalid-input", () => cardTextExcerpt(3 as unknown as string, 0));
    vi.spyOn(Intl, "Segmenter", "get").mockReturnValue(
      undefined as unknown as typeof Intl.Segmenter,
    );
    fails("segmenter-unavailable", () => cardTextExcerpt("text", 5));
  });
});
