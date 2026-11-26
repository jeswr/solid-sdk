// AUTHORED-BY Codex GPT-6.1-Sol
import { RRule } from "rrule";
import { describe, expect, it } from "vitest";
import { fromEditorRule, toEditorRule } from "../../src/apps/tasks/lib/detail/recurrence-map";
import {
  NS,
  node,
  parse,
  SCHED,
  SCHEMA,
  Store,
  serialize,
} from "../../src/apps/tasks/lib/model/rdf";
import {
  expandRecurrence,
  humanise,
  nextOccurrence,
  type RecurrenceRule,
  readRecurrence,
  toRRule,
  validateRule,
  weekdays,
  writeRecurrence,
} from "../../src/apps/tasks/lib/model/recurrence";
import { parseQuickAdd } from "../../src/apps/tasks/lib/quickadd";

const start = new Date(2026, 0, 1, 9);
const floating = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

describe("monthly ordinal weekdays", () => {
  it.each([
    -1, 1, 2, 3, 4, 5,
  ])("matches ten rrule.js dates for ordinal %s across both London DST boundaries", (bySetPos) => {
    for (const [index, day] of weekdays.entries()) {
      const rule: RecurrenceRule = { frequency: "MONTHLY", byDay: [day], bySetPos };
      for (const interval of [1, 2, 13]) {
        const weekday = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU][
          index
        ] as typeof RRule.MO;
        const reference = new RRule({
          freq: RRule.MONTHLY,
          interval,
          dtstart: new Date("2026-01-01T09:00:00Z"),
          byweekday: weekday.nth(bySetPos),
        });
        const expected = reference
          .all((_, i) => i < 10)
          .map((date) => date.toISOString().slice(0, 19));
        const dates = expandRecurrence({ ...rule, interval }, start, 10);
        expect(dates.map(floating)).toEqual(expected);
        let after = new Date(start.getTime() - 1);
        for (const date of dates) {
          expect(nextOccurrence({ ...rule, interval }, after, start)).toEqual(date);
          after = date;
        }
      }
    }
  });

  it("skips missing local times and missing fifth weekdays without consuming count", () => {
    const rule: RecurrenceRule = {
      frequency: "MONTHLY",
      byDay: ["Sunday"],
      bySetPos: -1,
      count: 3,
    };
    expect(expandRecurrence(rule, new Date(2026, 1, 22, 1, 30), 10).map(floating)).toEqual([
      "2026-02-22T01:30:00",
      "2026-04-26T01:30:00",
      "2026-05-31T01:30:00",
    ]);
    expect(
      expandRecurrence(
        { frequency: "MONTHLY", byDay: ["Monday"], bySetPos: 5, count: 2 },
        start,
        10,
      ).map(floating),
    ).toEqual(["2026-03-30T09:00:00", "2026-06-29T09:00:00"]);
    expect(
      nextOccurrence(
        { ...rule, count: undefined, until: "2026-03-31" },
        new Date(2026, 1, 22, 1, 30),
      ),
    ).toBeUndefined();
    expect(
      nextOccurrence({ ...rule, count: undefined }, new Date(9999, 11, 31, 9)),
    ).toBeUndefined();
  });

  it("reads legacy ordinals and retains interval and end copy", async () => {
    const url = "https://pod.test/task.ttl";
    const dataset = await parse(
      url,
      `<#it> <https://w3id.org/jeswr/sectors/scheduling#recurrence> [ <https://w3id.org/jeswr/sectors/scheduling#frequency> "MONTHLY"; <https://schema.org/byDay> <https://schema.org/Friday>; <https://w3id.org/jeswr/sectors/scheduling#bySetPos> 3 ].`,
    );
    const rule = readRecurrence(node(`${url}#it`, dataset));
    expect(rule).toMatchObject({ frequency: "MONTHLY", byDay: ["Friday"], bySetPos: 3 });
    expect(
      humanise(
        { frequency: "MONTHLY", byDay: ["Tuesday"], bySetPos: 2, interval: 2, count: 4 },
        start,
      ),
    ).toBe("Every 2 months on the 2nd Tuesday (4 times)");
    expect(
      humanise(
        { frequency: "MONTHLY", byDay: ["Monday"], bySetPos: -1, until: "2027-01-01" },
        start,
      ),
    ).toBe("Every month on the last Monday until 1 Jan 2027");
  });

  it.each([
    [3, "Friday", "3FR", "3rd Friday"],
    [-1, "Monday", "-1MO", "last Monday"],
  ] as const)("round-trips ordinal %s through triples and editor", async (bySetPos, day, code, words) => {
    const task = node("https://pod.test/task.ttl#it", new Store());
    const rule: RecurrenceRule = { frequency: "MONTHLY", byDay: [day], bySetPos };
    writeRecurrence(task, rule);
    const value = [...task.nodes(`${SCHED}recurrence`)][0];
    if (!value) throw new Error("Missing rule node");
    expect([...value.nodes(`${SCHED}bySetPos`)][0]?.datatype.value).toBe(`${NS.XSD}integer`);
    expect([...value.iris(`${SCHEMA}byDay`)]).toEqual([`${SCHEMA}${day}`]);
    expect(
      readRecurrence(node(task.value, await parse(task.value, await serialize(task.dataset)))),
    ).toMatchObject(rule);
    expect(fromEditorRule(toEditorRule(rule), start)).toEqual({ ...rule, interval: 1 });
    expect(toRRule(rule)).toBe(`FREQ=MONTHLY;INTERVAL=1;BYDAY=${code}`);
    expect(humanise(rule, start)).toBe(`Every month on the ${words}`);
    writeRecurrence(task, { frequency: "DAILY" });
    expect(value?.number(`${SCHED}bySetPos`)).toBeUndefined();
    writeRecurrence(task, undefined);
    expect(task.dataset.size).toBe(0);
  });

  it.each([
    { frequency: "MONTHLY", byDay: ["Monday"] },
    { frequency: "MONTHLY", bySetPos: 3 },
    { frequency: "WEEKLY", byDay: ["Monday"], bySetPos: 3 },
    ...[0, 6, -2, 1.5].map((bySetPos) => ({ frequency: "MONTHLY", byDay: ["Monday"], bySetPos })),
    { frequency: "MONTHLY", byDay: ["Monday", "Friday"], bySetPos: 3 },
    { frequency: "MONTHLY", byDay: ["Friday"], bySetPos: 3, byMonthDay: 15 },
  ])("rejects ambiguous or invalid rules %j", (rule) =>
    expect(() => validateRule(rule as RecurrenceRule)).toThrow());

  it.each([
    ["every 3rd friday", 3, "Friday", "2026-11-20"],
    ["every last monday", -1, "Monday", "2026-11-30"],
    ["every 2nd Tue", 2, "Tuesday", "2026-12-08"],
    ["every 5th monday", 5, "Monday", "2026-11-30"],
  ] as const)("parses %s before chrono", (phrase, bySetPos, day, due) => {
    const parsed = parseQuickAdd(`Review ${phrase}`, {
      now: new Date("2026-11-11T12:00:00Z"),
      tz: "Europe/London",
    });
    expect(parsed.title).toBe("Review");
    expect(parsed.recurrence).toEqual({ freq: "MONTHLY", interval: 1, byDay: [day], bySetPos });
    expect(parsed.due).toEqual({ kind: "date", date: due });
  });
});
