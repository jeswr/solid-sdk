// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { selectionReducer } from "../../src/apps/tasks/state/selection";
import { tasksCommand, viewModeShortcut } from "../../src/apps/tasks/state/shortcuts";

describe("Tasks shortcuts", () => {
  it.each([
    ["j", { type: "focus", direction: 1 }],
    ["ArrowDown", { type: "focus", direction: 1 }],
    ["k", { type: "focus", direction: -1 }],
    ["ArrowUp", { type: "focus", direction: -1 }],
    ["Enter", { type: "open" }],
    [" ", { type: "select" }],
    ["x", { type: "select" }],
    ["e", { type: "edit" }],
    ["Escape", { type: "clear" }],
    ["d", { type: "due" }],
    ["l", { type: "labels" }],
    ["r", { type: "repeat" }],
    ["Delete", { type: "delete" }],
    ["Backspace", { type: "delete" }],
    ["t", { type: "reschedule", days: 0 }],
    ["m", { type: "reschedule", days: 1 }],
    ["w", { type: "reschedule", days: 7 }],
    ...[1, 2, 3, 4].map((level): [string, { type: string; level: number }] => [
      String(level),
      { type: "priority", level },
    ]),
  ])("maps %s", (key, expected) => expect(tasksCommand({ key: key as string })).toEqual(expected));
  it("completes a nonempty selection; ignores composing/editable/modifier keys and unrelated shortcuts", () => {
    expect(tasksCommand({ key: "e" }, true)).toEqual({ type: "complete" });
    for (const input of [
      { key: "e", editable: true },
      { key: "e", isComposing: true },
      { key: "e", ctrlKey: true },
      { key: "e", metaKey: true },
      { key: "e", altKey: true },
      { key: "e", shiftKey: true },
      { key: "q" },
      { key: "ArrowDown", altKey: true, shiftKey: true },
    ])
      expect(tasksCommand(input)).toBeUndefined();
    expect(tasksCommand({ key: "F10", shiftKey: true })).toEqual({ type: "menu" });
    expect(tasksCommand({ key: "ArrowUp", altKey: true })).toEqual({
      type: "reorder",
      direction: -1,
    });
    expect(tasksCommand({ key: "ArrowDown", altKey: true })).toEqual({
      type: "reorder",
      direction: 1,
    });
  });
  it("toggles URL identities without mutating previous selections and clears", () => {
    const empty = new Set<string>();
    const one = selectionReducer(empty, { type: "toggle", url: "a" });
    const two = selectionReducer(one, { type: "toggle", url: "b" });
    expect([...empty]).toEqual([]);
    expect([...one]).toEqual(["a"]);
    expect([...two]).toEqual(["a", "b"]);
    expect([...selectionReducer(two, { type: "toggle", url: "a" })]).toEqual(["b"]);
    expect([...selectionReducer(two, { type: "clear" })]).toEqual([]);
    const pruned = selectionReducer(two, { type: "prune", visible: ["b", "c"] });
    expect([...pruned]).toEqual(["b"]);
    expect([...two]).toEqual(["a", "b"]);
    expect(selectionReducer(pruned, { type: "prune", visible: ["b"] })).toBe(pruned);
    expect(selectionReducer(empty, { type: "clear" })).toBe(empty);
  });
  it("extends with Shift+↑/↓ and selects every visible row with Cmd/Ctrl+A", () => {
    expect(tasksCommand({ key: "ArrowDown", shiftKey: true })).toEqual({
      type: "extend",
      direction: 1,
    });
    expect(tasksCommand({ key: "ArrowUp", shiftKey: true })).toEqual({
      type: "extend",
      direction: -1,
    });
    expect(tasksCommand({ key: "a", metaKey: true })).toEqual({ type: "selectAll" });
    expect(tasksCommand({ key: "A", ctrlKey: true })).toEqual({ type: "selectAll" });
    expect(tasksCommand({ key: "a", ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(tasksCommand({ key: "a", metaKey: true, altKey: true })).toBeUndefined();
    expect(tasksCommand({ key: "a", metaKey: true, editable: true })).toBeUndefined();
  });
  it("maps b to the board and Shift+L to the list outside editable fields", () => {
    expect(viewModeShortcut({ key: "b" })).toBe("board");
    expect(viewModeShortcut({ key: "L", shiftKey: true })).toBe("list");
    expect(viewModeShortcut({ key: "l", shiftKey: true })).toBe("list");
    for (const input of [
      { key: "b", shiftKey: true },
      { key: "l" },
      { key: "b", editable: true },
      { key: "b", isComposing: true },
      { key: "b", ctrlKey: true },
      { key: "b", metaKey: true },
      { key: "b", altKey: true },
    ])
      expect(viewModeShortcut(input)).toBeUndefined();
  });
  it("adds visible rows and selects anchor ranges over a base selection", () => {
    const base = new Set(["x"]);
    const visible = ["a", "b", "c", "d"];
    expect([...selectionReducer(base, { type: "add", urls: ["a", "b"] })]).toEqual(["x", "a", "b"]);
    expect(selectionReducer(base, { type: "add", urls: ["x"] })).toBe(base);
    const range = { type: "range" as const, base: ["x"], visible };
    expect([...selectionReducer(base, { ...range, anchor: "b", to: "d" })]).toEqual([
      "x",
      "b",
      "c",
      "d",
    ]);
    expect([...selectionReducer(base, { ...range, anchor: "c", to: "a" })]).toEqual([
      "x",
      "a",
      "b",
      "c",
    ]);
    expect(selectionReducer(base, { ...range, anchor: "missing", to: "a" })).toBe(base);
    expect(selectionReducer(base, { ...range, anchor: "a", to: "missing" })).toBe(base);
  });
});
