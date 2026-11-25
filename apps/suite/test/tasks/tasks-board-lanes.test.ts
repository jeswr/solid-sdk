// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { boardLanes, laneFor } from "../../src/apps/tasks/lib/board/swimlanes";
import { dropMessage, overMessage } from "../../src/apps/tasks/lib/dnd/announce";
import {
  isPlaced,
  moveTarget,
  planDrop,
  planMove,
  planToSection,
} from "../../src/apps/tasks/lib/dnd/plan";
import { view } from "./tasks-views-fixtures";

describe("board swimlanes", () => {
  it("groups priorities, assignees and the first label, keeping empty destinations", () => {
    const tasks = [
      view("a", { priority: 1, assignee: "alice", labelIds: ["red", "blue"] }),
      view("b"),
    ];
    expect(boardLanes(tasks, "none").map((lane) => lane.tasks)).toEqual([tasks]);
    expect(boardLanes(tasks, "priority").map((lane) => lane.tasks.length)).toEqual([1, 0, 0, 1]);
    expect(
      boardLanes(tasks, "assignee", [], ["bob"]).map((lane) => [lane.name, lane.tasks.length]),
    ).toEqual([
      ["Unassigned", 1],
      ["alice", 1],
      ["bob", 0],
    ]);
    expect(
      boardLanes(tasks, "label", [
        { id: "red", name: "Red" },
        { id: "blue", name: "Blue" },
      ]).map((lane) => [lane.name, lane.tasks.length]),
    ).toEqual([
      ["No label", 1],
      ["Red", 1],
      ["Blue", 0],
    ]);
    expect(laneFor(view("unassigned"), "assignee")).toEqual({ group: "assignee", value: "" });
  });
  it("plans cross-lane priority and assignment changes, preserves parents and blocks label changes", () => {
    const a = view("a", { priority: 1, sectionId: "doing", parentId: "parent" });
    const b = view("b", { priority: 2, sectionId: "doing", position: 5 });
    const target = {
      kind: "section",
      projectUrl: a.projectUrl,
      sectionId: "doing",
      at: "end",
      lane: { group: "priority", value: "2" },
    } as const;
    const plan = planDrop(a, target, [a, b], { flat: true });
    expect(plan).toMatchObject({
      kind: "position",
      lane: target.lane,
      sectionChanged: false,
      parentChanged: false,
      parentId: "parent",
      index: 2,
    });
    expect(isPlaced(plan, [a, b], { flat: true })).toBe(false);
    if (plan.kind !== "position") throw new Error("Expected position");
    expect(
      isPlaced(plan, [{ ...a, priority: 2, position: plan.position }, b], { flat: true }),
    ).toBe(true);
    expect(
      planDrop(a, { ...target, lane: { group: "assignee", value: "bob" } }, [a, b], { flat: true }),
    ).toMatchObject({ lane: { group: "assignee", value: "bob" } });
    expect(
      planDrop(a, { ...target, lane: { group: "label", value: "red" } }, [a, b], { flat: true }),
    ).toEqual({ kind: "none" });
  });
  it("keeps keyboard ordering and section moves within the current lane", () => {
    const tasks = [
      view("a", { priority: 1, position: 1 }),
      view("b", { priority: 2, position: 2 }),
      view("c", { priority: 1, position: 3 }),
    ];
    const options = { flat: true, groupRowsBy: "priority" } as const;
    const active = tasks[0];
    if (!active) throw new Error("Missing task");
    expect(planMove(active, 1, tasks, options)).toMatchObject({ index: 2, position: 4 });
    expect(planToSection(active, "done", tasks, options)).toMatchObject({
      sectionId: "done",
      lane: { group: "priority", value: "1" },
    });
    const target = moveTarget(active, 1, tasks, options);
    if (!target) throw new Error("Missing keyboard target");
    expect(target).toMatchObject({
      url: tasks[2]?.url,
      container: { lane: { group: "priority", value: "1" } },
    });
    expect(planDrop(active, target, tasks, options)).toEqual(planMove(active, 1, tasks, options));
    expect(moveTarget(active, 1, tasks, { flat: true, groupRowsBy: "none" })).toMatchObject({
      url: tasks[1]?.url,
    });
  });
  it("names priority, assignee and label destinations on hover and drop", () => {
    const names = [
      {
        url: view("Task").projectUrl,
        title: "Project",
        sections: [{ id: "done", name: "Done" }],
        labels: [{ id: "red", name: "Red" }],
      },
    ];
    for (const [lane, name] of [
      [{ group: "priority", value: "1" }, "P1"],
      [{ group: "priority", value: "2" }, "P2"],
      [{ group: "assignee", value: "bob" }, "bob"],
      [{ group: "assignee", value: "" }, "Unassigned"],
      [{ group: "label", value: "red" }, "Red"],
      [{ group: "label", value: "" }, "No label"],
      [{ group: "label", value: "unknown" }, "unknown"],
    ] as const) {
      const task = view("Task", { labelIds: [lane.value] });
      const target = {
        kind: "section",
        projectUrl: task.projectUrl,
        sectionId: "done",
        at: "end",
        lane,
      } as const;
      const destination = view("Destination");
      expect(overMessage(task, target, [task], names)).toBe(`'Task' is over Done in ${name}.`);
      expect(
        overMessage(
          task,
          {
            kind: "task",
            url: destination.url,
            container: target,
            placement: "after",
          },
          [task, destination],
          names,
        ),
      ).toBe(`'Task' is after 'Destination' in ${name}.`);
      const plan = planDrop(task, target, [task], { flat: true });
      expect(dropMessage(task, plan, [task], names, true, true)).toBe(
        `Moved 'Task' to Done in ${name}, position 1.`,
      );
      if (lane.group === "label" && lane.value === "red") {
        expect(overMessage(task, target, [task], [])).toBe("'Task' is over No section in red.");
        expect(dropMessage(task, plan, [task], names, false, true)).toBe(
          "Moved 'Task' to Done in Red.",
        );
      }
    }
  });
});
