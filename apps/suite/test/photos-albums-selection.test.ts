// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  AlbumError,
  type PhotoSelection,
  type SelectionAction,
  type SelectionGroup,
  selectionReducer,
} from "../src/apps/photos/lib/albums";
import { groupTimeline } from "../src/apps/photos/lib/library";

const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(
  (name) => `https://example.org/photos/${name}`,
) as [string, string, string, string, string];
const groups = Object.freeze([
  Object.freeze({ key: "2026-10-26", items: Object.freeze([a, b]) }),
  Object.freeze({ key: "empty-day", items: Object.freeze([]) }),
  Object.freeze({ key: "2026-10-25", items: Object.freeze([c, d]) }),
  Object.freeze({ key: "2026-10-24", items: Object.freeze([e]) }),
]);
const empty = Object.freeze({ selected: Object.freeze([]), anchor: null });
const reduce = (state: PhotoSelection, action: SelectionAction) =>
  selectionReducer(state, action, groups);

describe("photo selection reducer", () => {
  it("toggles arbitrary members with output in display order and an updated anchor", () => {
    let state = reduce(empty, { type: "toggle", id: d });
    expect(state).toEqual({ selected: [d], anchor: d });
    state = reduce(state, { type: "toggle", id: a });
    expect(state).toEqual({ selected: [a, d], anchor: a });
    state = reduce(state, { type: "toggle", id: a });
    expect(state).toEqual({ selected: [d], anchor: a });
    expect(reduce(state, { type: "range", id: c })).toEqual({ selected: [a, b, c], anchor: a });
    expect(empty).toEqual({ selected: [], anchor: null });
  });

  it("selects inclusive forward/backward ranges across group boundaries", () => {
    const anchor = Object.freeze({ selected: Object.freeze([b]), anchor: b });
    const first = reduce(anchor, { type: "range", id: e });
    expect(first).toEqual({ selected: [b, c, d, e], anchor: b });
    expect(reduce(first, { type: "range", id: c })).toEqual({ selected: [b, c], anchor: b });
    expect(reduce(first, { type: "range", id: a })).toEqual({ selected: [a, b], anchor: b });
    expect(reduce(first, { type: "range", id: b })).toEqual({ selected: [b], anchor: b });
    expect(anchor).toEqual({ selected: [b], anchor: b });
  });

  it("starts a range at the target without an anchor, replacing unrelated selections", () => {
    expect(reduce(empty, { type: "range", id: c })).toEqual({ selected: [c], anchor: c });
    expect(reduce({ selected: [a, e], anchor: null }, { type: "range", id: c })).toEqual({
      selected: [c],
      anchor: c,
    });
  });

  it("selects all and clears, resetting anchors including on an empty timeline", () => {
    expect(reduce({ selected: [b], anchor: b }, { type: "select-all" })).toEqual({
      selected: [a, b, c, d, e],
      anchor: null,
    });
    expect(reduce({ selected: [b], anchor: b }, { type: "clear" })).toEqual(empty);
    expect(selectionReducer(empty, { type: "clear" }, [])).toEqual(empty);
    expect(selectionReducer(empty, { type: "select-all" }, [])).toEqual(empty);
    expect(selectionReducer(empty, { type: "select-all" }, [groups[1] as SelectionGroup])).toEqual(
      empty,
    );
  });

  it("uses actual groupTimeline display order, including filters and reordered items", () => {
    const timeline = groupTimeline([a, b, c, d], (id) => [a, b, c, d].indexOf(id) * 86_400_000, {
      unit: "day",
    });
    expect(
      selectionReducer({ selected: [d], anchor: d }, { type: "range", id: a }, timeline),
    ).toEqual({ selected: [d, c, b, a], anchor: d });
    expect(
      selectionReducer({ selected: [a], anchor: a }, { type: "range", id: e }, [
        { key: "filtered", items: [a, c, e] },
      ]),
    ).toEqual({ selected: [a, c, e], anchor: a });
  });

  it.for([
    null,
    {},
    [null],
    [{ key: "", items: [] }],
    [{ key: "day", items: null }],
    [
      { key: "day", items: [] },
      { key: "day", items: [] },
    ],
    [{ key: "day", items: [a, a] }],
    [
      { key: "day", items: [a] },
      { key: "other", items: [a] },
    ],
    [{ key: "day", items: [null] }],
    [{ key: "day", items: [" "] }],
  ])("rejects invalid or ambiguous timeline groups %j", (input) => {
    expect(() =>
      selectionReducer(empty, { type: "clear" }, input as readonly SelectionGroup[]),
    ).toThrow(new AlbumError("invalid-selection"));
  });

  it.each([
    null,
    {},
    { selected: null, anchor: null },
    { selected: ["https://example.org/photos/missing"], anchor: null },
    { selected: [a, a], anchor: null },
    { selected: [], anchor: "https://example.org/photos/missing" },
    { selected: [], anchor: undefined },
  ])("rejects malformed/stale state even on clear %j", (state) => {
    expect(() => reduce(state as PhotoSelection, { type: "clear" })).toThrow(
      new AlbumError("invalid-selection"),
    );
  });

  it.each([
    null,
    {},
    { type: "unsupported" },
    { type: "toggle", id: "https://example.org/photos/missing" },
    { type: "range", id: "https://example.org/photos/missing" },
    { type: "toggle", id: null },
    { type: "range" },
  ])("rejects malformed actions and missing targets %j", (action) => {
    expect(() => reduce(empty, action as SelectionAction)).toThrow(
      new AlbumError("invalid-selection"),
    );
  });
});
