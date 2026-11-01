// AUTHORED-BY Codex GPT-6.1-Sol
import type { RecurrenceRule as EditorRule } from "@jeswr/suite-ui/date-time/model";
import { describe, expect, it } from "vitest";
import {
  fromEditorRule,
  recurrenceAnchor,
  toEditorRule,
} from "../../src/apps/tasks/lib/detail/recurrence-map";
import {
  copyTaskData,
  duplicateTaskData,
  projectMoveData,
} from "../../src/apps/tasks/lib/detail/task-data";
import { DataFactory, NS, node, Store } from "../../src/apps/tasks/lib/model/rdf";
import { humanise } from "../../src/apps/tasks/lib/model/recurrence";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import { createTask, TaskItem } from "../../src/apps/tasks/lib/model/task";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";

const due = new Date("2026-11-03T17:00:00Z");
describe("detail recurrence adapter", () => {
  it("anchors all-day yearly validation and copy to the marker across Tokyo and Los Angeles", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      const instant = new Date(2026, 10, 3);
      expect(instant.toISOString()).toBe("2026-11-02T15:00:00.000Z");
      process.env.TZ = "America/Los_Angeles";
      expect(instant.getDate()).toBe(2);
      const anchor = recurrenceAnchor(instant, "2026-11-03");
      expect(anchor.getDate()).toBe(3);
      const rule = fromEditorRule(
        { freq: "YEARLY", interval: 1, byMonth: [11], byMonthDay: [3] },
        anchor,
      );
      expect(rule).toEqual({ frequency: "YEARLY", interval: 1 });
      expect(humanise(rule as NonNullable<typeof rule>, anchor)).toBe("Every year on 3 Nov");
      expect(recurrenceAnchor(instant)).toBe(instant);
    } finally {
      process.env.TZ = previous;
    }
  });
  it("maps absent rules and default intervals", () => {
    expect(fromEditorRule(null, due)).toBeUndefined();
    expect(toEditorRule(undefined)).toBeNull();
    expect(toEditorRule({ frequency: "DAILY" })).toEqual({ freq: "DAILY", interval: 1 });
    expect(fromEditorRule({ freq: "DAILY", interval: 2 }, due)).toEqual({
      frequency: "DAILY",
      interval: 2,
    });
  });
  it("round-trips weekly days, monthly day, count, date-only and instant endings without mutation", () => {
    const rules: EditorRule[] = [
      { freq: "WEEKLY", interval: 2, byDay: ["Monday", "Wednesday"], count: 10 },
      { freq: "MONTHLY", interval: 1, byMonthDay: [15], until: "2027-01-01" },
      { freq: "DAILY", interval: 1, until: "2027-01-01T17:00:00Z" },
    ];
    for (const rule of rules) {
      expect(toEditorRule(fromEditorRule(rule, due))).toEqual(rule);
      const copy = structuredClone(rule);
      fromEditorRule(rule, due);
      expect(rule).toEqual(copy);
    }
    expect(toEditorRule({ frequency: "WEEKLY", byDay: ["Monday", "Monday"] })?.byDay).toEqual([
      "Monday",
    ]);
  });
  it("accepts a yearly editor anchor only when it is exactly the task's due month/day", () => {
    expect(
      fromEditorRule({ freq: "YEARLY", interval: 1, byMonth: [11], byMonthDay: [3] }, due),
    ).toEqual({ frequency: "YEARLY", interval: 1 });
    expect(fromEditorRule({ freq: "YEARLY", interval: 1, byMonth: [11] }, due)).toEqual({
      frequency: "YEARLY",
      interval: 1,
    });
    expect(fromEditorRule({ freq: "YEARLY", interval: 1 }, due)).toEqual({
      frequency: "YEARLY",
      interval: 1,
    });
  });
  it.each<EditorRule>([
    { freq: "MONTHLY", interval: 1, byDay: ["Friday"], bySetPos: 3 },
    { freq: "MONTHLY", interval: 1, byMonthDay: [-1] },
    { freq: "MONTHLY", interval: 1, byMonthDay: [1, 15] },
    { freq: "YEARLY", interval: 1, byMonth: [10, 11] },
    { freq: "YEARLY", interval: 1, byMonth: [10] },
    { freq: "YEARLY", interval: 1, byMonth: [11], byMonthDay: [4] },
    { freq: "YEARLY", interval: 1, byMonthDay: [3] },
    { freq: "DAILY", interval: 0 },
    { freq: "DAILY", interval: 1, count: 1, until: "2027-01-01" },
  ])("rejects unrepresentable/invalid editor patterns %j", (rule) => {
    expect(() => fromEditorRule(rule, due)).toThrow();
  });
  it("validates model rules on read", () => {
    expect(() => toEditorRule({ frequency: "MONTHLY", byMonthDay: -1 })).toThrow();
  });
});

describe("detail copy/move planning", () => {
  function setup() {
    const source = createTracker(
      "https://pod.test/source.ttl",
      "Source",
      "https://pod.test/source/",
      [],
      due,
    );
    const target = createTracker(
      "https://pod.test/target.ttl",
      "Target",
      "https://pod.test/target/",
      [],
      due,
    );
    const sourceProject = { url: "https://pod.test/source.ttl", ...source, etag: '"1"' };
    const targetProject = { url: "https://pod.test/target.ttl", ...target, etag: '"1"' };
    const section = source.tracker.defineCategory("Section", "Doing");
    const drop = source.tracker.defineCategory("Label", "Drop");
    const label = source.tracker.defineCategory("Label", "bills");
    const destination = target.tracker.defineCategory("Section", "doing");
    const targetLabel = target.tracker.defineCategory("Label", "Bills");
    const url = "https://pod.test/source/task.ttl";
    const dataset = createTask(url, {
      title: "Same title",
      description: "Both predicates",
      state: "open",
      dueDate: due,
      categoryTypes: [section.id, drop.id, label.id, "https://pod.test/custom"],
      reminders: [{ offset: "-PT1H" }, { time: due }],
    });
    const stored = {
      url,
      dataset,
      etag: '"1"',
      task: new TaskItem(`${url}#it`, dataset, DataFactory),
    };
    return { sourceProject, targetProject, stored, destination, targetLabel };
  }
  it("copies both reminder trigger shapes with fresh identities and the exact title", () => {
    const { stored } = setup();
    const data = copyTaskData(stored);
    expect(data.title).toBe("Same title");
    expect(data.reminders).toEqual([{ offset: "-PT1H" }, { time: due }]);
    expect(stored.task.reminders.every((reminder) => reminder.id)).toBe(true);
    stored.task.description = "Edited";
    const value = node(stored.task.id, stored.dataset);
    expect(value.text(`${NS.WF}description`)).toBe("Edited");
    expect(value.text(`${NS.DCT}description`)).toBe("Edited");
    stored.task.description = undefined;
    expect(value.text(`${NS.WF}description`)).toBeUndefined();
    expect(value.text(`${NS.DCT}description`)).toBeUndefined();
  });
  it("duplicates the exact title and properties with fresh provenance", () => {
    const { stored } = setup();
    stored.task.state = "closed";
    const result = duplicateTaskData(stored, "https://bob.test/profile#me");
    expect(result.title).toBe("Same title");
    expect(result.state).toBe("open");
    expect(result.creator).toBe("https://bob.test/profile#me");
    expect(result.created).toBeUndefined();
    expect(result.endedAt).toBeUndefined();
    expect(result.clonedFrom).toBeUndefined();
    expect(result.duplicateOf).toBeUndefined();
    expect(result.reminders).toEqual([{ offset: "-PT1H" }, { time: due }]);
    expect(stored.task.state).toBe("closed");
  });
  it("maps tracker categories by case-insensitive name and retains other workflow types", () => {
    const { stored, sourceProject, targetProject, destination, targetLabel } = setup();
    const data = projectMoveData(stored, sourceProject, targetProject);
    expect(data.categoryTypes).toEqual([destination.id, targetLabel.id, "https://pod.test/custom"]);
    expect(data.project).toBe(targetProject.tracker.id);
    expect(data.title).toBe("Same title");
    expect(stored.task.project).toBeUndefined();
    expect(copyTaskData(stored).categoryTypes).toHaveLength(4);
  });
  it("handles a task without optional fields and rejects a non-task dataset", () => {
    const { sourceProject, targetProject, stored } = setup();
    const dataset = createTask(stored.url, { title: "Bare", state: "open" });
    const bare = { ...stored, dataset, task: new TaskItem(stored.task.id, dataset, DataFactory) };
    expect(projectMoveData(bare, sourceProject, targetProject).categoryTypes).toEqual([]);
    expect(copyTaskData(bare).reminders).toEqual([]);
    const empty = { ...stored, dataset: new Store() } as StoredTask;
    expect(() => copyTaskData(empty)).toThrow("Expected a wf:Task");
  });
});
