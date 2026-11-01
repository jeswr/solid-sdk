// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { Store } from "../../src/apps/tasks/lib/model/rdf";
import { createTask, taskDetails } from "../../src/apps/tasks/lib/model/task";
import { planComplete, planUndo, toastCopy } from "../../src/apps/tasks/lib/views/completion";
import { toTaskView } from "../../src/apps/tasks/lib/views/types";
import { now } from "./pod";
import { project, storedTask, view } from "./tasks-views-fixtures";

describe("completion and undo plans", () => {
  it("closes ordinary tasks, reopens without endedAt, and uses exact title toast copy", () => {
    const stored = storedTask("Buy milk");
    const before = [...stored.dataset];
    const plan = planComplete(stored, [], now);
    expect(plan).toEqual({ kind: "close" });
    expect(planUndo(plan)).toEqual({
      kind: "reopen",
      original: { state: "open", endedAt: undefined },
    });
    expect(toastCopy(plan, view("Buy milk"))).toBe("Completed 'Buy milk'");
    expect([...stored.dataset]).toEqual(before);
    expect(stored.task.state).toBe("open");
  });

  it("advances using due rather than completion time, creates a closed non-recurring copy, and undoes", () => {
    const due = new Date(2026, 10, 1, 17);
    const stored = storedTask("Water plants", {
      dueDate: due,
      recurrence: { frequency: "DAILY", interval: 2 },
      description: "Check soil",
      priority: "medium",
      rank: 3,
      categoryTypes: [
        "https://pod.test/project#label-home",
        "https://pod.test/project#section-doing",
      ],
      parent: "https://pod.test/parent#it",
      project: "https://pod.test/project#this",
      reminders: [{ offset: "-PT1H" }, { time: new Date(2026, 10, 1, 12) }],
    });
    const before = [...stored.dataset];
    const previous = taskDetails(stored.url, stored.dataset);
    const plan = planComplete(stored, [], new Date(2026, 10, 10));
    expect(plan.kind).toBe("advance");
    if (plan.kind !== "advance") throw new Error("Expected advance");
    expect(plan.next).toEqual(new Date(2026, 10, 3, 17));
    expect(plan.original).toMatchObject({
      title: "Water plants",
      state: "open",
      dueDate: plan.next,
      reminders: [{ offset: "-PT1H" }, { time: new Date(2026, 10, 3, 12) }],
    });
    expect(plan.copy).toMatchObject({
      ...previous,
      state: "closed",
      endedAt: new Date(2026, 10, 10),
      modified: new Date(2026, 10, 10),
      clonedFrom: stored.task.id,
      dueDate: due,
      recurrence: undefined,
      reminders: [],
    });
    expect(planUndo(plan)).toEqual({
      kind: "restore",
      deleteCopy: true,
      original: { dueDate: due, allDay: undefined, reminders: stored.task.reminders },
    });
    expect(toastCopy(plan, view("Water plants"))).toBe("Completed · next: Tue 3 Nov");
    expect([...stored.dataset]).toEqual(before);
    // Plans can be queued for the existing outbox without depending on online state.
    expect(taskDetails(stored.url, createTask(stored.url, plan.original))?.dueDate).toEqual(
      plan.next,
    );
    expect(
      taskDetails("https://pod.test/copy.ttl", createTask("https://pod.test/copy.ttl", plan.copy))
        ?.clonedFrom,
    ).toBe(stored.task.id);
  });

  it("counts only closed copies derived from this task when exhausting a count", () => {
    const original = storedTask("Original", {
      dueDate: now,
      recurrence: { frequency: "DAILY", count: 3 },
    });
    const copy1 = storedTask("Copy1", { state: "closed", clonedFrom: original.task.id });
    const copy2 = storedTask("Copy2", { state: "closed", clonedFrom: original.task.id });
    const irrelevant = [
      original,
      storedTask("Open copy", { clonedFrom: original.task.id }),
      storedTask("Other closed", { state: "closed", clonedFrom: "https://other.test/task#it" }),
      storedTask("No provenance", { state: "closed" }),
    ];
    const toView = (item: typeof original) => toTaskView(item, project());
    expect(planComplete(original, [copy1, ...irrelevant].map(toView), now).kind).toBe("advance");
    expect(planComplete(original, [copy1, copy2, ...irrelevant].map(toView), now)).toEqual({
      kind: "close",
    });
    expect(
      planComplete(storedTask("Count1", { recurrence: { frequency: "DAILY", count: 1 } }), [], now),
    ).toEqual({ kind: "close" });
  });

  it("exhausts until dates and includes the last permitted occurrence", () => {
    const dueDate = new Date(2026, 9, 24, 17);
    const last = storedTask("Last", {
      dueDate,
      recurrence: { frequency: "DAILY", until: "2026-10-25" },
    });
    const plan = planComplete(last, [], now);
    expect(plan.kind).toBe("advance");
    const exhausted = storedTask("Exhausted", {
      dueDate: new Date(2026, 9, 25, 17),
      recurrence: { frequency: "DAILY", until: "2026-10-25" },
    });
    expect(planComplete(exhausted, [], now)).toEqual({ kind: "close" });
    expect(
      planComplete(
        storedTask("Exact cutoff", { dueDate, recurrence: { frequency: "DAILY", until: dueDate } }),
        [],
        now,
      ),
    ).toEqual({ kind: "close" });
  });

  it.each([
    [new Date(2026, 2, 29), "2026-03-29", new Date(2026, 2, 30), "2026-03-30"],
    [new Date(2026, 9, 25), "2026-10-25", new Date(2026, 9, 26), "2026-10-26"],
  ])("preserves all-day markers and reminders across DST", (dueDate, allDay, next, nextKey) => {
    const absolute = new Date(dueDate.getTime() - 3_600_000);
    const stored = storedTask("All day", {
      dueDate,
      allDay,
      recurrence: { frequency: "DAILY" },
      reminders: [{ time: absolute }, { offset: "-PT1H" }],
    });
    const plan = planComplete(stored, [], now);
    if (plan.kind !== "advance") throw new Error("Expected advance");
    expect(plan.original.allDay).toBe(nextKey);
    expect(plan.next).toEqual(next);
    expect(plan.copy.allDay).toBe(allDay);
    expect(plan.original.reminders).toEqual([
      { ...stored.task.reminders[0], time: new Date(next.getTime() - 3_600_000) },
      stored.task.reminders[1],
    ]);
    expect(planUndo(plan)).toEqual({
      kind: "restore",
      deleteCopy: true,
      original: { dueDate, allDay, reminders: stored.task.reminders },
    });
  });

  it("retains an independent undo snapshot, including an originally absent due", () => {
    const stored = storedTask("No due", { recurrence: { frequency: "WEEKLY" } });
    const plan = planComplete(stored, [], now, {});
    if (plan.kind !== "advance") throw new Error("Expected advance");
    expect(plan.next).toEqual(new Date(2026, 10, 1, 12));
    expect(planUndo(plan)).toEqual({
      kind: "restore",
      deleteCopy: true,
      original: { dueDate: undefined, allDay: undefined, reminders: [] },
    });
    const dated = storedTask("Snapshot", {
      dueDate: now,
      recurrence: { frequency: "DAILY" },
      reminders: [{ time: now }],
    });
    const datedPlan = planComplete(dated, [], now);
    if (datedPlan.kind !== "advance") throw new Error("Expected advance");
    const undo = planUndo(datedPlan);
    if (undo.kind !== "restore") throw new Error("Expected restore");
    undo.original.dueDate?.setFullYear(2030);
    expect(datedPlan.previous.dueDate).toEqual(now);
    expect(planUndo(datedPlan)).not.toEqual(undo);
    dated.task.dueDate = new Date(2031, 0, 1);
    expect(datedPlan.previous.dueDate).toEqual(now);
  });

  it("supports Complete forever, closed tasks, invalid input and exact weekday toast copy", () => {
    const stored = storedTask("Repeating", { recurrence: { frequency: "DAILY" } });
    expect(planComplete(stored, [], now, { forever: true })).toEqual({ kind: "close" });
    expect(
      planComplete(
        storedTask("Closed", { state: "closed", recurrence: { frequency: "DAILY" } }),
        [],
        now,
      ),
    ).toEqual({ kind: "close" });
    expect(() => planComplete({ ...stored, dataset: new Store() }, [], now)).toThrow(
      "Expected a wf:Task",
    );
    expect(() => planComplete(stored, [], new Date(Number.NaN))).toThrow(TypeError);
    const plan = planComplete(
      storedTask("Monday", {
        dueDate: new Date(2025, 10, 2, 17),
        recurrence: { frequency: "DAILY" },
      }),
      [],
      now,
    );
    expect(toastCopy(plan, view("Monday"))).toBe("Completed · next: Mon 3 Nov");
  });
});
