// AUTHORED-BY Codex GPT-6.1-Sol
import { rrulestr } from "rrule";
import { describe, expect, it } from "vitest";
import { humanise, type RecurrenceRule, toRRule } from "../../src/apps/tasks/lib/model/recurrence";
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

function expanded(task: VTodoTask, limit: number): string[] {
  if (!task.rrule || !task.start) throw new Error("Missing recurrence");
  const start =
    task.start.kind === "date" ? new Date(`${task.start.value}T00:00:00Z`) : task.start.value;
  // Independent iCalendar evaluator: include DTSTART and any DUE offset in the result.
  const due = task.due?.kind === "date" ? new Date(`${task.due.value}T00:00:00Z`) : task.due?.value;
  const offset = due ? due.getTime() - start.getTime() : 0;
  return rrulestr(task.rrule, { dtstart: start })
    .all((_, index) => index < limit)
    .map((date) => new Date(date.getTime() + offset).toISOString().slice(0, 10));
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

  it("preserves a recurring monthly deadline for consumers of DUE", () => {
    const midnight = new Date("2026-06-15T00:00:00");
    const text = serializeVTodo(
      toCalendar(
        [
          {
            view: view({ allDay: "2026-06-15", due: midnight }),
            recurrence: { frequency: "MONTHLY", byMonthDay: 15 },
          },
        ],
        new Map(),
        stamp,
      ),
    );
    expect(text).toContain("DUE;VALUE=DATE:20260615\r\n");
    const task = parseVTodo(text).tasks[0] as VTodoTask;
    expect(toTaskData(task, { allDayDueInstant: midnight })).toMatchObject({
      task: { dueDate: midnight },
      dueDay: "2026-06-15",
    });
    expect(task.rrule).toBeUndefined();
    expect(task.start).toBeUndefined();
    expect(task.description).toBe("Every month on the 15th");
  });

  it.each([
    [{ frequency: "MONTHLY" }, "2026-06-01", ["2026-06-01", "2026-07-01", "2026-08-01"]],
    [
      { frequency: "MONTHLY", byMonthDay: 15 },
      "2026-06-15",
      ["2026-06-15", "2026-07-15", "2026-08-15"],
    ],
    [
      { frequency: "WEEKLY", byDay: ["Monday", "Wednesday"] },
      "2026-06-01",
      ["2026-06-01", "2026-06-03", "2026-06-08"],
    ],
    [{ frequency: "DAILY", interval: 2 }, "2026-06-01", ["2026-06-01", "2026-06-03", "2026-06-05"]],
    [{ frequency: "YEARLY" }, "2026-06-01", ["2026-06-01", "2027-06-01", "2028-06-01"]],
  ] satisfies [
    RecurrenceRule,
    string,
    string[],
  ][])("imports DTSTART-only %j occurrences", (rule: RecurrenceRule, allDay, expected) => {
    const [task] = parseVTodo(
      serializeVTodo(
        calendar([todo({ start: { kind: "date", value: allDay }, rrule: toRRule(rule) })]),
      ),
    ).tasks;
    expect(task?.start).toEqual({ kind: "date", value: allDay });
    expect(task?.due).toBeUndefined();
    expect(expanded(task as VTodoTask, 3)).toEqual(expected);
    expect(
      calendarTaskData(task as VTodoTask, new Map(), new Date(`${allDay}T00:00:00`)),
    ).toMatchObject({
      allDay,
      dueDate: new Date(`${allDay}T00:00:00`),
      recurrence: { ...rule, interval: rule.interval ?? 1 },
    });
  });
  it("keeps an instant UNTIL in the recurrence description alongside DUE", () => {
    const [task] = toCalendar(
      [
        {
          view: view({ allDay: "2026-06-01", due }),
          recurrence: {
            frequency: "DAILY",
            until: new Date("2026-06-02T23:00:00Z"),
          },
        },
      ],
      new Map(),
      stamp,
    ).tasks;
    expect(task?.rrule).toBeUndefined();
    expect(task?.start).toBeUndefined();
    expect(task?.due).toEqual({ kind: "date", value: "2026-06-01" });
    expect(task?.description).toBe("Every day until 3 Jun 2026");
  });
  it("keeps a date UNTIL in the recurrence description alongside DUE", () => {
    const [task] = toCalendar(
      [
        {
          view: view({ allDay: "2026-06-01", due }),
          recurrence: {
            frequency: "DAILY",
            until: "2026-06-02",
          },
        },
      ],
      new Map(),
      stamp,
    ).tasks;
    expect(task?.rrule).toBeUndefined();
    expect(task?.start).toBeUndefined();
    expect(task?.due).toEqual({ kind: "date", value: "2026-06-01" });
    expect(task?.description).toBe("Every day until 2 Jun 2026");
  });
  it.each([
    [view({ due }), { frequency: "DAILY", until: "2027-01-01" }],
    [view(), { frequency: "DAILY" }],
    [view({ allDay: "2026-06-01", due }), { frequency: "MONTHLY", byMonthDay: 15 }],
    [view({ allDay: "2026-06-01", due }), { frequency: "WEEKLY", byDay: ["Wednesday"] }],
    [view({ allDay: "2026-06-01", due }), { frequency: "DAILY", until: "2026-05-01" }],
    [view({ allDay: "2026-06-01", due, state: "closed" }), { frequency: "DAILY" }],
    [view({ allDay: "2026-06-01", due }), { frequency: "DAILY", interval: 2 }],
    [view({ allDay: "2026-06-01", due }), { frequency: "MONTHLY" }],
    [view({ allDay: "2026-06-01", due }), { frequency: "WEEKLY", byDay: ["Monday"] }],
    [view({ allDay: "2026-06-01", due }), { frequency: "YEARLY" }],
    [view({ allDay: "2026-06-01", due }), { frequency: "DAILY", count: 3 }],
  ] satisfies [
    TaskView,
    RecurrenceRule,
  ][])("exports unrepresentable recurrence as a description: %j", (source, rule) => {
    const [task] = parseVTodo(
      serializeVTodo(
        toCalendar(
          [{ view: { ...source, description: "Original" }, recurrence: rule }],
          new Map(),
          stamp,
        ),
      ),
    ).tasks;
    expect(task?.rrule).toBeUndefined();
    expect(task?.start).toBeUndefined();
    expect(task?.due).toEqual(
      source.allDay
        ? { kind: "date", value: source.allDay }
        : source.due
          ? { kind: "utc", value: source.due }
          : undefined,
    );
    expect(task?.description).toBe(
      `Original\n\n${humanise(rule, source.allDay ? new Date(`${source.allDay}T00:00:00`) : (source.due ?? stamp))}`,
    );
  });
  it.each([
    { rrule: "FREQ=DAILY;UNTIL=20260501", start: { kind: "date", value: "2026-06-01" } },
    { rrule: "FREQ=DAILY", start: { kind: "utc", value: new Date("2026-10-24T09:00:00Z") } },
    {
      rrule: "FREQ=DAILY",
      start: { kind: "utc", value: new Date("2026-10-24T08:00:00Z") },
      due: { kind: "utc", value: new Date("2026-10-24T09:00:00Z") },
    },
    {
      rrule: "FREQ=DAILY",
      start: { kind: "date", value: "2026-06-01" },
      due: { kind: "date", value: "2026-06-02" },
    },
    { rrule: "FREQ=HOURLY", start: { kind: "date", value: "2026-06-01" } },
    { rrule: "FREQ=MONTHLY;BYMONTHDAY=-1", start: { kind: "date", value: "2026-06-01" } },
    { rrule: "FREQ=DAILY;UNTIL=20260605T000000Z", start: { kind: "date", value: "2026-06-01" } },
    { rrule: "FREQ=WEEKLY;BYDAY=WE", start: { kind: "date", value: "2026-06-01" } },
  ] satisfies Partial<VTodoTask>[])("imports unsupported recurrence without repeating: %j", (fields) => {
    const restored = calendarTaskData(
      todo({ ...fields, description: "Original" }),
      new Map(),
      new Date("2026-06-01T00:00:00"),
    );
    expect(restored.recurrence).toBeUndefined();
    expect(restored.description).toBe(`Original\n\nRRULE:${fields.rrule}`);
    expect(restored.dueDate).toBeDefined();
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
