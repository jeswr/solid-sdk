// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  compareDue,
  compareManualOrder,
  comparePriority,
  completeTask,
  type DueDate,
  filterSmartList,
  type ListTask,
  nextOccurrence,
  type RepeatRule,
  rollUpSubtasks,
  type SmartList,
  TaskListError,
} from "../src/apps/tasks/lib/lists";

const allDay = (date: string): DueDate => ({ kind: "all-day", date });
const timed = (at: string): DueDate => ({ kind: "timed", at });
const context = (now = "2026-10-26T12:00:00Z", timeZone = "Europe/London") => ({
  clock: () => new Date(now),
  timeZone,
});
const task = (id: string, fields: Partial<ListTask> = {}): ListTask => ({
  id: `https://example.org/tasks/${id}`,
  state: "open",
  ...fields,
});
const rule = (
  frequency: RepeatRule["frequency"],
  fields: Partial<RepeatRule> = {},
): RepeatRule => ({ frequency, ...fields });
const unsafe = <T>(value: unknown) => value as T;

function fails(action: () => unknown, code?: TaskListError["code"]) {
  expect(action).toThrow(TaskListError);
  if (code) expect(action).toThrow(expect.objectContaining({ code }));
}

describe("smart lists and time-zone boundaries", () => {
  const tasks = [
    task("yesterday", { due: allDay("2026-10-25") }),
    task("today", { due: allDay("2026-10-26") }),
    task("earlier", { due: timed("2026-10-26T11:59:59Z") }),
    task("exact", { due: timed("2026-10-26T12:00:00Z") }),
    task("later", { due: timed("2026-10-26T13:00:00Z") }),
    task("six", { due: allDay("2026-11-01") }),
    task("seven", { due: allDay("2026-11-02") }),
    task("none"),
    task("closed", { state: "completed", due: allDay("2026-10-26") }),
    task("closed-no-date", { state: "completed" }),
  ];
  it.each<[SmartList, string[]]>([
    ["today", ["yesterday", "today", "earlier", "exact", "later"]],
    ["upcoming", ["today", "earlier", "exact", "later", "six"]],
    ["overdue", ["yesterday", "earlier"]],
    ["no-date", ["none"]],
    ["completed", ["closed", "closed-no-date"]],
  ])("evaluates %s without changing input order", (list, ids) => {
    const before = structuredClone(tasks);
    const result = filterSmartList(tasks, list, context());
    expect(result.map(({ id }) => id.split("/").at(-1))).toEqual(ids);
    expect(result).not.toBe(tasks);
    expect(tasks).toEqual(before);
  });
  it("uses the injected zone at midnight, retaining all-day dates", () => {
    const values = [
      task("local", { due: timed("2026-10-26T01:00:00Z") }),
      task("date", { due: allDay("2026-10-26") }),
    ];
    expect(
      filterSmartList(values, "today", context("2026-10-26T02:00:00Z", "America/Los_Angeles")),
    ).toEqual([values[0]]);
    expect(filterSmartList(values, "today", context("2026-10-26T02:00:00Z", "Asia/Tokyo"))).toEqual(
      values,
    );
  });
  it("counts calendar days across a 23-hour DST day and a year boundary", () => {
    const values = [
      task("last", { due: allDay("2026-04-03") }),
      task("outside", { due: allDay("2026-04-04") }),
    ];
    expect(filterSmartList(values, "upcoming", context("2026-03-28T23:30:00Z"))).toEqual([
      values[0],
    ]);
    expect(
      filterSmartList(
        [task("new", { due: allDay("2027-01-01") })],
        "upcoming",
        context("2026-12-30T12:00:00Z"),
      ),
    ).toHaveLength(1);
  });
  it("reads a clock once even for multiple tasks, and handles empty lists", () => {
    let calls = 0;
    expect(
      filterSmartList(tasks, "today", {
        ...context(),
        clock: () => {
          calls++;
          return new Date("2026-10-26T12:00:00Z");
        },
      }),
    ).toHaveLength(5);
    expect(calls).toBe(1);
    expect(filterSmartList([], "today", context())).toEqual([]);
  });
});

describe("sort comparators", () => {
  it("sorts due by local day, then all-day, then instant, with missing dates last", () => {
    const cmp = compareDue("America/New_York");
    const values = [
      task("missing"),
      task("late", { due: timed("2026-10-26T22:00:00Z") }),
      task("day", { due: allDay("2026-10-26") }),
      task("early", { due: timed("2026-10-26T05:00:00Z") }),
      task("previous", { due: timed("2026-10-26T01:00:00Z") }),
    ];
    expect(values.toSorted(cmp).map(({ id }) => id.split("/").at(-1))).toEqual([
      "previous",
      "day",
      "early",
      "late",
      "missing",
    ]);
    expect(cmp(task("a"), task("b"))).toBe(0);
    expect(cmp(values[1] as ListTask, values[0] as ListTask)).toBe(-1);
    expect(
      cmp(task("a", { due: allDay("2026-10-26") }), task("b", { due: allDay("2026-10-26") })),
    ).toBe(0);
    expect(
      cmp(
        task("a", { due: timed("2026-10-26T12:00:00Z") }),
        task("b", { due: timed("2026-10-26T12:00:00.000Z") }),
      ),
    ).toBe(0);
    expect(cmp(values[1] as ListTask, values[2] as ListTask)).toBe(1);
    expect(cmp(values[1] as ListTask, values[3] as ListTask)).toBe(1);
  });
  it("sorts priorities P1–P4 with missing equal to P4, preserving ties", () => {
    const values = [
      task("a"),
      task("b", { priority: 4 }),
      task("c", { priority: 2 }),
      task("d", { priority: 1 }),
      task("e", { priority: 3 }),
    ];
    expect(values.toSorted(comparePriority)).toEqual([
      values[3],
      values[2],
      values[4],
      values[0],
      values[1],
    ]);
    expect(comparePriority(values[0] as ListTask, values[1] as ListTask)).toBe(0);
    expect(comparePriority(values[1] as ListTask, values[0] as ListTask)).toBe(0);
    fails(() => comparePriority(task("a", { priority: unsafe(0) }), task("b")));
  });
  it("uses SH-L1 ASCII keys rather than locale collation, missing last", () => {
    const values = [
      task("none"),
      task("lower", { orderKey: "a" }),
      task("upper", { orderKey: "Z" }),
      task("number", { orderKey: "1" }),
      task("prefix", { orderKey: "a1" }),
    ];
    expect(values.toSorted(compareManualOrder)).toEqual([
      values[3],
      values[2],
      values[1],
      values[4],
      values[0],
    ]);
    expect(compareManualOrder(values[0] as ListTask, task("missing"))).toBe(0);
    expect(compareManualOrder(task("a", { orderKey: "Z" }), task("b", { orderKey: "Z" }))).toBe(0);
    expect(compareManualOrder(task("a", { orderKey: "Z" }), task("b"))).toBe(-1);
    for (const key of ["", "a0", "a-", unsafe<string>(10)])
      fails(() => compareManualOrder(task("a", { orderKey: key }), task("b")));
  });
});

describe("recurrence arithmetic", () => {
  it.each<[DueDate, RepeatRule, DueDate]>([
    [allDay("2026-10-26"), rule("DAILY"), allDay("2026-10-27")],
    [allDay("2026-12-31"), rule("DAILY", { interval: 2 }), allDay("2027-01-02")],
    [allDay("2026-10-26"), rule("WEEKLY"), allDay("2026-11-02")],
    [allDay("2026-10-26"), rule("WEEKLY", { interval: 2 }), allDay("2026-11-09")],
    [
      allDay("2026-10-26"),
      rule("WEEKLY", { byDay: ["WE", "MO"], interval: 2 }),
      allDay("2026-10-28"),
    ],
    [
      allDay("2026-10-28"),
      rule("WEEKLY", { byDay: ["WE", "MO"], interval: 2 }),
      allDay("2026-11-09"),
    ],
    [allDay("2026-11-01"), rule("WEEKLY", { byDay: ["MO"] }), allDay("2026-11-02")],
    [allDay("2026-01-31"), rule("MONTHLY"), allDay("2026-03-31")],
    [allDay("2026-01-31"), rule("MONTHLY", { interval: 2 }), allDay("2026-03-31")],
    [allDay("2026-12-15"), rule("MONTHLY", { byMonthDay: 1 }), allDay("2027-01-01")],
    [allDay("2026-01-15"), rule("MONTHLY", { byMonthDay: 31 }), allDay("2026-03-31")],
    [allDay("2026-10-26"), rule("YEARLY", { interval: 2 }), allDay("2028-10-26")],
    [allDay("2024-02-29"), rule("YEARLY"), allDay("2028-02-29")],
    [allDay("2096-02-29"), rule("YEARLY", { interval: 4 }), allDay("2104-02-29")],
    [timed("2026-10-26T10:20:30.123Z"), rule("MONTHLY"), timed("2026-11-26T10:20:30.123Z")],
  ])("advances %j using %j", (due, repeat, next) => {
    expect(nextOccurrence(due, repeat, context())).toEqual(next);
  });
  it("advances from due even when late, or anchors on completion when requested", () => {
    expect(nextOccurrence(allDay("2026-10-01"), rule("DAILY"), context())).toEqual(
      allDay("2026-10-02"),
    );
    expect(
      nextOccurrence(allDay("2026-10-01"), rule("DAILY", { from: "completion" }), context()),
    ).toEqual(allDay("2026-10-27"));
    expect(
      nextOccurrence(
        timed("2026-10-01T09:00:00Z"),
        rule("DAILY", { from: "completion" }),
        context(),
      ),
    ).toEqual(timed("2026-10-27T12:00:00.000Z"));
    expect(nextOccurrence(undefined, rule("DAILY"), context())).toEqual(
      timed("2026-10-27T12:00:00.000Z"),
    );
    expect(
      nextOccurrence(
        allDay("2026-10-01"),
        rule("DAILY", { from: "completion" }),
        context("2026-10-26T02:00:00Z", "America/Los_Angeles"),
      ),
    ).toEqual(allDay("2026-10-26"));
  });
  it.each([
    ["2026-03-28T09:00:00Z", "DAILY", "2026-03-29T08:00:00.000Z"],
    ["2026-10-24T08:00:00Z", "DAILY", "2026-10-25T09:00:00.000Z"],
    ["2026-03-22T09:00:00Z", "WEEKLY", "2026-03-29T08:00:00.000Z"],
    ["2026-10-18T08:00:00Z", "WEEKLY", "2026-10-25T09:00:00.000Z"],
  ] as const)("preserves London wall time from %s", (at, frequency, next) => {
    expect(nextOccurrence(timed(at), rule(frequency), context())).toEqual(timed(next));
  });
  it("handles fractional-hour offsets and all-day DST dates", () => {
    expect(
      nextOccurrence(
        timed("2026-10-26T03:15:00Z"),
        rule("DAILY"),
        context(undefined, "Asia/Kathmandu"),
      ),
    ).toEqual(timed("2026-10-27T03:15:00.000Z"));
    expect(nextOccurrence(allDay("2026-03-28"), rule("DAILY"), context())).toEqual(
      allDay("2026-03-29"),
    );
  });
  it.each([
    "2026-03-28T01:30:00Z",
    "2026-10-24T00:30:00Z",
  ])("rejects a DST gap/fold after %s", (at) => {
    fails(() => nextOccurrence(timed(at), rule("DAILY"), context()), "unresolvable-local-time");
  });
  it("rejects a half-hour fold and a skipped civil date", () => {
    fails(
      () =>
        nextOccurrence(
          timed("2026-04-03T14:45:00Z"),
          rule("DAILY"),
          context(undefined, "Australia/Lord_Howe"),
        ),
      "unresolvable-local-time",
    );
    fails(
      () =>
        nextOccurrence(
          timed("2011-12-29T20:00:00Z"),
          rule("DAILY"),
          context(undefined, "Pacific/Apia"),
        ),
      "unresolvable-local-time",
    );
  });
  it("honors inclusive until and total occurrence count", () => {
    expect(
      nextOccurrence(
        allDay("2026-10-26"),
        rule("DAILY", { until: allDay("2026-10-27") }),
        context(),
      ),
    ).toEqual(allDay("2026-10-27"));
    expect(
      nextOccurrence(
        allDay("2026-10-26"),
        rule("DAILY", { until: allDay("2026-10-26") }),
        context(),
      ),
    ).toBeUndefined();
    expect(
      nextOccurrence(
        timed("2026-10-26T09:00:00Z"),
        rule("DAILY", { until: timed("2026-10-27T09:00:00Z") }),
        context(),
      ),
    ).toEqual(timed("2026-10-27T09:00:00.000Z"));
    expect(
      nextOccurrence(
        timed("2026-10-26T09:00:00Z"),
        rule("DAILY", { until: timed("2026-10-27T08:59:59Z") }),
        context(),
      ),
    ).toBeUndefined();
    expect(
      nextOccurrence(allDay("2026-10-26"), rule("DAILY", { count: 3 }), {
        ...context(),
        completedOccurrences: 1,
      }),
    ).toEqual(allDay("2026-10-27"));
    expect(
      nextOccurrence(allDay("2026-10-26"), rule("DAILY", { count: 3 }), {
        ...context(),
        completedOccurrences: 2,
      }),
    ).toBeUndefined();
    fails(() => nextOccurrence(allDay("2026-10-26"), rule("DAILY", { count: 3 }), context()));
    fails(
      () =>
        nextOccurrence(
          allDay("2026-10-26"),
          rule("DAILY", { until: timed("2027-01-01T00:00:00Z") }),
          context(),
        ),
      "unsupported-rule",
    );
    for (const completedOccurrences of [-1, 1.5, NaN])
      fails(() => nextOccurrence(undefined, rule("DAILY"), { ...context(), completedOccurrences }));
  });
  it.each([
    ["2026-03-28T01:30:00Z", "2026-03-28T01:30:00Z"],
    ["2026-03-28T01:30:00Z", "2026-03-29T00:59:59Z"],
    ["2026-10-24T00:30:00Z", "2026-10-24T00:30:00Z"],
  ])("exhausts the rule from %s before resolving a gap/fold beyond %s", (at, until) => {
    expect(
      nextOccurrence(timed(at), rule("DAILY", { until: timed(until) }), context()),
    ).toBeUndefined();
  });
  it.each([
    ["2026-03-28T01:30:00Z", "2026-03-29T02:00:00Z"],
    ["2026-10-24T00:30:00Z", "2026-10-25T02:00:00Z"],
  ])("still rejects an in-range gap/fold after %s", (at, until) => {
    fails(
      () => nextOccurrence(timed(at), rule("DAILY", { until: timed(until) }), context()),
      "unresolvable-local-time",
    );
  });
  it.each([
    "2026-10-25T00:45:00Z",
    "2026-10-25T01:30:00Z",
    "2026-10-25T01:45:00Z",
  ])("rejects a fold when either possible instant is within until %s", (until) => {
    const recurrence = rule("DAILY", { until: timed(until) });
    const original = task("fold", {
      due: timed("2026-10-24T00:45:00Z"),
      recurrence,
    });
    const before = structuredClone(original);
    fails(() => nextOccurrence(original.due, recurrence, context()), "unresolvable-local-time");
    fails(() => completeTask(original, context()), "unresolvable-local-time");
    expect(original).toEqual(before);
  });
  it("exhausts a fold only when both possible instants exceed until", () => {
    expect(
      nextOccurrence(
        timed("2026-10-24T00:45:00Z"),
        rule("DAILY", { until: timed("2026-10-25T00:44:59.999Z") }),
        context(),
      ),
    ).toBeUndefined();
  });
  it.each<RepeatRule>([
    rule("DAILY"),
    rule("WEEKLY"),
    rule("WEEKLY", { byDay: ["MO"] }),
    rule("MONTHLY"),
    rule("YEARLY"),
    rule("DAILY", { interval: Number.MAX_SAFE_INTEGER }),
    rule("MONTHLY", { interval: Number.MAX_SAFE_INTEGER }),
  ])("exhausts %j before advancing beyond year 9999", (repeat) => {
    const due = allDay("9999-12-31");
    const recurrence = { ...repeat, until: due };
    const original = task("final", { due, recurrence });
    const before = structuredClone(original);
    expect(nextOccurrence(due, recurrence, context())).toBeUndefined();
    expect(completeTask(original, context())).toEqual({
      task: {
        ...original,
        state: "completed",
        completedAt: "2026-10-26T12:00:00.000Z",
        modifiedAt: "2026-10-26T12:00:00.000Z",
      },
    });
    expect(original).toEqual(before);
  });
  it("keeps the final supported all-day occurrence when it equals until", () => {
    expect(
      nextOccurrence(
        allDay("9999-12-30"),
        rule("DAILY", { until: allDay("9999-12-31") }),
        context(),
      ),
    ).toEqual(allDay("9999-12-31"));
  });
  it("fails closed on impossible calendar cycles and date overflow", () => {
    fails(
      () =>
        nextOccurrence(
          allDay("2026-02-01"),
          rule("MONTHLY", { interval: 12, byMonthDay: 31 }),
          context(),
        ),
      "unsupported-rule",
    );
    fails(
      () => nextOccurrence(allDay("9999-12-31"), rule("DAILY"), context()),
      "date-out-of-range",
    );
    fails(
      () => nextOccurrence(allDay("9999-12-01"), rule("MONTHLY"), context()),
      "date-out-of-range",
    );
    fails(
      () => nextOccurrence(allDay("9999-01-01"), rule("YEARLY"), context()),
      "date-out-of-range",
    );
    fails(
      () =>
        nextOccurrence(
          allDay("2026-01-01"),
          rule("DAILY", { interval: Number.MAX_SAFE_INTEGER }),
          context(),
        ),
      "date-out-of-range",
    );
  });
});

describe("completion plans and subtask roll-up", () => {
  it("closes a normal task without changing its open children", () => {
    const parent = task("parent");
    const child = task("child", { parentId: parent.id });
    const plan = completeTask(parent, context());
    expect(plan).toEqual({
      task: {
        ...parent,
        state: "completed",
        completedAt: "2026-10-26T12:00:00.000Z",
        modifiedAt: "2026-10-26T12:00:00.000Z",
      },
    });
    expect(parent.state).toBe("open");
    expect(child.state).toBe("open");
    expect(rollUpSubtasks([plan.task, child]).get(parent.id)).toEqual({
      total: 1,
      completed: 0,
      open: 1,
      allCompleted: false,
    });
  });
  it("advances the original and copies metadata, old due, parent and provenance to history", () => {
    const original = {
      ...task("repeat", {
        due: allDay("2026-10-26"),
        recurrence: rule("DAILY"),
        parentId: "https://example.org/tasks/parent",
        priority: 2,
        orderKey: "Z",
      }),
      title: "Water the fictional fern",
      labels: ["garden"],
      description: "Synthetic fixture",
      tracker: "https://example.org/projects/home",
    };
    const before = structuredClone(original);
    let calls = 0;
    const plan = completeTask(original, {
      ...context(),
      occurrenceId: "https://example.org/tasks/history",
      clock: () => {
        calls++;
        return new Date("2026-10-26T12:00:00Z");
      },
    });
    expect(calls).toBe(1);
    expect(plan.task).toEqual({
      ...original,
      due: allDay("2026-10-27"),
      modifiedAt: "2026-10-26T12:00:00.000Z",
    });
    const { recurrence: _, ...history } = original;
    expect(plan.completedOccurrence).toEqual({
      ...history,
      id: "https://example.org/tasks/history",
      state: "completed",
      derivedFrom: original.id,
      completedAt: "2026-10-26T12:00:00.000Z",
      modifiedAt: "2026-10-26T12:00:00.000Z",
    });
    expect(plan.completedOccurrence).not.toHaveProperty("recurrence");
    expect(original).toEqual(before);
    expect(plan.task).not.toBe(original);
    expect(plan.completedOccurrence).not.toBe(original);
  });
  it("closes exhausted originals, and allows recurring tasks without a due", () => {
    const original = task("repeat", { recurrence: rule("DAILY", { count: 1 }) });
    expect(completeTask(original, { ...context(), completedOccurrences: 0 }).task.state).toBe(
      "completed",
    );
    const plan = completeTask(
      task("repeat", { recurrence: rule("DAILY", { from: "completion" }) }),
      { ...context(), occurrenceId: "https://example.org/history" },
    );
    expect(plan.task.due).toEqual(timed("2026-10-27T12:00:00.000Z"));
    expect(plan.completedOccurrence).not.toHaveProperty("due");
  });
  it("closes an until-exhausted original before the next occurrence's DST gap", () => {
    const due = timed("2026-03-28T01:30:00Z");
    const original = task("repeat", { due, recurrence: rule("DAILY", { until: due }) });
    const before = structuredClone(original);
    expect(completeTask(original, context("2026-03-28T02:00:00Z"))).toEqual({
      task: {
        ...original,
        state: "completed",
        completedAt: "2026-03-28T02:00:00.000Z",
        modifiedAt: "2026-03-28T02:00:00.000Z",
      },
    });
    expect(original).toEqual(before);
  });
  it("rejects closed, inconsistently timestamped or unidentifiable completions", () => {
    fails(() => completeTask(task("closed", { state: "completed" }), context()));
    fails(() => completeTask(task("bad", { completedAt: "2026-10-26T12:00:00Z" }), context()));
    const original = task("repeat", { recurrence: rule("DAILY") });
    for (const occurrenceId of [undefined, "", " ", original.id]) {
      fails(() =>
        completeTask(original, {
          ...context(),
          ...(occurrenceId === undefined ? {} : { occurrenceId }),
        }),
      );
    }
  });
  it("reports mixed/empty/full progress without auto-completing or reopening parents", () => {
    const parent = task("parent");
    const first = task("first", { parentId: parent.id, state: "completed" });
    const second = task("second", { parentId: parent.id });
    const values = [parent, first, second, task("empty")];
    const before = structuredClone(values);
    const progress = rollUpSubtasks(values);
    expect(progress.get(parent.id)).toEqual({
      total: 2,
      completed: 1,
      open: 1,
      allCompleted: false,
    });
    expect(progress.get(first.id)).toEqual({
      total: 0,
      completed: 0,
      open: 0,
      allCompleted: false,
    });
    expect(rollUpSubtasks([parent, first]).get(parent.id)?.allCompleted).toBe(true);
    expect(parent.state).toBe("open");
    expect(values).toEqual(before);
    expect(rollUpSubtasks([]).size).toBe(0);
  });
  it("rejects duplicate, missing-parent, cyclic and multi-level hierarchies", () => {
    const a = task("a");
    const b = task("b", { parentId: a.id });
    const c = task("c", { parentId: b.id });
    for (const values of [
      [a, a],
      [b],
      [a, b, c],
      [{ ...a, parentId: a.id }],
      [{ ...a, parentId: b.id }, b],
    ]) {
      fails(() => rollUpSubtasks(values), "invalid-hierarchy");
    }
    fails(() => rollUpSubtasks(unsafe(null)));
  });
});

describe("typed input errors", () => {
  it.each([
    null,
    [],
    3,
    {},
    { id: "", state: "open" },
    { id: " ", state: "open" },
    { id: "a", state: "unknown" },
    { id: "a", state: "open", due: null },
    { id: "a", state: "open", due: { kind: "floating", date: "2026-10-26" } },
    { id: "a", state: "open", due: { kind: "all-day", date: "2026-10-26", time: "12:00" } },
    {
      id: "a",
      state: "open",
      due: { kind: "timed", at: "2026-10-26T12:00:00Z", date: "2026-10-26" },
    },
  ])("rejects malformed task %j", (value) => {
    fails(() => filterSmartList([unsafe<ListTask>(value)], "today", context()));
  });
  it.each([
    allDay("2026-02-30"),
    allDay("2026-13-01"),
    allDay("2026-1-01"),
    allDay("1969-12-31"),
    allDay("10000-01-01"),
    unsafe<DueDate>({ kind: "all-day" }),
    timed("2026-10-26T25:00:00Z"),
    timed("2026-02-30T12:00:00Z"),
    timed("2026-10-26T12:00:00+01:00"),
    timed("2026-10-26"),
    timed("2026-10-26T12:00:00.1Z"),
    unsafe<DueDate>({ kind: "timed", at: 42 }),
  ])("rejects invalid date %j even in Completed or No date", (due) => {
    fails(() => filterSmartList([task("invalid", { due })], "completed", context()));
    fails(() => filterSmartList([task("invalid", { due })], "no-date", context()));
  });
  it("validates lists and contexts even for empty inputs", () => {
    fails(() => filterSmartList(unsafe<ListTask[]>(null), "today", context()));
    fails(() => filterSmartList([], unsafe("unknown"), context()));
    fails(() => filterSmartList([], "today", unsafe(null)));
    fails(() => filterSmartList([], "today", { ...context(), clock: unsafe(0) }));
    fails(() => filterSmartList([], "today", { ...context(), clock: () => unsafe("2026-10-26") }));
    fails(
      () => filterSmartList([], "today", { ...context(), clock: () => new Date(NaN) }),
      "date-out-of-range",
    );
    for (const timeZone of ["", "+01:00", unsafe<string>(null)]) fails(() => compareDue(timeZone));
    fails(
      () => filterSmartList([], "today", context(undefined, "Mars/Olympus")),
      "invalid-time-zone",
    );
  });
  it.each([
    null,
    { frequency: "HOURLY" },
    { frequency: "DAILY", interval: 0 },
    { frequency: "DAILY", interval: 1.5 },
    { frequency: "DAILY", interval: "2" },
    { frequency: "DAILY", from: "start" },
    { frequency: "DAILY", byDay: ["MO"] },
    { frequency: "WEEKLY", byDay: [] },
    { frequency: "WEEKLY", byDay: "MO" },
    { frequency: "WEEKLY", byDay: ["MO", "MO"] },
    { frequency: "WEEKLY", byDay: ["1MO"] },
    { frequency: "MONTHLY", byMonthDay: -1 },
    { frequency: "MONTHLY", byMonthDay: 32 },
    { frequency: "MONTHLY", byMonthDay: 1.5 },
    { frequency: "YEARLY", byMonthDay: 1 },
    { frequency: "DAILY", count: 0 },
    { frequency: "DAILY", count: 1.5 },
    { frequency: "DAILY", count: 3, until: allDay("2027-01-01") },
    { frequency: "DAILY", exceptDate: ["2026-10-27"] },
    { frequency: "MONTHLY", byMonth: 2 },
  ])("rejects unsupported rule %j", (repeat) => {
    fails(() => nextOccurrence(allDay("2026-10-26"), unsafe(repeat), context()));
  });
});

it("preserves comparator symmetry for absent values", () => {
  const absent = task("a");
  const present = task("b", { due: allDay("2026-10-26"), orderKey: "Z" });
  expect(compareDue("UTC")(absent, present)).toBe(1);
  expect(compareManualOrder(absent, present)).toBe(1);
});

it("resolves supported boundary instants without treating offset probes as input", () => {
  expect(
    nextOccurrence(
      timed("1970-01-01T12:00:00Z"),
      rule("DAILY"),
      context("1970-01-01T12:00:00Z", "America/New_York"),
    ),
  ).toEqual(timed("1970-01-02T12:00:00.000Z"));
  expect(
    nextOccurrence(timed("9999-12-30T12:00:00Z"), rule("DAILY"), context(undefined, "UTC")),
  ).toEqual(timed("9999-12-31T12:00:00.000Z"));
  fails(
    () => filterSmartList([], "today", context("1970-01-01T00:00:00Z", "America/New_York")),
    "date-out-of-range",
  );
});

it("rejects holes in input arrays rather than skipping missing entries", () => {
  fails(() => filterSmartList(new Array<ListTask>(1), "today", context()));
  fails(() => rollUpSubtasks(new Array<ListTask>(1)));
  fails(
    () =>
      nextOccurrence(
        allDay("2026-10-26"),
        rule("WEEKLY", { byDay: new Array<"MO">(1) }),
        context(),
      ),
    "unsupported-rule",
  );
});
