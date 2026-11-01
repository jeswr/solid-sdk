// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { selectionReducer } from "../../src/apps/tasks/state/selection";
import { tasksCommand } from "../../src/apps/tasks/state/shortcuts";

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
});
