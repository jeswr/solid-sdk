// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { completedParentsToKeep } from "../../src/apps/tasks/lib/views/clear-completed";

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
