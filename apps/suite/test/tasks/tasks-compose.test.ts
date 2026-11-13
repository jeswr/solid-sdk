// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { needsConfirm, splitPaste } from "../../src/apps/tasks/lib/compose/paste";
import {
  type ChipId,
  type ComposeContext,
  parseQuickAdd,
  removeChip,
} from "../../src/apps/tasks/lib/compose/quick-add";
import { validateRule } from "../../src/apps/tasks/lib/model/recurrence";
import { validateReminders } from "../../src/apps/tasks/lib/model/reminders";

const ctx: ComposeContext = {
  now: new Date("2026-10-30T12:00:00Z"),
  tz: "Europe/London",
  projects: [
    { url: "https://pod.test/home", title: "Home" },
    { url: "https://pod.test/work", title: "Work" },
    { url: "https://pod.test/garden", title: "Garden renovation" },
  ],
  labels: ["bills", "shopping", "outdoors"],
};
const parse = (text: string, extra: Partial<ComposeContext> = {}) =>
  parseQuickAdd(text, { ...ctx, ...extra });
afterEach(() => vi.unstubAllEnvs());

describe("compose dates and times", () => {
  it("retains the monthly ordinal in the model rule and repeat chip", () => {
    const result = parse("Review every 3rd Friday");
    expect(result.recurrence).toEqual({
      frequency: "MONTHLY",
      interval: 1,
      byDay: ["Friday"],
      bySetPos: 3,
    });
    expect(result.due?.allDay).toBe("2026-11-20");
    expect(result.chips.map((chip) => chip.label)).toContain(
      "Repeats every month on the 3rd Friday",
    );
  });
  it.each([
    ["today", "2026-10-30", "Due Today"],
    ["tomorrow", "2026-10-31", "Due Tomorrow"],
    ["Monday", "2026-11-02", "Due Mon"],
    ["in 6 days", "2026-11-05", "Due Thu"],
    ["in 7 days", "2026-11-06", "Due 6 Nov"],
    ["15 November", "2026-11-15", "Due 15 Nov"],
    ["3 November 2027", "2027-11-03", "Due 3 Nov 2027"],
    ["yesterday", "2026-10-29", "Due 29 Oct"],
    ["31/10/2026", "2026-10-31", "Due Tomorrow"],
    ["10/11/2026", "2026-11-10", "Due 10 Nov"],
  ])("parses GB calendar phrase %s", (phrase, date, chip) => {
    const result = parse(`Do it ${phrase}`, { locale: "en-GB" });
    expect(result.title).toBe("Do it");
    expect(result.due).toEqual({ date: new Date(`${date}T00:00:00Z`), allDay: date });
    expect(result.chips.map((c) => c.label)).toContain(chip);
  });
  it.each([
    ["10/31/2026", "2026-10-31"],
    ["11/10/2026", "2026-11-10"],
    ["October 31", "2026-10-31"],
    ["November 3, 2027", "2027-11-03"],
  ])("parses US calendar phrase %s", (phrase, date) => {
    expect(parse(`Do it ${phrase}`, { locale: "en-US" }).due?.allDay).toBe(date);
  });
  it.each([
    ["today 5pm", "2026-10-30T17:00:00.000Z", "Due Today 17:00"],
    ["tomorrow 9am", "2026-10-31T09:00:00.000Z", "Due Tomorrow 09:00"],
    ["tomorrow 17:30", "2026-10-31T17:30:00.000Z", "Due Tomorrow 17:30"],
    ["Monday at noon", "2026-11-02T12:00:00.000Z", "Due Mon 12:00"],
    ["in 1 hour", "2026-10-30T13:00:00.000Z", "Due Today 13:00"],
  ])("parses a timed deadline %s", (phrase, iso, chip) => {
    const result = parse(`Do it ${phrase}`);
    expect(result.due).toEqual({ date: new Date(iso) });
    expect(result.chips[0]?.label).toBe(chip);
  });
  it("converts summer all-day dates to London midnight", () => {
    expect(parse("Do it tomorrow", { now: new Date("2026-07-01T12:00Z") }).due).toEqual({
      date: new Date("2026-07-01T23:00Z"),
      allDay: "2026-07-02",
    });
  });
  it("resolves the first valid instant when DST skips midnight", () => {
    const result = parse("Task 6 September 2026", { tz: "America/Santiago" });
    expect(result).toMatchObject({
      title: "Task",
      due: { date: new Date("2026-09-06T04:00Z"), allDay: "2026-09-06" },
    });
    expect(result.chips[0]?.label).toBe("Due 6 Sept");
  });
  it("rejects an entirely skipped all-day date", () => {
    expect(() =>
      parse("Do it 30 December 2011", { tz: "Pacific/Apia", now: new Date("2011-12-28T12:00Z") }),
    ).toThrow("Nonexistent local date");
  });
});

describe("compose recurrence", () => {
  it.each([
    ["every day", "DAILY", 1, "2026-10-30"],
    ["daily", "DAILY", 1, "2026-10-30"],
    ["every 2 days", "DAILY", 2, "2026-10-30"],
    ["every weekday", "WEEKLY", 1, "2026-10-30"],
    ["every monday", "WEEKLY", 1, "2026-11-02"],
    ["every Friday", "WEEKLY", 1, "2026-10-30"],
    ["every week", "WEEKLY", 1, "2026-10-30"],
    ["weekly", "WEEKLY", 1, "2026-10-30"],
    ["every 2 weeks", "WEEKLY", 2, "2026-10-30"],
    ["every month", "MONTHLY", 1, "2026-10-30"],
    ["monthly", "MONTHLY", 1, "2026-10-30"],
    ["every 3 months", "MONTHLY", 3, "2026-10-30"],
    ["every 15th", "MONTHLY", 1, "2026-11-15"],
    ["every year", "YEARLY", 1, "2026-10-30"],
    ["yearly", "YEARLY", 1, "2026-10-30"],
    ["every 2 years", "YEARLY", 2, "2026-10-30"],
  ] as const)("adapts %s to model recurrence", (phrase, frequency, interval, date) => {
    const result = parse(`Water plants ${phrase}`);
    expect(result.title).toBe("Water plants");
    expect(result.recurrence).toMatchObject({ frequency, interval });
    assert.isDefined(result.recurrence);
    validateRule(result.recurrence);
    expect(result.due?.allDay).toBe(date);
    expect(result.chips.find((c) => c.kind === "repeat")?.label).toMatch(/^Repeats every /);
  });
  it("matches the spec's rent example with an explicit date before recurrence", () => {
    const result = parse("Pay rent tomorrow 5pm #Home @bills p2 every month");
    expect(result).toMatchObject({
      title: "Pay rent",
      due: { date: new Date("2026-10-31T17:00Z") },
      recurrence: { frequency: "MONTHLY", interval: 1 },
      priority: 2,
      project: { kind: "existing", url: ctx.projects[0]?.url },
      labels: [{ name: "bills", existing: true }],
      canSubmit: true,
    });
    expect(result.chips.map((c) => c.label)).toEqual([
      "Due Tomorrow 17:00",
      "#Home",
      "@bills",
      "P2",
      "Repeats every month on the 31st",
    ]);
  });
  it("takes the next weekday after a weekend", () => {
    expect(parse("Work every weekday", { now: new Date("2026-10-31T12:00Z") }).due?.allDay).toBe(
      "2026-11-02",
    );
  });
  it("keeps the recurrence weekday when a lone time is present", () => {
    expect(parse("Call every monday 9am").due?.date).toEqual(new Date("2026-11-02T09:00Z"));
  });
  it.each([
    ["every month", "2026-10-30T12:00Z", "Every month on the 30th", "2026-10-30"],
    ["every year", "2026-10-30T12:00Z", "Every year on 30 Oct", "2026-10-30"],
    ["every year", "2026-11-01T12:00Z", "Every year on 1 Nov", "2026-11-01"],
  ])("formats %s against the injected negative-offset zone", (phrase, now, copy, date) => {
    vi.stubEnv("TZ", "America/New_York");
    expect(new Date("2026-10-30T00:00Z").getDate()).toBe(29);
    const result = parse(`Task ${phrase}`, { tz: "America/New_York", now: new Date(now) });
    expect(result.due?.allDay).toBe(date);
    expect(result.chips.find((chip) => chip.kind === "repeat")?.label).toBe(
      `Repeats ${copy[0]?.toLowerCase()}${copy.slice(1)}`,
    );
  });
  it("formats a recurrence in a different zone from the host", () => {
    vi.stubEnv("TZ", "America/New_York");
    const result = parse("Task every year", { now: new Date("2026-11-01T00:30Z") });
    expect(result.due?.allDay).toBe("2026-11-01");
    expect(result.chips.find((chip) => chip.kind === "repeat")?.label).toBe(
      "Repeats every year on 1 Nov",
    );
  });
});

describe("projects, labels, priorities and literal text", () => {
  it.each([
    ["#Home", "home"],
    ["#home", "home"],
    ["#Ho", "home"],
    ["#Hme", "home"],
    ["#Hmoe", "home"],
    ["#Grdnrnvtn", "garden"],
    ["#Wor", "work"],
  ])("resolves project %s", (token, url) => {
    expect(parse(`Task ${token}`).project).toEqual({
      kind: "existing",
      url: `https://pod.test/${url}`,
    });
  });
  it("prefers exact over prefix and prefix over fuzzy", () => {
    const projects = [
      { url: "a", title: "Homework" },
      { url: "b", title: "Home" },
      { url: "c", title: "Hole" },
    ];
    expect(parse("Task #Home", { projects }).project).toEqual({ kind: "existing", url: "b" });
    expect(parse("Task #Hom", { projects }).project).toEqual({ kind: "existing", url: "a" });
  });
  it("offers unknown project creation", () => {
    const result = parse("Task #Unknown");
    expect(result.project).toEqual({ kind: "create", name: "Unknown" });
    expect(result.chips[0]?.label).toBe("Create project 'Unknown'");
  });
  it.each(["#Work", "#Unknown"])("clears a prefilled section when %s changes project", (token) => {
    const result = parse(`Task ${token}`, {
      defaults: { projectUrl: "https://pod.test/home", sectionId: "https://pod.test/home#doing" },
    });
    expect(result.sectionId).toBeUndefined();
    expect(result.chips.some((chip) => chip.kind === "section")).toBe(false);
  });
  it("keeps the prefilled section when an explicit project resolves to the default", () => {
    expect(
      parse("Task #Ho", {
        defaults: { projectUrl: "https://pod.test/home", sectionId: "https://pod.test/home#doing" },
      }).sectionId,
    ).toBe("https://pod.test/home#doing");
  });
  it.each([
    ["@bills", "bills"],
    ["@BILLS", "bills"],
    ["@bill", "bills"],
    ["@blls", "bills"],
    ["@bilsl", "bills"],
  ])("resolves label %s", (token, name) => {
    expect(parse(`Task ${token}`).labels).toEqual([{ name, existing: true }]);
  });
  it("creates unknown labels and deduplicates resolved labels", () => {
    expect(parse("Task @Unknown @bills @BILLS @bill").labels).toEqual([
      { name: "Unknown", existing: false },
      { name: "bills", existing: true },
    ]);
  });
  it.each([1, 2, 3, 4] as const)("sets P%s", (priority) => {
    expect(parse(`Task p${priority}`)).toMatchObject({
      title: "Task",
      priority,
      chips: [{ label: `P${priority}` }],
    });
  });
  it.each([
    "",
    "   ",
    "tomorrow p1 #Home @bills every day",
  ])("disables an empty title %j", (text) => {
    expect(parse(text).canSubmit).toBe(false);
  });
  it.each([
    "a@example.test",
    "https://example.test/#Home",
    "p5",
    "#",
    "@",
  ])("keeps literal %s", (text) => {
    expect(parse(`Task ${text}`).title).toBe(`Task ${text}`);
  });
  it("collapses whitespace", () => {
    expect(parse("  Task   name\n here  ").title).toBe("Task name here");
  });
  it("returns exact original UTF-16 spans", () => {
    const text = "🌱 Water tomorrow #Home @bills p1 every day !1h before";
    expect(
      parse(text)
        .chips.filter((c) => c.span.end > c.span.start)
        .map((c) => text.slice(c.span.start, c.span.end)),
    ).toEqual(["tomorrow", "#Home", "@bills", "p1", "every day", "!1h before"]);
  });
});

describe("reminders and keep-text", () => {
  it.each([
    ["!1h before", "-PT1H", "Remind 1 hour before"],
    ["!30m before", "-PT30M", "Remind 30 minutes before"],
    ["!1 day before", "-P1D", "Remind 1 day before"],
    ["!2 days before", "-P2D", "Remind 2 days before"],
    ["!2 hours before", "-PT2H", "Remind 2 hours before"],
    ["!1 minute before", "-PT1M", "Remind 1 minute before"],
  ])("adapts %s", (phrase, offset, label) => {
    const result = parse(`Task tomorrow ${phrase}`);
    expect(result.title).toBe("Task");
    expect(result.reminders).toEqual([{ offset }]);
    validateReminders(result.reminders, result.due?.date);
    expect(result.chips.find((c) => c.kind === "reminder")?.label).toBe(label);
  });
  it.each([
    ["!9am", "2026-10-31T09:00Z", "Remind Tomorrow 09:00"],
    ["!tomorrow 9am", "2026-10-31T09:00Z", "Remind Tomorrow 09:00"],
    ["!tomorrow", "2026-10-31T00:00Z", "Remind Tomorrow"],
  ])("adapts absolute reminder %s", (phrase, time, label) => {
    const result = parse(`Task tomorrow 5pm ${phrase}`);
    expect(result.title).toBe("Task");
    expect(result.reminders).toEqual([{ time: new Date(time) }]);
    expect(result.chips.find((c) => c.kind === "reminder")?.label).toBe(label);
  });
  it("keeps the deadline separate from a time-first reminder", () => {
    const result = parse("Task !9am tomorrow 5pm");
    expect(result.due?.date).toEqual(new Date("2026-10-31T17:00Z"));
    expect(result.reminders).toEqual([{ time: new Date("2026-10-31T09:00Z") }]);
  });
  it("uses US calendar qualifiers for reminders", () => {
    const result = parse("Task tomorrow 5pm !9am on 11/02/2026", { locale: "en-US" });
    expect(result.title).toBe("Task");
    expect(result.reminders).toEqual([{ time: new Date("2026-11-02T09:00Z") }]);
  });
  it.each([
    "!9am on nonsense tomorrow 5pm",
    "!29 March 2026 1:30am",
  ])("keeps an unresolved reminder literal: %s", (reminder) => {
    const result = parse(`Task ${reminder}`);
    expect(result.title).toBe(`Task ${reminder}`);
    expect(result.reminders).toEqual([]);
    expect(result.due).toBeUndefined();
  });
  it.each([
    "Task tomorrow 5pm !9am on Monday",
    "Task !9am on Monday tomorrow 5pm",
  ])("consumes the complete connected calendar qualifier in %s", (text) => {
    const result = parse(text);
    expect(result.title).toBe("Task");
    expect(result.due?.date).toEqual(new Date("2026-10-31T17:00Z"));
    expect(result.reminders).toEqual([{ time: new Date("2026-11-02T09:00Z") }]);
    const chip = result.chips.find((chip) => chip.kind === "reminder");
    assert.isDefined(chip);
    expect(text.slice(chip.span.start, chip.span.end)).toBe("!9am on Monday");
  });
  it.each([
    "Task @bills @shopping",
    "Task tomorrow !1h before !9am",
  ])("removes each repeatable chip independently in %s", (text) => {
    const initial = parse(text);
    const kind = text.includes("@") ? "label" : "reminder";
    const chips = initial.chips.filter((chip) => chip.kind === kind);
    expect(chips).toHaveLength(2);
    for (const [index, chip] of chips.entries()) {
      const removed = removeChip(text, chip);
      const result = parse(text, { keepText: removed.keepText });
      expect(result.title).toBe(`Task ${text.slice(chip.span.start, chip.span.end)}`);
      expect(result.chips.filter((chip) => chip.kind === kind)).toEqual([chips[1 - index]]);
      expect(kind === "label" ? result.labels : result.reminders).toEqual([
        (kind === "label" ? initial.labels : initial.reminders)[1 - index],
      ]);
    }
  });
  it.each([
    "!1h before",
    "!tomorrow 9am",
  ])("drops %s without due, shows warning, permits submission", (phrase) => {
    const result = parse(`Task ${phrase}`);
    expect(result).toMatchObject({
      title: "Task",
      canSubmit: true,
      reminders: [],
      chips: [{ kind: "reminder", invalid: true }],
    });
    expect(result.due).toBeUndefined();
  });
  it("retains unknown reminder text", () => {
    expect(parse("Task !nonsense").title).toBe("Task !nonsense");
    expect(parse("Task !sometime tomorrow").title).toBe("Task !sometime");
  });
  it.each([
    ["due", "Task tomorrow", "due"],
    ["repeat", "Task every monday", "recurrence"],
    ["project", "Task #Home", "project"],
    ["label", "Task @bills", "labels"],
    ["priority", "Task p1", "priority"],
    ["reminder", "Task !9am", "reminders"],
  ] as const)("removing %s restores its literal token", (kind, text, field) => {
    const initial = parse(text);
    const chip = initial.chips.find((c) => c.kind === kind);
    assert.isDefined(chip);
    const removed = removeChip(text, chip);
    const result = parse(removed.text, { keepText: removed.keepText });
    expect(result.title).toBe(text);
    expect(result.chips.some((c) => c.kind === kind)).toBe(false);
    expect(result[field]).toEqual(
      field === "priority" ? 4 : field === "labels" || field === "reminders" ? [] : undefined,
    );
    if (kind === "repeat") expect(result.due).toBeUndefined();
  });
  it("keeps due and recurrence interpretations independent", () => {
    const result = parse("Task tomorrow every monday", { keepText: new Set(["repeat:14"]) });
    expect(result.title).toBe("Task every monday");
    expect(result.due?.allDay).toBe("2026-10-31");
    expect(result.recurrence).toBeUndefined();
    const noDue = parse("Task every monday", { keepText: new Set(["due:0"]) });
    expect(noDue.recurrence?.frequency).toBe("WEEKLY");
    expect(noDue.due).toBeUndefined();
  });
  it("accumulates removals without mutating the previous set", () => {
    const initial = new Set<ChipId>(["due:0"]);
    const chip = parse("Task p1").chips[0];
    assert.isDefined(chip);
    const removed = removeChip("Task p1", chip, initial);
    expect([...removed.keepText]).toEqual(["due:0", "priority:5"]);
    expect([...initial]).toEqual(["due:0"]);
  });
  it("uses defaults and permits removing default interpretations", () => {
    const defaults = {
      projectUrl: "default",
      sectionId: "Doing",
      due: { date: new Date("2026-10-31T00:00Z"), allDay: "2026-10-31" },
    };
    expect(parse("Task", { defaults })).toMatchObject({
      project: { kind: "existing", url: "default" },
      sectionId: "Doing",
      due: defaults.due,
    });
    expect(parse("Task #Work today", { defaults })).toMatchObject({
      project: { kind: "existing", url: ctx.projects[1]?.url },
      due: { allDay: "2026-10-30" },
    });
    expect(parse("Task", { defaults }).chips.find((c) => c.kind === "section")?.label).toBe(
      "Section",
    );
    expect(
      parse("Task", { defaults: { ...defaults, sectionName: "Doing" } }).chips.find(
        (c) => c.kind === "section",
      )?.label,
    ).toBe("Doing");
    expect(
      parse("Task", { defaults, keepText: new Set(["due:0", "project:0", "section:0"]) }),
    ).toMatchObject({ title: "Task", chips: [] });
  });
});

describe("multi-line paste", () => {
  it("splits parents and flattens nested children", () => {
    expect(splitPaste("Parent\n  Child\n    Deep child\n\tTab child\nNext\n\n  Last")).toEqual([
      { title: "Parent", children: ["Child", "Deep child", "Tab child"] },
      { title: "Next", children: ["Last"] },
    ]);
  });
  it("promotes an indented first line and ignores empty lines", () => {
    expect(splitPaste("\n  First\n\tSecond\r\nThird\r Fourth\n  ")).toEqual([
      { title: "First", children: ["Second"] },
      { title: "Third", children: [] },
      { title: "Fourth", children: [] },
    ]);
    expect(splitPaste(" \n\t")).toEqual([]);
  });
  it("confirms above five resources including children", () => {
    expect(needsConfirm(5)).toBe(false);
    expect(needsConfirm(6)).toBe(true);
    const tasks = splitPaste("Parent\n  A\n  B\n  C\n  D\n  E");
    expect(needsConfirm(tasks.reduce((n, task) => n + 1 + task.children.length, 0))).toBe(true);
  });
});
