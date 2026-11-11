// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  compareTasks,
  flatRows,
  projectGroups,
  taskIndex,
  taskSection,
  treeRows,
} from "../../src/apps/tasks/lib/views/project-groups";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";

function view(id: string, data: Partial<TaskView> = {}): TaskView {
  return {
    url: `https://pod.test/${id}`,
    id,
    title: id,
    state: "open",
    projectUrl: "https://pod.test/home.ttl",
    projectTitle: "Home",
    priority: 4,
    labelIds: [],
    recurring: false,
    hasReminders: false,
    ...data,
  };
}
const names = (rows: { task: TaskView }[]) => rows.map((row) => row.task.id);
describe("project list projection", () => {
  it("shares an ancestry index per snapshot and gives boards flat per-section ordering", () => {
    const tasks = [
      view("root", { position: 1, sectionId: "doing" }),
      view("child", { position: 3, parentId: "root", sectionId: "other" }),
      view("between", { position: 2, sectionId: "doing" }),
    ];
    expect(taskIndex(tasks)).toBe(taskIndex(tasks));
    expect(taskIndex([...tasks])).not.toBe(taskIndex(tasks));
    const groups = projectGroups(
      tasks,
      [
        { id: "doing", name: "Doing" },
        { id: "other", name: "Other" },
      ],
      "manual",
      false,
      true,
    );
    expect(
      groups.sections.map(({ rows }) => rows.map(({ task, depth }) => [task.id, depth])),
    ).toEqual([
      [
        ["root", 0],
        ["between", 0],
      ],
      [["child", 0]],
    ]);
    expect(groups.sections[1]?.rows[0]?.orphanParentTitle).toBe("root");
    expect(names(projectGroups(tasks, [], "manual", false, true).unsectioned)).toEqual([
      "root",
      "between",
      "child",
    ]);
  });

  it("sorts all-day tasks by their marker across time zones and keeps manual ties", () => {
    const tasks = [
      view("late-marker", { allDay: "2026-11-02", due: new Date("2026-11-01T10:00:00Z") }),
      view("timed", { due: new Date("2026-11-01T17:00:00Z") }),
      view("same-day-b", {
        allDay: "2026-11-01",
        due: new Date("2026-11-01T12:00:00Z"),
        position: 2,
        created: new Date(20),
      }),
      view("same-day-a", {
        allDay: "2026-11-01",
        due: new Date("2026-10-31T10:00:00Z"),
        position: 2,
        created: new Date(10),
      }),
      view("undated"),
    ];
    expect(names(projectGroups(tasks, [], "due").unsectioned)).toEqual([
      "same-day-a",
      "same-day-b",
      "timed",
      "late-marker",
      "undated",
    ]);
  });
  it("sorts sections, nests children beneath their visible parent and leaves closed/absent parents as breadcrumbs", () => {
    const tasks = [
      view("child", { parentId: "parent", position: 0, sectionId: "other" }),
      view("parent", { sectionId: "doing", position: 5 }),
      view("closed", { state: "closed" }),
      view("orphan", { parentId: "closed" }),
      view("missing", { parentId: "absent" }),
      view("unknown-section", { sectionId: "deleted" }),
    ];
    const groups = projectGroups(
      tasks,
      [
        { id: "other", name: "Other", position: 2 },
        { id: "doing", name: "Doing", position: 1 },
      ],
      "manual",
    );
    expect(names(groups.unsectioned)).toEqual(["missing", "orphan", "unknown-section"]);
    expect(groups.unsectioned[0]?.orphanParentTitle).toBe("Parent task");
    expect(groups.unsectioned[1]?.orphanParentTitle).toBe("closed");
    expect(groups.sections.map(({ section }) => section.id)).toEqual(["doing", "other"]);
    expect(groups.sections[0]?.rows.map(({ task, depth }) => [task.id, depth])).toEqual([
      ["parent", 0],
      ["child", 1],
    ]);
    expect(groups.sections[0]?.openCount).toBe(2);
    expect(names(projectGroups(tasks, [], "manual", true).unsectioned)).toContain("closed");
  });
  it("applies manual, due, priority and locale name order including absent values and ties", () => {
    const tasks = [
      view("z", { position: 1, priority: 2, due: new Date(200), created: new Date(20) }),
      view("b", { position: 1, priority: 1, due: new Date(100), created: new Date(10) }),
      view("a", { position: 1, priority: 1, due: new Date(100), created: new Date(10) }),
      view("undated"),
      view("first", { position: 0 }),
    ];
    expect(names(projectGroups(tasks, [], "manual").unsectioned)).toEqual([
      "first",
      "a",
      "b",
      "z",
      "undated",
    ]);
    expect(names(projectGroups(tasks, [], "due").unsectioned)).toEqual([
      "a",
      "b",
      "z",
      "first",
      "undated",
    ]);
    expect(names(projectGroups(tasks, [], "priority").unsectioned)).toEqual([
      "a",
      "b",
      "z",
      "first",
      "undated",
    ]);
    expect(names(projectGroups(tasks, [], "name").unsectioned)).toEqual([
      "a",
      "b",
      "first",
      "undated",
      "z",
    ]);
    expect(compareTasks("manual")(view("a"), view("a"))).toBe(0);
  });
  it("keeps flat views flat, including closed parents and deep children", () => {
    const closed = view("closed", { state: "closed" });
    const child = view("child", { parentId: closed.id });
    expect(flatRows([closed, child]).map((row) => row.depth)).toEqual([0, 0]);
    expect(flatRows([view("self", { parentId: "self" })])[0]?.depth).toBe(0);
    expect(
      flatRows([
        view("parent"),
        view("child", { parentId: "parent" }),
        view("deep", { parentId: "child" }),
      ]).map((row) => row.depth),
    ).toEqual([0, 0, 0]);
  });
  it("nests at every depth and safely displays malformed cycles once", () => {
    const tasks = [
      view("root", { sectionId: "doing" }),
      view("child", { parentId: "root" }),
      view("deep", { parentId: "child" }),
    ];
    expect(treeRows(tasks).map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(taskSection(tasks[2] as TaskView, tasks)).toBe("doing");
    const cycle = [view("a", { parentId: "b" }), view("b", { parentId: "a" })];
    expect(treeRows(cycle).map((row) => row.task.id)).toEqual(["a", "b"]);
    expect(taskSection(cycle[0] as TaskView, cycle)).toBeUndefined();
    const closedParent = view("closed", { state: "closed", sectionId: "doing" });
    const child = view("child", { parentId: closedParent.id });
    expect(taskSection(child, [closedParent, child], true)).toBe("doing");
    expect(taskSection(child, [closedParent, child])).toBeUndefined();
    const missing = view("missing", { parentId: "absent" });
    expect(taskSection(missing, [missing])).toBeUndefined();
    expect(treeRows([missing])[0]?.orphanParentTitle).toBe("Parent task");
    expect(
      treeRows([view("closed", { state: "closed" }), view("child", { parentId: "closed" })]).map(
        (row) => row.depth,
      ),
    ).toEqual([0, 0]);
  });
  it("handles empty projects and section ordering without positions", () => {
    expect(projectGroups([], [], "manual")).toEqual({ unsectioned: [], sections: [] });
    const result = projectGroups(
      [view("done", { sectionId: "a", state: "closed" })],
      [
        { id: "b", name: "B" },
        { id: "a", name: "A" },
      ],
      "manual",
      true,
    );
    expect(result.sections.map(({ section }) => section.id)).toEqual(["a", "b"]);
    expect(result.sections[0]?.openCount).toBe(0);
    expect(result.sections[0]?.rows).toHaveLength(1);
  });
});
