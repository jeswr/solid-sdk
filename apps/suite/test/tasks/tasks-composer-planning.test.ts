// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { applyControls, rebaseKeepText } from "../../src/apps/tasks/lib/compose/draft";
import {
  composeContext,
  missingLabels,
  planPaste,
  taskSubmission,
} from "../../src/apps/tasks/lib/compose/planning";
import {
  type ChipId,
  type ComposeContext,
  parseQuickAdd,
} from "../../src/apps/tasks/lib/compose/quick-add";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";

const now = new Date("2026-11-01T12:00Z");
function project(name = "Home"): StoredProject {
  const url = `https://pod.test/${name}.ttl`;
  return { url, ...createTracker(url, name, `https://pod.test/${name}/`, [], now), etag: '"1"' };
}
const home = project();
const section = home.tracker.defineCategory("Section", "Doing");
const bills = home.tracker.defineCategory("Label", "bills");
const defaults = { projectUrl: home.url, sectionId: section.id, sectionName: section.name };
const ctx: ComposeContext = {
  now,
  tz: "Europe/London",
  projects: [
    { url: home.url, title: "Home" },
    { url: "work", title: "Work" },
  ],
  labels: ["bills"],
  defaults,
};
const parse = (text: string) => parseQuickAdd(text, ctx);

describe("composer context and submission plans", () => {
  it("builds an active-project context and unions label names", () => {
    const work = project("Work");
    work.tracker.defineCategory("Label", "BILLS");
    work.tracker.defineCategory("Label", "shopping");
    const archived = project("Archived");
    archived.tracker.archivedAt = now;
    archived.tracker.defineCategory("Label", "hidden");
    const unnamed = project("Unnamed");
    unnamed.tracker.title = undefined;
    const result = composeContext([home, work, archived, unnamed], defaults, now, "Europe/London");
    expect(result.projects).toEqual([
      { url: home.url, title: "Home" },
      { url: work.url, title: "Work" },
      { url: unnamed.url, title: "" },
    ]);
    expect(result.labels).toEqual(["bills", "shopping"]);
    expect(result.defaults).toEqual(defaults);
    expect(result.now).toBe(now);
    expect(composeContext([], undefined, now, "UTC").defaults).toBeUndefined();
  });
  it("plans case-insensitive tracker-local labels and maps all task fields", () => {
    expect(missingLabels(home, ["BILLS", "new", "NEW", "garden"])).toEqual(["new", "garden"]);
    const parsed = parse("Pay rent tomorrow 5pm @bills p2 every month !1h before");
    expect(taskSubmission(parsed, home, "https://pod.test/parent#it")).toEqual({
      title: "Pay rent",
      due: new Date("2026-11-02T17:00Z"),
      allDay: undefined,
      priority: "medium",
      recurrence: { frequency: "MONTHLY", interval: 1 },
      reminders: [{ offset: "-PT1H" }],
      sectionId: section.id,
      labelIds: [bills.id],
      parent: "https://pod.test/parent#it",
    });
    expect(taskSubmission(parse("Task tomorrow"), home).allDay).toBe("2026-11-02");
    expect(taskSubmission(parse("Task #Work"), home)).toMatchObject({
      title: "Task",
      due: undefined,
      priority: undefined,
      sectionId: undefined,
    });
    expect(() => taskSubmission(parse("Task @unknown"), home)).toThrow(
      "Label @unknown has not been saved",
    );
    expect(taskSubmission(parse("Task @BILLS"), home).labelIds).toEqual([bills.id]);
  });
  it("orders parents before children and parses every pasted line with the same defaults", () => {
    const entries = planPaste("Parent tomorrow\n  Child p1\n\tSecond child @bills\nNext", ctx);
    expect(entries.map((entry) => [entry.result.title, entry.parentIndex])).toEqual([
      ["Parent", undefined],
      ["Child", 0],
      ["Second child", 0],
      ["Next", undefined],
    ]);
    expect(entries.every((entry) => entry.result.sectionId === section.id)).toBe(true);
    expect(entries[0]?.result.due?.allDay).toBe("2026-11-02");
    expect(entries[1]?.result.priority).toBe(1);
    expect(planPaste("\n", ctx)).toEqual([]);
  });
});

describe("composer controls", () => {
  it("leaves parser output intact without overrides", () => {
    const parsed = parse("Task tomorrow @bills !1h before p1");
    expect(applyControls(parsed, {}, ctx)).toEqual(parsed);
  });
  it("overrides due, priority, project, labels and reminders without losing title spans", () => {
    const parsed = parse("Task tomorrow #Home @bills p1 !1h before");
    const due = { date: new Date("2026-11-01T17:00Z") };
    const result = applyControls(
      parsed,
      {
        due,
        priority: 3,
        projectUrl: "work",
        labels: ["shopping"],
        reminders: [{ offset: "PT0S" }],
      },
      ctx,
    );
    expect(result).toMatchObject({
      title: "Task",
      due,
      priority: 3,
      project: { kind: "existing", url: "work" },
      labels: [{ name: "shopping", existing: false }],
      reminders: [{ offset: "PT0S" }],
    });
    expect(result.sectionId).toBeUndefined();
    expect(result.chips.map((chip) => chip.label)).toEqual([
      "Due Today 17:00",
      "P3",
      "#Work",
      "@shopping",
      "Remind at due time",
    ]);
    expect(result.chips.find((chip) => chip.kind === "due")?.span).toEqual(
      parsed.chips.find((chip) => chip.kind === "due")?.span,
    );
    expect(parsed.sectionId).toBe(section.id);
    expect(parsed.chips).toHaveLength(6);
  });
  it("makes manual chips, retains the default section, and supports all reminder controls", () => {
    const noDefaults = { now: ctx.now, tz: ctx.tz, projects: ctx.projects, labels: ctx.labels };
    const due = { date: new Date("2026-11-02T00:00Z"), allDay: "2026-11-02" };
    const result = applyControls(
      parse("Task"),
      {
        due,
        priority: 4,
        projectUrl: home.url,
        labels: ["bills", "new"],
        reminders: [{ offset: "-PT1H" }, { offset: "-P1D" }, { time: now }],
      },
      ctx,
    );
    expect(
      applyControls(parse("Task"), { projectUrl: "missing" }, noDefaults).chips.at(-1)?.label,
    ).toBe("#Project");
    expect(result.sectionId).toBe(section.id);
    expect(result.labels[0]?.existing).toBe(true);
    expect(result.chips.find((chip) => chip.kind === "due")).toMatchObject({
      id: "due:-1",
      label: "Due Tomorrow",
      span: { start: 0, end: 0 },
    });
    expect(
      result.chips.filter((chip) => chip.kind === "reminder").map((chip) => chip.label),
    ).toEqual(["Remind 1 hour before", "Remind 1 day before", `Remind ${now.toLocaleString()}`]);
  });
  it("restores the default section when its project is picked again, respecting removal", () => {
    expect(applyControls(parse("Task #Work"), { projectUrl: home.url }, ctx).sectionId).toBe(
      section.id,
    );
    const unnamed = { ...ctx, defaults: { projectUrl: home.url, sectionId: section.id } };
    expect(
      applyControls(parse("Task #Work"), { projectUrl: home.url }, unnamed).chips.some(
        (chip) => chip.label === "Section",
      ),
    ).toBe(true);
    const removed = { ...ctx, keepText: new Set<ChipId>(["section:0"]) };
    expect(
      applyControls(parseQuickAdd("Task", removed), { projectUrl: home.url }, removed).sectionId,
    ).toBeUndefined();
    expect(
      applyControls(
        parseQuickAdd("Task", { ...ctx, defaults: { projectUrl: home.url } }),
        { projectUrl: home.url },
        { ...ctx, defaults: { projectUrl: home.url } },
      ).sectionId,
    ).toBeUndefined();
  });
  it("activates parsed reminders when a manual due is supplied, keeping removed dates literal", () => {
    const due = { date: new Date("2026-11-02T00:00Z"), allDay: "2026-11-02" };
    const text = "Task !1h before";
    const result = applyControls(parse(text), { due }, ctx, text);
    expect(result.reminders).toEqual([{ offset: "-PT1H" }]);
    expect(result.chips.find((chip) => chip.kind === "reminder")?.invalid).toBe(false);
    const keptCtx = { ...ctx, keepText: new Set<ChipId>(["due:5"]) };
    const keptText = "Task tomorrow !1h before";
    const keptResult = applyControls(parseQuickAdd(keptText, keptCtx), { due }, keptCtx, keptText);
    expect(keptResult.title).toBe("Task tomorrow");
    expect(keptResult.reminders).toEqual([{ offset: "-PT1H" }]);
    expect(applyControls(parse("Task"), { due }, ctx).reminders).toEqual([]);
  });
  it("clears due and disables reminder values but marks their chips invalid", () => {
    const result = applyControls(parse("Task tomorrow !1h before"), { due: null }, ctx);
    expect(result.due).toBeUndefined();
    expect(result.reminders).toEqual([]);
    expect(result.chips.find((chip) => chip.kind === "reminder")?.invalid).toBe(true);
    expect(result.chips.some((chip) => chip.kind === "due")).toBe(false);
    expect(applyControls(parse("Task"), { reminders: [] }, ctx).reminders).toEqual([]);
  });
});

describe("literal chip suppression while editing", () => {
  const keep = (id: ChipId) => new Set([id]);
  it("keeps unaffected tokens across edits before or after them", () => {
    expect(rebaseKeepText("Task tomorrow", "Task tomorrow!", keep("due:5"), ctx)).toEqual(
      keep("due:5"),
    );
    expect(rebaseKeepText("Task tomorrow", "My Task tomorrow", keep("due:5"), ctx)).toEqual(
      keep("due:8"),
    );
    expect(rebaseKeepText("Task tomorrow", "Task today", keep("due:5"), ctx)).toEqual(new Set());
    expect(rebaseKeepText("Task tomorrow", "Task tomorrow", keep("due:5"), ctx)).toEqual(
      keep("due:5"),
    );
  });
  it("retains suppressed defaults and tolerates absent or manual chips", () => {
    expect(rebaseKeepText("Task", "New Task", keep("section:0"), ctx)).toEqual(keep("section:0"));
    expect(rebaseKeepText("Task", "Task!", keep("due:-1"), ctx)).toEqual(keep("due:-1"));
    expect(rebaseKeepText("", "x", new Set(), ctx)).toEqual(new Set());
  });
});
