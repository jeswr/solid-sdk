// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Synthetic fixtures and asserted array sizes establish these entries.
import { describe, expect, it } from "vitest";
import {
  BoardError,
  type BoardTask,
  bulkReorderDiff,
  groupByStatus,
  moveToColumn,
} from "../src/apps/tasks/lib/board";
import { generateNKeysBetween } from "../src/lib/order";

const statuses = ["todo", "doing", "done"] as const;
const task = (id: string, orderKey: string, status = "todo"): BoardTask => ({
  id: `https://example.org/tasks/${id}`,
  status,
  orderKey,
});
const a = task("a", "A");
const b = task("b", "B");
const c = task("c", "C");
const d = task("d", "D", "doing");
const tasks = [c, d, a, b];

function expectError(fn: () => unknown, code: BoardError["code"] = "invalid-input") {
  expect(fn).toThrow(BoardError);
  expect(fn).toThrow(expect.objectContaining({ name: "BoardError", code }));
}

function apply(snapshot: readonly BoardTask[], changes: readonly BoardTask[]) {
  return snapshot.map((item) => changes.find((change) => change.id === item.id) ?? item);
}

describe("status columns", () => {
  it("preserves configured column order, groups and sorts without mutating input", () => {
    const input = Object.freeze(
      tasks.map((item) => Object.freeze({ ...item, title: "Plan picnic" })),
    );
    const columns = groupByStatus(input, ["done", "todo", "doing"]);
    expect(columns.map(({ status, wipCount }) => [status, wipCount])).toEqual([
      ["done", 0],
      ["todo", 3],
      ["doing", 1],
    ]);
    expect(columns[1]!.tasks.map((item) => item.id)).toEqual([a.id, b.id, c.id]);
    expect(columns[1]!.tasks[0]).toBe(input[2]);
    expect(input.map((item) => item.id)).toEqual(tasks.map((item) => item.id));
    expect(groupByStatus([], [])).toEqual([]);
  });

  it("uses byte ordering across digits, capitals and lowercase", () => {
    const keys = ["a", "Z", "1", "AV", "A"];
    expect(
      groupByStatus(
        keys.map((key) => task(key, key)),
        statuses,
      )[0]!.tasks.map((t) => t.orderKey),
    ).toEqual(["1", "A", "AV", "Z", "a"]);
  });

  it.each(["", "A0", "-1", "a_", "a\n", 3, null, undefined])("rejects malformed key %s", (key) => {
    expectError(
      () => groupByStatus([{ ...a, orderKey: key } as BoardTask], statuses),
      "invalid-order",
    );
  });

  it("rejects collisions within a column but allows equal keys across columns", () => {
    expectError(() => groupByStatus([a, { ...b, orderKey: "A" }], statuses), "invalid-order");
    expect(groupByStatus([a, { ...d, orderKey: "A" }], statuses)[1]!.wipCount).toBe(1);
  });

  it.each([
    [null, statuses],
    [[null], statuses],
    [[5], statuses],
    [[{ ...a, id: " " }], statuses],
    [[{ ...a, id: 7 }], statuses],
    [[{ ...a, status: "" }], statuses],
    [[a, a], statuses],
    [[], null],
    [[], ["todo", "todo"]],
    [[], [""]],
    [[], [3]],
    [[], Array(1)],
  ])("rejects invalid projections and status definitions", (input, definitions) => {
    expectError(() => groupByStatus(input as BoardTask[], definitions as string[]));
  });

  it("rejects unknown task statuses without inventing a fallback", () => {
    expectError(() => groupByStatus([{ ...a, status: "archived" }], statuses), "unknown-status");
    expectError(() => groupByStatus([a], []), "unknown-status");
  });
});

describe("moves", () => {
  it.each([0, 1])("moves into a populated column at index %s", (index) => {
    const changes = moveToColumn(tasks, statuses, b.id, "doing", index);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: b.id, status: "doing" });
    const column = groupByStatus(apply(tasks, changes), statuses)[1]!;
    expect(column.tasks[index]!.id).toBe(b.id);
    expect(column.wipCount).toBe(2);
    expect(groupByStatus(apply(tasks, changes), statuses)[0]!.wipCount).toBe(2);
  });

  it("moves into an empty column and leaves all other tasks unchanged", () => {
    const changes = moveToColumn(tasks, statuses, a.id, "done", 0);
    expect(changes).toEqual([{ id: a.id, status: "done", orderKey: "V" }]);
    expect(apply(tasks, changes).filter((item) => item.id !== a.id)).toEqual([c, d, b]);
  });

  it("inserts between fractional neighbors and uses post-removal indices", () => {
    const changes = moveToColumn(tasks, statuses, c.id, "todo", 1);
    expect(changes).toEqual([{ id: c.id, status: "todo", orderKey: "AV" }]);
    expect(moveToColumn(tasks, statuses, a.id, "todo", 2)[0]!.orderKey > c.orderKey).toBe(true);
    expect(moveToColumn(tasks, statuses, c.id, "todo", 0)[0]!.orderKey < a.orderKey).toBe(true);
    expect(moveToColumn([a], statuses, a.id, "todo", 0)).toEqual([]);
    expect(moveToColumn(tasks, statuses, b.id, "todo", 1)).toEqual([]);
  });

  it("handles arbitrarily close valid keys with the shared order generator", () => {
    const close = [{ ...a, orderKey: "A000001" }, { ...b, orderKey: "A000002" }, d];
    const changes = moveToColumn(close, statuses, d.id, "todo", 1);
    expect(changes[0]!.orderKey > close[0]!.orderKey).toBe(true);
    expect(changes[0]!.orderKey < close[1]!.orderKey).toBe(true);
  });

  it.each([
    -1,
    4,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    null,
  ])("rejects invalid destination index %s", (index) => {
    expectError(() => moveToColumn(tasks, statuses, a.id, "todo", index as number));
  });

  it("rejects missing tasks and unknown columns", () => {
    expectError(() => moveToColumn(tasks, statuses, "missing", "todo", 0));
    expectError(() => moveToColumn(tasks, statuses, "", "todo", 0));
    expectError(() => moveToColumn(tasks, statuses, a.id, "", 0));
    expectError(() => moveToColumn(tasks, statuses, a.id, "missing", 0), "unknown-status");
  });
});

describe("minimal bulk reordering", () => {
  it("returns no changes for empty, singleton, or already ordered columns", () => {
    expect(bulkReorderDiff([], statuses, "todo", [])).toEqual([]);
    expect(bulkReorderDiff([a], statuses, "todo", [a.id])).toEqual([]);
    expect(bulkReorderDiff(tasks, statuses, "todo", [a.id, b.id, c.id])).toEqual([]);
  });

  it("changes only the moved key, retaining a maximal subsequence", () => {
    const changes = bulkReorderDiff(tasks, statuses, "todo", [c.id, a.id, b.id]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.id).toBe(c.id);
    expect(changes[0]!.orderKey < "A").toBe(true);
    expect(bulkReorderDiff(tasks, statuses, "todo", [b.id, c.id, a.id])[0]!.id).toBe(a.id);
  });

  it("fills multiple gaps, preserves other columns and resolves ties deterministically", () => {
    const input = [...tasks, task("e", "E"), task("f", "F")];
    const ids = [b.id, a.id, c.id, input[5]!.id, input[4]!.id];
    const changes = bulkReorderDiff(input, statuses, "todo", ids);
    expect(changes.map((change) => change.id)).toEqual([a.id, input[4]!.id]);
    const result = apply(input, changes);
    expect(groupByStatus(result, statuses)[0]!.tasks.map((item) => item.id)).toEqual(ids);
    expect(result[1]).toBe(d);
    expect(bulkReorderDiff(input, statuses, "todo", ids)).toEqual(changes);
  });

  it("matches an independent exhaustive retained-subset oracle for every five-task permutation", () => {
    const snapshot = generateNKeysBetween(null, null, 5).map((key, i) => task(String(i), key));
    function permutations(items: readonly BoardTask[]): BoardTask[][] {
      if (items.length === 0) return [[]];
      return items.flatMap((item, i) =>
        permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]),
      );
    }
    for (const desired of permutations(snapshot)) {
      let maximumRetained = 0;
      for (let mask = 0; mask < 2 ** desired.length; mask++) {
        const subset = desired.filter((_, i) => mask & (1 << i));
        if (subset.every((item, i) => i === 0 || subset[i - 1]!.orderKey < item.orderKey)) {
          maximumRetained = Math.max(maximumRetained, subset.length);
        }
      }
      const ids = desired.map((item) => item.id);
      const changes = bulkReorderDiff(snapshot, statuses, "todo", ids);
      expect(changes).toHaveLength(snapshot.length - maximumRetained);
      expect(
        changes.every(
          (change) => change.orderKey !== snapshot.find((t) => t.id === change.id)!.orderKey,
        ),
      ).toBe(true);
      expect(groupByStatus(apply(snapshot, changes), statuses)[0]!.tasks.map((t) => t.id)).toEqual(
        ids,
      );
      expect(snapshot.map((item) => item.orderKey)).toEqual(generateNKeysBetween(null, null, 5));
    }
  });

  it.each([
    [a.id],
    [a.id, b.id, "unknown"],
    [a.id, a.id, c.id],
    [a.id, b.id, d.id],
    null,
  ])("rejects partial, foreign, duplicate or invalid permutations", (ids) => {
    expectError(() => bulkReorderDiff(tasks, statuses, "todo", ids as string[]));
  });

  it("rejects unknown or empty status identifiers", () => {
    expectError(() => bulkReorderDiff(tasks, statuses, "unknown", []), "unknown-status");
    expectError(() => bulkReorderDiff(tasks, statuses, "", []));
  });
});
