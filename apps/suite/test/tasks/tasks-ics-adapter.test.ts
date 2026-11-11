// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { type RecurrenceRule, toRRule } from "../../src/apps/tasks/lib/model/recurrence";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import {
  parseVTodo,
  serializeVTodo,
  toTaskData,
  type VTodoCalendar,
  VTodoError,
  type VTodoErrorCode,
  type VTodoTask,
} from "../../src/apps/tasks/lib/vtodo";
import {
  calendarError,
  calendarTaskData,
  importLevels,
  toCalendar,
} from "../../src/apps/tasks/lib/vtodo-adapter";

const stamp = new Date("2026-06-01T10:00:00.123Z");
const due = new Date("2026-06-02T14:30:00Z");
const parent = "https://pod.example/tasks/parent.ttl#it";
const child = "https://pod.example/tasks/child.ttl#it";
function view(patch: Partial<TaskView> = {}): TaskView {
  return {
    url: parent.slice(0, -3),
    id: parent,
    projectUrl: "https://pod.example/project.ttl",
    projectTitle: "Home",
    title: "Plan <script>alert(1)</script>",
    state: "open",
    priority: 4,
    labelIds: [],
    recurring: false,
    hasReminders: false,
    ...patch,
  };
}
function todo(patch: Partial<VTodoTask> = {}): VTodoTask {
  return {
    uid: "one",
    title: "One",
    state: "open",
    stamp: new Date("2026-06-01T10:00:00Z"),
    ...patch,
  };
}
function calendar(tasks: VTodoTask[]): VTodoCalendar {
  return { productId: "tests", tasks };
}

describe("project calendar adapter", () => {
  it("round-trips titles, descriptions, both due kinds, priorities, completion, labels and a sub-task", () => {
    const source = [
      view({
        description: "A comma, a semicolon; a slash\\\nand Unicode 🌿",
        due,
        priority: 1,
        labelIds: ["label-1", "label-2"],
      }),
      view({
        id: child,
        title: "Child",
        parentId: parent,
        allDay: "2026-06-03",
        due: new Date("2026-06-02T23:00:00Z"),
        priority: 2,
        state: "closed",
        completedAt: new Date("2026-06-01T11:00:00Z"),
        description: "",
      }),
      view({ id: "https://pod.example/tasks/third.ttl#it", title: "Third", priority: 3 }),
      view({ id: "https://pod.example/tasks/fourth.ttl#it", title: "Fourth" }),
    ];
    const names = new Map([
      ["label-1", "work,home;both\\"],
      ["label-2", "🌿 garden"],
    ]);
    const text = serializeVTodo(
      toCalendar(
        source.map((view) => ({ view })),
        names,
        stamp,
      ),
    );
    expect(text).toContain("PRIORITY:1\r\n");
    expect(text).toContain("PRIORITY:5\r\n");
    expect(text).toContain("PRIORITY:9\r\n");
    expect(text).toContain("DUE;VALUE=DATE:20260603");
    expect(text).toContain("DUE:20260602T143000Z");
    expect(text).toContain("STATUS:COMPLETED\r\n");
    expect(text).toContain("COMPLETED:20260601T110000Z");
    const parsed = parseVTodo(text);
    const ids = new Map(source.map((task) => [task.id, task.id]));
    for (const [index, item] of parsed.tasks.entries()) {
      const original = source[index] as TaskView;
      const midnight = original.allDay ? new Date(`${original.allDay}T00:00:00`) : undefined;
      expect(
        toTaskData(item, { resourceIds: ids, ...(midnight ? { allDayDueInstant: midnight } : {}) }),
      ).toEqual({
        task: {
          title: original.title,
          state: original.state,
          ...(original.description !== undefined ? { description: original.description } : {}),
          ...(original.completedAt ? { endedAt: original.completedAt } : {}),
          ...(original.due ? { dueDate: midnight ?? original.due } : {}),
          ...(original.priority < 4
            ? { priority: ["high", "medium", "low"][original.priority - 1] }
            : {}),
          ...(original.parentId ? { parent: original.parentId } : {}),
        },
        ...(original.allDay ? { dueDay: original.allDay } : {}),
      });
      expect(item.uid).toBe(original.id);
      expect(item.stamp).toEqual(new Date("2026-06-01T10:00:00Z"));
      expect(item.categories).toEqual(
        original.labelIds.length ? original.labelIds.map((id) => names.get(id)) : undefined,
      );
      expect(calendarTaskData(item, ids, midnight).allDay).toBe(original.allDay);
    }
    expect(() => toCalendar([{ view: view({ labelIds: ["missing"] }) }], names, stamp)).toThrow(
      VTodoError,
    );
  });

  it.each([
    { frequency: "DAILY", interval: 2 },
    { frequency: "WEEKLY", byDay: ["Monday", "Wednesday"], count: 10 },
    { frequency: "MONTHLY", byMonthDay: 15, until: "2027-01-01" },
    { frequency: "YEARLY", until: new Date("2027-01-01T00:00:00Z") },
  ] satisfies RecurrenceRule[])("round-trips a supported $frequency rule", (rule) => {
    for (const allDay of [undefined, "2026-06-02"]) {
      const exported = toCalendar(
        [{ view: view({ due, allDay }), recurrence: rule }],
        new Map(),
        stamp,
      );
      const [task] = parseVTodo(serializeVTodo(exported)).tasks;
      expect(task?.rrule).toBe(toRRule(rule));
      const restored = calendarTaskData(
        task as VTodoTask,
        new Map(),
        new Date("2026-06-02T00:00:00"),
      );
      expect(restored.recurrence).toEqual({ ...rule, interval: rule.interval ?? 1 });
    }
  });
  it("supports recurrence without a due date and rejects unsupported recurrence before writing", () => {
    const [task] = parseVTodo(
      serializeVTodo(
        toCalendar([{ view: view(), recurrence: { frequency: "DAILY" } }], new Map(), stamp),
      ),
    ).tasks;
    expect(calendarTaskData(task as VTodoTask, new Map()).recurrence).toEqual({
      frequency: "DAILY",
      interval: 1,
    });
    expect(() =>
      calendarTaskData(
        todo({ rrule: "FREQ=HOURLY", start: { kind: "utc", value: due } }),
        new Map(),
      ),
    ).toThrow(VTodoError);
  });
  it("orders parents before descendants, skips known UIDs, and rejects missing parents and cycles", () => {
    const tasks = [
      todo({ uid: "grandchild", parentUid: "child" }),
      todo({ uid: "child", parentUid: "one" }),
      todo(),
    ];
    expect(importLevels(calendar(tasks), new Map())).toEqual({
      levels: [[tasks[2]], [tasks[1]], [tasks[0]]],
      skipped: 0,
    });
    expect(importLevels(calendar(tasks), new Map([["one", parent]]))).toEqual({
      levels: [[tasks[1]], [tasks[0]]],
      skipped: 1,
    });
    expect(importLevels(calendar(tasks), new Map(tasks.map((task) => [task.uid, parent])))).toEqual(
      { levels: [], skipped: 3 },
    );
    expect(() => importLevels(calendar([todo({ parentUid: "absent" })]), new Map())).toThrow(
      VTodoError,
    );
    expect(() =>
      importLevels(
        calendar([todo({ parentUid: "two" }), todo({ uid: "two", parentUid: "one" })]),
        new Map(),
      ),
    ).toThrow(VTodoError);
  });
  it.each([
    "invalid-input",
    "invalid-syntax",
    "unsupported-component",
    "unsupported-property",
    "unsupported-parameter",
    "invalid-value",
    "duplicate",
    "missing-required",
    "unresolved-parent",
  ] satisfies VTodoErrorCode[])("shows safe copy for %s", (code) => {
    expect(calendarError(new VTodoError(code))).toMatch(/\.$/);
    expect(calendarError(new Error("secret file content"))).not.toContain("secret");
  });
  it("accepts and rejects category lists atomically", () => {
    const base = serializeVTodo(calendar([todo()]));
    const input = (value: string) => base.replace("END:VTODO", `CATEGORIES:${value}\r\nEND:VTODO`);
    expect(parseVTodo(input("one\\,two,back\\\\,three\\;four")).tasks[0]?.categories).toEqual([
      "one,two",
      "back\\",
      "three;four",
    ]);
    for (const invalid of ["", ",", "one,,two", ",one", "one,", "one\\", "one\\q", "  "])
      expect(() => parseVTodo(input(invalid))).toThrow(VTodoError);
    expect(() =>
      serializeVTodo(calendar([todo({ categories: "bad" as unknown as string[] })])),
    ).toThrow(VTodoError);
    expect(() => serializeVTodo(calendar([todo({ categories: [""] })]))).toThrow(VTodoError);
    expect(serializeVTodo(calendar([todo({ categories: [] })]))).not.toContain("CATEGORIES");
  });
});
