// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  expandedRows,
  planTreeMove,
  taskLevel,
  taskProgress,
} from "../../src/apps/tasks/lib/views/tree";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";

function view(id: string, position?: number, parentId?: string): TaskView {
  return {
    id,
    url: id,
    title: id,
    position,
    parentId,
    projectUrl: "project",
    projectTitle: "Project",
    state: "open",
    labelIds: [],
    priority: 4,
    recurring: false,
    hasReminders: false,
  };
}

describe("tree/model adapter", () => {
  it("counts direct children, excludes the parent and ignores unrelated tasks", () => {
    const root = view("root", 0);
    const child = view("child", 0, "root");
    expect(
      taskProgress(
        [
          root,
          child,
          { ...view("done", 1, "root"), state: "closed" },
          view("deep", 0, "child"),
          view("unrelated"),
          view("root", 0, "root"),
        ],
        root.id,
      ),
    ).toEqual({ total: 2, completed: 1, open: 1, allCompleted: false });
    expect(taskProgress([], root.id)).toEqual({
      total: 0,
      completed: 0,
      open: 0,
      allCompleted: false,
    });
  });
  it("maps library moves to numeric sibling positions, including a closed child", () => {
    const a = view("a", 1);
    const b = view("b", 2);
    const c = { ...view("c", 5, "a"), state: "closed" as const };
    const foreign = { ...view("foreign", 0), projectUrl: "elsewhere" };
    const otherSection = { ...view("section", 0), sectionId: "other" };
    expect(planTreeMove([a, b, c, foreign, otherSection], b, false)).toEqual({
      parentId: a.id,
      position: 6,
    });
    const deep = view("deep", 1, "b");
    const nestedB = { ...b, parentId: "a" };
    expect(planTreeMove([a, nestedB, deep, c], deep, true)).toEqual({
      parentId: "a",
      position: 3.5,
    });
    expect(planTreeMove([a, b, view("child", 1, "a")], view("child", 1, "a"), true)).toEqual({
      parentId: undefined,
      position: 1.5,
    });
    expect(planTreeMove([a, nestedB], nestedB, true)).toEqual({ parentId: undefined, position: 2 });
    expect(planTreeMove([a, b], b, false)).toEqual({ parentId: "a", position: 0 });
  });
  it("rejects boundaries, incomplete/cyclic forests and exhausted numeric gaps without changes", () => {
    const a = view("a", 1);
    expect(planTreeMove([a], a, false)).toBeUndefined();
    expect(planTreeMove([a], a, true)).toBeUndefined();
    const missing = view("missing", 1, "absent");
    expect(planTreeMove([missing], missing, true)).toBeUndefined();
    expect(
      planTreeMove([a, view("unranked", undefined, "a"), view("b", 2)], view("b", 2), false),
    ).toBeUndefined();
    expect(
      planTreeMove([a, view("unranked"), view("c", 1, "a")], view("c", 1, "a"), true),
    ).toBeUndefined();
    const b = view("b", 1 + Number.EPSILON);
    const c = view("c", 1, "a");
    expect(planTreeMove([a, b, c], c, true)).toBeUndefined();
    expect(planTreeMove([view("a", 1, "b"), view("b", 2, "a")], a, false)).toBeUndefined();
  });
  it("keeps collapse local to descendant ranges and preserves real ancestry for orphan rows", () => {
    const root = view("root");
    const child = view("child", 1, "root");
    const deep = view("deep", 1, "child");
    const rows = [
      { task: root, depth: 0 },
      { task: child, depth: 1 },
      { task: deep, depth: 2 },
      { task: view("next"), depth: 0 },
    ];
    expect(expandedRows(rows, new Set(["root"])).map((row) => row.task.id)).toEqual([
      "root",
      "next",
    ]);
    expect(expandedRows(rows, new Set(["child"])).map((row) => row.task.id)).toEqual([
      "root",
      "child",
      "next",
    ]);
    expect(expandedRows(rows, new Set())).toEqual(rows);
    expect(taskLevel(deep, [root, child, deep])).toBe(3);
    expect(taskLevel(root, [root])).toBe(1);
    expect(taskLevel(view("orphan", 1, "absent"), [])).toBe(2);
    expect(taskLevel(view("self", 1, "self"), [])).toBe(1);
  });
});
