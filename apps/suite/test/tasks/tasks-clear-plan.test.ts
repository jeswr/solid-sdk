// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  completedHistoryToKeep,
  completedParentsToKeep,
  descendantsFirst,
} from "../../src/apps/tasks/lib/views/clear-completed";

it("keeps every completed ancestor of an open sub-task, including across projects", () => {
  const result = completedParentsToKeep([
    { id: "root", state: "closed" },
    { id: "parent", parentId: "root", state: "closed" },
    { id: "open", parentId: "parent", state: "open" },
    { id: "nested-open", parentId: "open", state: "open" },
    { id: "done", parentId: "parent", state: "closed" },
    { id: "unrelated", state: "open" },
    { id: "orphan", parentId: "missing", state: "open" },
    { id: "cycle", parentId: "cycle", state: "open" },
  ]);
  expect([...result.parents]).toEqual(["parent", "root"]);
  expect([...result.openSubtasks]).toEqual(["open", "nested-open"]);
  expect(
    completedParentsToKeep(
      [
        { id: "root", state: "closed" },
        { id: "other", state: "closed" },
        { id: "open", parentId: "other", state: "open" },
      ],
      new Set(["root"]),
    ).openSubtasks.size,
  ).toBe(0);
});

it("has nothing to preserve for empty lists or completed-only trees", () => {
  expect(completedParentsToKeep([]).parents.size).toBe(0);
  expect(completedParentsToKeep([{ id: "done", state: "closed" }]).openSubtasks.size).toBe(0);
});

it("retains only closed history belonging to open bounded series within the candidates", () => {
  const tasks = [
    { id: "bounded", state: "open" as const, bounded: true },
    { id: "unbounded", state: "open" as const, bounded: false },
    { id: "finished", state: "closed" as const, bounded: true },
    { id: "history", state: "closed" as const, bounded: false, derivedFrom: "bounded" },
    { id: "other-project", state: "closed" as const, bounded: false, derivedFrom: "bounded" },
    { id: "reopened", state: "open" as const, bounded: false, derivedFrom: "bounded" },
    { id: "unbounded-history", state: "closed" as const, bounded: false, derivedFrom: "unbounded" },
    { id: "finished-history", state: "closed" as const, bounded: false, derivedFrom: "finished" },
    { id: "orphan", state: "closed" as const, bounded: false, derivedFrom: "missing" },
  ];
  expect([...completedHistoryToKeep(tasks)]).toEqual(["history", "other-project"]);
  expect([...completedHistoryToKeep(tasks, new Set(["history"]))]).toEqual(["history"]);
  expect(completedHistoryToKeep([]).size).toBe(0);
});

it("protects ancestors of retained history without counting history as open subtasks", () => {
  const result = completedParentsToKeep(
    [
      { id: "parent", state: "closed" },
      { id: "history", state: "closed", parentId: "parent" },
    ],
    undefined,
    new Set(["history"]),
  );
  expect([...result.parents]).toEqual(["parent"]);
  expect(result.openSubtasks.size).toBe(0);
});

it("orders descendants before ancestors without changing input or looping on cycles", () => {
  const tasks = [
    { id: "root" },
    { id: "parent", parentId: "root" },
    { id: "child", parentId: "parent" },
    { id: "other" },
    { id: "orphan", parentId: "missing" },
  ];
  expect(descendantsFirst(tasks).map((task) => task.id)).toEqual([
    "child",
    "parent",
    "root",
    "other",
    "orphan",
  ]);
  expect(tasks[0]?.id).toBe("root");
  expect(descendantsFirst([{ id: "self", parentId: "self" }])).toHaveLength(1);
  expect(
    descendantsFirst([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]),
  ).toHaveLength(2);
  expect(descendantsFirst([])).toEqual([]);
});
