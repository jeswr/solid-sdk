// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  createSelection,
  ListError,
  type ListErrorCode,
  type SelectionAction,
  type SelectionState,
  selectionReducer,
} from "../src/apps/drive/lib/list";

const ids = Object.freeze(["a", "b", "c", "d", "e"]);
function reduce(state: SelectionState, action: SelectionAction, visible = ids): SelectionState {
  return selectionReducer(state, action, visible);
}
function clicked(id: string): SelectionState {
  return reduce(createSelection(), { type: "click", id });
}
function fails(run: () => unknown, code: ListErrorCode): void {
  expect(run).toThrow(ListError);
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("Drive selection reducer", () => {
  it("click selects just one and clear resets focus/anchor on Escape or navigation", () => {
    expect(createSelection()).toEqual({ selected: [], anchor: null, focus: null });
    expect(clicked("b")).toEqual({ selected: ["b"], anchor: "b", focus: "b" });
    const many = reduce(clicked("b"), { type: "range", id: "d" });
    expect(reduce(many, { type: "click", id: "a" })).toEqual(clicked("a"));
    expect(reduce(many, { type: "clear" })).toEqual(createSelection());
  });

  it("Ctrl/Cmd toggle adds/removes without mutating the prior state", () => {
    const state = Object.freeze({ selected: Object.freeze(["a"]), anchor: "a", focus: "a" });
    const added = reduce(state, { type: "toggle", id: "c" });
    expect(added).toEqual({ selected: ["a", "c"], anchor: "c", focus: "c" });
    expect(reduce(added, { type: "toggle", id: "c" })).toEqual({
      selected: ["a"],
      anchor: "c",
      focus: "c",
    });
    expect(state.selected).toEqual(["a"]);
    expect(reduce(clicked("a"), { type: "toggle", id: "a" }).selected).toEqual([]);
  });

  it("ranges include both ends, extend and shrink in either direction with a fixed anchor", () => {
    const state = clicked("c");
    const backwards = reduce(state, { type: "range", id: "a" });
    expect(backwards).toEqual({ selected: ["a", "b", "c"], anchor: "c", focus: "a" });
    expect(reduce(backwards, { type: "range", id: "d", additive: false })).toEqual({
      selected: ["c", "d"],
      anchor: "c",
      focus: "d",
    });
    expect(reduce(backwards, { type: "range", id: "c" }).selected).toEqual(["c"]);
    expect(reduce(createSelection(), { type: "range", id: "b" })).toEqual(clicked("b"));
  });

  it("supports additive ranges and a focus fallback without inventing an anchor", () => {
    const state: SelectionState = { selected: ["e", "c"], anchor: "a", focus: "a" };
    expect(reduce(state, { type: "range", id: "c", additive: true }).selected).toEqual([
      "e",
      "c",
      "a",
      "b",
    ]);
    expect(reduce({ selected: [], anchor: null, focus: "b" }, { type: "range", id: "d" })).toEqual({
      selected: ["b", "c", "d"],
      anchor: "b",
      focus: "d",
    });
  });

  it("keyboard movement establishes an anchor without changing selection, then Shift extends", () => {
    const state = reduce(clicked("a"), { type: "keyboard", id: "b", extend: false });
    expect(state).toEqual({ selected: ["a"], anchor: "b", focus: "b" });
    const down = reduce(state, { type: "keyboard", id: "d", extend: true });
    expect(down).toEqual({ selected: ["b", "c", "d"], anchor: "b", focus: "d" });
    expect(reduce(down, { type: "keyboard", id: "c", extend: true }).selected).toEqual(["b", "c"]);
    expect(reduce(createSelection(), { type: "keyboard", id: "e", extend: true })).toEqual(
      clicked("e"),
    );
  });

  it("preserves IDs across sort/view changes and ranges against the new visible order", () => {
    const state = reduce(clicked("b"), { type: "toggle", id: "d" });
    const reverse = ["e", "d", "c", "b", "a"];
    expect(reduce(state, { type: "range", id: "b" }, reverse)).toEqual({
      selected: ["d", "c", "b"],
      anchor: "d",
      focus: "b",
    });
    const filtered = reduce(state, { type: "toggle", id: "a" }, ["a", "b"]);
    expect(filtered.selected).toEqual(["b", "d", "a"]);
    expect(
      reduce(state, { type: "keyboard", id: "b", extend: false }, ["a", "b"]).selected,
    ).toEqual(["b", "d"]);
  });

  it("select-all replaces selection with exactly visible IDs and handles empty lists", () => {
    expect(reduce(clicked("e"), { type: "select-all" }, ["b", "d"])).toEqual({
      selected: ["b", "d"],
      anchor: "b",
      focus: "b",
    });
    expect(reduce(clicked("a"), { type: "select-all" }, [])).toEqual(createSelection());
    const selected = reduce(createSelection(), { type: "select-all" });
    expect(selected.selected).toEqual(ids);
    expect(selected.selected).not.toBe(ids);
  });

  it.each([
    null,
    [],
    {},
    { selected: null, anchor: null, focus: null },
    { selected: ["a", "a"], anchor: null, focus: null },
    { selected: [""], anchor: null, focus: null },
    { selected: [7], anchor: null, focus: null },
    { selected: ["\ud800"], anchor: null, focus: null },
    { selected: [], anchor: 7, focus: null },
    { selected: [], anchor: "", focus: null },
    { selected: [], anchor: null, focus: 7 },
    { selected: [], anchor: null, focus: " " },
  ])("rejects malformed state (%j)", (state) => {
    fails(() => reduce(state as SelectionState, { type: "clear" }), "invalid-selection");
  });

  it.each([
    null,
    ["a", "a"],
    [""],
    new Array(1),
  ])("rejects malformed visible IDs (%j)", (visible) => {
    fails(
      () => reduce(createSelection(), { type: "select-all" }, visible as string[]),
      "invalid-selection",
    );
  });

  it.each([
    null,
    [],
    {},
    { type: "invalid" },
    { type: "click" },
    { type: "toggle", id: "" },
    { type: "click", id: 7 },
    { type: "range", id: "a", additive: "yes" },
    { type: "keyboard", id: "a", extend: 1 },
    { type: "keyboard", id: "a" },
  ])("rejects malformed actions (%j)", (action) => {
    fails(() => reduce(createSelection(), action as SelectionAction), "invalid-action");
  });

  it("rejects absent targets or hidden range anchors, allowing a click to reset the anchor", () => {
    fails(() => reduce(createSelection(), { type: "click", id: "missing" }), "unknown-id");
    fails(() => reduce(clicked("e"), { type: "range", id: "a" }, ["a", "b"]), "unknown-id");
    fails(
      () => reduce({ selected: [], anchor: null, focus: "missing" }, { type: "range", id: "a" }),
      "unknown-id",
    );
    expect(reduce(clicked("e"), { type: "click", id: "a" }, ["a", "b"])).toEqual(clicked("a"));
  });
});
