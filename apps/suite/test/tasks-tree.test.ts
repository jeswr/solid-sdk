// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Fixtures and explicit identity assertions establish these entries.
import { describe, expect, it } from "vitest";
import {
  deleteSubtree,
  getProgress,
  indentTask,
  moveTask,
  outdentTask,
  setTaskCompletion,
  TaskTreeError,
  type TreeTask,
} from "../src/apps/tasks/lib/tree";

const id = (name: string) => `https://example.org/tasks/${name}`;
function task(
  name: string,
  orderKey: string,
  parent?: string,
  state: TreeTask["state"] = "open",
): TreeTask {
  return {
    id: id(name),
    orderKey,
    state,
    ...(parent === undefined ? {} : { parentId: id(parent) }),
  };
}
const a = task("a", "A");
const b = task("b", "B");
const c = task("c", "C");
const aa = task("aa", "A", "a");
const ab = task("ab", "B", "a", "completed");
const aaa = task("aaa", "V", "aa");
const forest = [c, aaa, b, ab, a, aa];

function error(run: () => unknown, code: TaskTreeError["code"]) {
  expect(run).toThrow(TaskTreeError);
  expect(run).toThrow(expect.objectContaining({ name: "TaskTreeError", code }));
}
function find(tasks: readonly TreeTask[], name: string) {
  return tasks.find((item) => item.id === id(name))!;
}
function siblings(tasks: readonly TreeTask[], parent?: string) {
  return tasks
    .filter((item) => item.parentId === (parent === undefined ? undefined : id(parent)))
    .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
    .map((item) => item.id);
}

describe("tree validation at every public boundary", () => {
  const operations = [
    (tasks: readonly TreeTask[]) => moveTask(tasks, a.id, undefined, 0),
    (tasks: readonly TreeTask[]) => indentTask(tasks, a.id),
    (tasks: readonly TreeTask[]) => outdentTask(tasks, a.id),
    (tasks: readonly TreeTask[]) => deleteSubtree(tasks, a.id),
    (tasks: readonly TreeTask[]) => setTaskCompletion(tasks, a.id, "completed"),
    (tasks: readonly TreeTask[]) => getProgress(tasks, a.id),
  ];
  const malformed: [unknown, TaskTreeError["code"]][] = [
    [null, "invalid-input"],
    [{}, "invalid-input"],
    [[null], "invalid-input"],
    [[undefined], "invalid-input"],
    [Array(1), "invalid-input"],
    [[3], "invalid-input"],
    [[[]], "invalid-input"],
    [[{ ...a, id: " " }], "invalid-input"],
    [[{ ...a, id: 1 }], "invalid-input"],
    [[{ ...a, parentId: null }], "invalid-input"],
    [[{ ...a, parentId: "" }], "invalid-input"],
    [[{ ...a, state: "done" }], "invalid-input"],
    [[{ ...a, orderKey: 2 }], "invalid-order"],
    [[{ ...a, orderKey: "" }], "invalid-order"],
    [[{ ...a, orderKey: "A0" }], "invalid-order"],
    [[{ ...a, orderKey: "a_" }], "invalid-order"],
    [[{ ...a, orderKey: "a\n" }], "invalid-order"],
    [[a, a], "invalid-tree"],
    [[a, { ...b, orderKey: "A" }], "invalid-order"],
    [[a, aa, { ...ab, orderKey: "A" }], "invalid-order"],
    [[a, task("orphan", "B", "missing")], "invalid-tree"],
    [[a, task("loop", "B", "loop")], "cycle"],
    [[a, task("x", "A", "y"), task("y", "B", "z"), task("z", "C", "x")], "cycle"],
  ];
  it.each(
    malformed,
  )("rejects malformed or incomplete snapshot %# with a typed error", (input, code) => {
    for (const operation of operations) error(() => operation(input as TreeTask[]), code);
  });
  it.each([
    "",
    " ",
    1,
    null,
    undefined,
    id("missing"),
  ])("rejects absent/invalid target %s", (target) => {
    const code = target === id("missing") ? "task-not-found" : "invalid-input";
    error(() => moveTask(forest, target as string, undefined, 0), code);
    error(() => indentTask(forest, target as string), code);
    error(() => outdentTask(forest, target as string), code);
    error(() => deleteSubtree(forest, target as string), code);
    error(() => setTaskCompletion(forest, target as string, "completed"), code);
    error(() => getProgress(forest, target as string), code);
  });
  it("validates an empty forest without inventing a missing target", () => {
    error(() => getProgress([], a.id), "task-not-found");
  });
});

describe("subtree movement and ordering", () => {
  it.each([0, 1, 2])("moves a subtree to child index %s without touching descendants", (index) => {
    const moved = moveTask(forest, b.id, a.id, index);
    const expected = [aa.id, ab.id];
    expected.splice(index, 0, b.id);
    expect(siblings(moved, "a")).toEqual(expected);
    expect(find(moved, "b").parentId).toBe(a.id);
    expect(moved.filter((item) => item.id !== b.id)).toEqual(
      forest.filter((item) => item.id !== b.id),
    );
    expect(find(moved, "aaa")).toBe(aaa);
    expect(siblings(moved)).toEqual([a.id, c.id]);
  });
  it("moves into an empty parent and promotes to an empty root group", () => {
    const moved = moveTask(forest, aa.id, b.id, 0);
    expect(find(moved, "aa")).toEqual({ ...aa, parentId: b.id, orderKey: "V" });
    expect(find(moved, "aaa")).toBe(aaa);
    expect(siblings(moved, "b")).toEqual([aa.id]);
    const root = moveTask([task("only", "A")], id("only"), undefined, 0);
    expect(root).toEqual([task("only", "A")]);
  });
  it("promotes a nested task and removes parentId instead of writing null", () => {
    const moved = moveTask(forest, aa.id, undefined, 1);
    expect(siblings(moved)).toEqual([a.id, aa.id, b.id, c.id]);
    expect(find(moved, "aa")).not.toHaveProperty("parentId");
    expect(find(moved, "aaa")).toBe(aaa);
  });
  it("uses post-removal indices for same-parent reordering and preserves no-op keys", () => {
    expect(siblings(moveTask(forest, a.id, undefined, 2))).toEqual([b.id, c.id, a.id]);
    expect(siblings(moveTask(forest, c.id, undefined, 0))).toEqual([c.id, a.id, b.id]);
    for (const [entry, index] of [
      [a, 0],
      [b, 1],
      [c, 2],
    ] as const) {
      const result = moveTask(forest, entry.id, undefined, index);
      expect(result).toEqual(forest);
      expect(result).not.toBe(forest);
      expect(find(result, entry.id.split("/").at(-1)!)).toBe(entry);
    }
    expect(moveTask([a, aa], aa.id, a.id, 0)[1]).toBe(aa);
  });
  it("uses byte ordering and accommodates arbitrarily tight keys", () => {
    const tasks = [task("a", "A000001"), task("b", "A000002"), task("c", "a"), task("d", "Z")];
    const moved = moveTask(tasks, c.id, undefined, 1);
    expect(find(moved, "c").orderKey > "A000001").toBe(true);
    expect(find(moved, "c").orderKey < "A000002").toBe(true);
    expect(siblings(moveTask(tasks, id("d"), undefined, 0))).toEqual([id("d"), a.id, b.id, c.id]);
  });
  it.each([
    -1,
    3,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    null,
    undefined,
  ])("rejects invalid index %s", (index) => {
    error(() => moveTask(forest, b.id, a.id, index as number), "invalid-input");
  });
  it.each([null, "", 5, id("missing")])("rejects invalid/absent destination %s", (parent) => {
    error(
      () => moveTask(forest, b.id, parent as string, 0),
      parent === id("missing") ? "task-not-found" : "invalid-input",
    );
  });
  it.each(["a", "aa", "aaa"])("rejects moving an ancestor into %s", (parent) => {
    error(() => moveTask(forest, a.id, id(parent), 0), "cycle");
  });
  it("indents under the preceding sibling and appends after its existing children", () => {
    const moved = indentTask(forest, b.id);
    expect(siblings(moved, "a")).toEqual([aa.id, ab.id, b.id]);
    expect(find(moved, "b").orderKey > ab.orderKey).toBe(true);
    expect(find(indentTask(forest, c.id), "c")).toEqual({ ...c, parentId: b.id, orderKey: "V" });
    const nested = indentTask(forest, ab.id);
    expect(siblings(nested, "aa")).toEqual([aaa.id, ab.id]);
  });
  it("outdents after the former parent at root and at arbitrary depth", () => {
    const moved = outdentTask(forest, aa.id);
    expect(siblings(moved)).toEqual([a.id, aa.id, b.id, c.id]);
    expect(find(moved, "aa")).not.toHaveProperty("parentId");
    expect(find(moved, "aaa")).toBe(aaa);
    const nested = outdentTask(forest, aaa.id);
    expect(siblings(nested, "a")).toEqual([aa.id, aaa.id, ab.id]);
    expect(find(nested, "aaa").parentId).toBe(a.id);
    expect(siblings(outdentTask([a, aa], aa.id))).toEqual([a.id, aa.id]);
  });
  it("rejects indenting the first sibling and outdenting a root", () => {
    error(() => indentTask(forest, a.id), "invalid-operation");
    error(() => indentTask(forest, aa.id), "invalid-operation");
    error(() => outdentTask(forest, a.id), "invalid-operation");
  });
  it("deletes an exact subtree, including leaves and the whole tree", () => {
    expect(deleteSubtree(forest, aa.id)).toEqual([c, b, ab, a]);
    expect(deleteSubtree(forest, a.id)).toEqual([c, b]);
    expect(deleteSubtree(forest, aaa.id)).toEqual([c, b, ab, a, aa]);
    expect(deleteSubtree([a, aa, aaa], a.id)).toEqual([]);
    expect(find(deleteSubtree(forest, aa.id), "a").state).toBe("open");
  });
});

describe("explicit completion policies", () => {
  it("completes a parent without changing children, and leaves the parent open after the last child completes", () => {
    const parentDone = setTaskCompletion(forest, a.id, "completed");
    expect(find(parentDone, "a").state).toBe("completed");
    expect(find(parentDone, "aa")).toBe(aa);
    expect(find(parentDone, "aaa")).toBe(aaa);
    const childDone = setTaskCompletion(forest, aa.id, "completed");
    expect(getProgress(childDone, a.id)).toEqual({
      completed: 2,
      total: 2,
      open: 0,
      allCompleted: true,
    });
    expect(find(childDone, "a")).toBe(a);
    expect(find(childDone, "aaa")).toBe(aaa);
  });
  it("completes all descendants only with an explicit option and keeps unrelated tasks", () => {
    const result = setTaskCompletion(forest, a.id, "completed", { completeDescendants: true });
    expect(["a", "aa", "ab", "aaa"].every((name) => find(result, name).state === "completed")).toBe(
      true,
    );
    expect(find(result, "b")).toBe(b);
    expect(find(result, "ab")).toBe(ab);
    const alreadyDone = setTaskCompletion(result, a.id, "completed", { completeDescendants: true });
    expect(alreadyDone.every((entry, index) => entry === result[index])).toBe(true);
    expect(setTaskCompletion([ab, a], a.id, "completed", { completeDescendants: false })[0]).toBe(
      ab,
    );
  });
  it("completes ancestors recursively when configured and all direct children are done", () => {
    const result = setTaskCompletion(forest, aaa.id, "completed", { completeAncestors: true });
    expect(["aaa", "aa", "a"].every((name) => find(result, name).state === "completed")).toBe(true);
    expect(find(result, "b")).toBe(b);
    const blocked = setTaskCompletion([...forest, task("ac", "C", "a")], aaa.id, "completed", {
      completeAncestors: true,
    });
    expect(find(blocked, "aa").state).toBe("completed");
    expect(find(blocked, "a")).toBe(a);
    expect(
      find(setTaskCompletion(forest, ab.id, "completed", { completeAncestors: true }), "a"),
    ).toBe(a);
  });
  it("combines policies and follows already completed ancestors without changing other trees", () => {
    const result = setTaskCompletion(forest, aa.id, "completed", {
      completeDescendants: true,
      completeAncestors: true,
    });
    expect(find(result, "a").state).toBe("completed");
    expect(find(result, "aaa").state).toBe("completed");
    const already = forest.map((entry) =>
      entry.id === aa.id ? { ...entry, state: "completed" as const } : entry,
    );
    expect(
      find(setTaskCompletion(already, aaa.id, "completed", { completeAncestors: true }), "a").state,
    ).toBe("completed");
    expect(
      find(setTaskCompletion(forest, a.id, "completed", { completeAncestors: true }), "aa"),
    ).toBe(aa);
  });
  it("reopens only the target even with the upward option", () => {
    const done = setTaskCompletion(forest, a.id, "completed", { completeDescendants: true });
    const result = setTaskCompletion(done, aaa.id, "open", { completeAncestors: true });
    expect(find(result, "aaa").state).toBe("open");
    expect(find(result, "aa").state).toBe("completed");
    const parentOpen = setTaskCompletion(done, a.id, "open");
    expect(find(parentOpen, "aaa").state).toBe("completed");
  });
  it.each([
    null,
    [],
    1,
    { unknown: true },
    { completeDescendants: "true" },
    { completeAncestors: 1 },
    { completeAncestors: undefined },
    { [Symbol("extra")]: true },
  ])("rejects malformed options %#", (options) => {
    error(() => setTaskCompletion(forest, a.id, "completed", options as never), "invalid-input");
  });
  it("rejects unknown states and cascading reopen instead of reinterpreting them", () => {
    error(() => setTaskCompletion(forest, a.id, "done" as never), "invalid-input");
    error(
      () => setTaskCompletion(forest, a.id, "open", { completeDescendants: true }),
      "invalid-input",
    );
  });
});

describe("progress and immutability", () => {
  it("counts direct children by default and descendants explicitly, excluding the parent", () => {
    expect(getProgress(forest, a.id)).toEqual({
      total: 2,
      completed: 1,
      open: 1,
      allCompleted: false,
    });
    expect(getProgress(forest, a.id, "descendants")).toEqual({
      total: 3,
      completed: 1,
      open: 2,
      allCompleted: false,
    });
    expect(getProgress(forest, aaa.id)).toEqual({
      total: 0,
      completed: 0,
      open: 0,
      allCompleted: false,
    });
    expect(getProgress(forest, aaa.id, "descendants")).toEqual({
      total: 0,
      completed: 0,
      open: 0,
      allCompleted: false,
    });
    expect(
      getProgress(
        setTaskCompletion(forest, a.id, "completed", { completeDescendants: true }),
        a.id,
        "descendants",
      ),
    ).toEqual({ total: 3, completed: 3, open: 0, allCompleted: true });
    error(() => getProgress(forest, a.id, "all" as never), "invalid-input");
  });
  it("preserves extra fields and frozen inputs across every operation", () => {
    const input = Object.freeze(
      forest.map((entry) => Object.freeze({ ...entry, title: "Plan picnic" })),
    );
    const before = JSON.stringify(input);
    for (const result of [
      moveTask(input, a.id, b.id, 0),
      indentTask(input, b.id),
      outdentTask(input, aa.id),
      deleteSubtree(input, aa.id),
      setTaskCompletion(input, a.id, "completed"),
    ]) {
      expect(result).not.toBe(input);
      expect(result.every((entry) => entry.title === "Plan picnic")).toBe(true);
    }
    getProgress(input, a.id);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("handles deep trees iteratively and rejects distant cycles", () => {
    const deep = Array.from({ length: 12000 }, (_, i) =>
      task(String(i), "V", i === 0 ? undefined : String(i - 1)),
    );
    expect(getProgress(deep, id("0"), "descendants").total).toBe(11999);
    expect(deleteSubtree(deep, id("0"))).toEqual([]);
    expect(
      setTaskCompletion(deep, id("11999"), "completed", { completeAncestors: true }).every(
        (entry) => entry.state === "completed",
      ),
    ).toBe(true);
    error(() => moveTask(deep, id("0"), id("11999"), 0), "cycle");
  });
});
