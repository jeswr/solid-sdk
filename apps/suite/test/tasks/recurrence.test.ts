// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { NS, node, parse, SCHEMA, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
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

import rruleFixtures from "./rrule-fixtures.json";

const due = new Date(2026, 9, 26, 9);
const isoDates = (dates: Date[]) =>
  dates.map(
    (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  );

describe("recurrence expansion", () => {
  it("constructs monthly target dates without normalizing an intermediate DST gap", () => {
    const previousZone = process.env.TZ;
    try {
      process.env.TZ = "Australia/Sydney";
      for (const month of [8, 9]) {
        const start = new Date(2028, month, 15, 2, 30);
        const rule: RecurrenceRule = { frequency: "MONTHLY", count: 3 };
        const expected = [0, 1, 2].map((offset) => new Date(2028, month + offset, 15, 2, 30));
        expect(expandRecurrence(rule, start, 10)).toEqual(expected);
        expect(nextOccurrence(rule, start)).toEqual(expected[1]);
      }
      const start = new Date(2028, 8, 1, 2, 30);
      expect(expandRecurrence({ frequency: "MONTHLY", count: 2 }, start, 10)).toEqual([
        start,
        new Date(2028, 10, 1, 2, 30),
      ]);
    } finally {
      process.env.TZ = previousZone;
    }
  });
  // Independent expected dates generated with rrule.js 2.8.1 (temporary tool, no app dependency).
  it.each(
    rruleFixtures,
  )("matches ten rrule.js occurrences: $rule.frequency $rule.interval $due", (fixture) => {
    const dates = expandRecurrence(fixture.rule as RecurrenceRule, new Date(fixture.due), 10);
    const localDates = dates.map(
      (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`,
    );
    expect(localDates).toEqual(fixture.expected);
  });
  it("uses Monday-based interval weeks, deduplicates and orders byDay", () => {
    expect(
      isoDates(
        expandRecurrence(
          { frequency: "WEEKLY", interval: 2, byDay: ["Wednesday", "Monday", "Wednesday"] },
          new Date(2026, 9, 28, 9),
          5,
        ),
      ),
    ).toEqual(["2026-10-28", "2026-11-09", "2026-11-11", "2026-11-23", "2026-11-25"]);
    expect(
      isoDates(
        expandRecurrence(
          { frequency: "WEEKLY", byDay: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
          new Date(2026, 9, 30, 9),
          4,
        ),
      ),
    ).toEqual(["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]);
  });
  it("skips nonexistent month days and leap days without date drift", () => {
    expect(
      isoDates(
        expandRecurrence({ frequency: "MONTHLY", byMonthDay: 31 }, new Date(2026, 0, 31, 9), 5),
      ),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31"]);
    expect(
      isoDates(expandRecurrence({ frequency: "YEARLY" }, new Date(2024, 1, 29, 9), 3)),
    ).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
    expect(isoDates(expandRecurrence({ frequency: "MONTHLY", byMonthDay: 15 }, due, 3))).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
    ]);
  });
  it("handles inclusive until, exclusive after, count exhaustion and bounded calendar range", () => {
    const rule: RecurrenceRule = { frequency: "DAILY", count: 2 };
    expect(nextOccurrence(rule, due)).toEqual(new Date(2026, 9, 27, 9));
    expect(nextOccurrence(rule, new Date(2026, 9, 28, 9), due)).toBeUndefined();
    expect(expandRecurrence({ frequency: "DAILY", until: new Date(due) }, due, 10)).toEqual([due]);
    expect(expandRecurrence({ frequency: "DAILY", until: "2026-10-27" }, due, 10)).toHaveLength(2);
    expect(
      nextOccurrence({ frequency: "WEEKLY", until: new Date(2026, 9, 20) }, due),
    ).toBeUndefined();
    expect(nextOccurrence({ frequency: "DAILY" }, new Date(9999, 11, 31))).toBeUndefined();
    expect(
      nextOccurrence({ frequency: "DAILY", interval: Number.MAX_SAFE_INTEGER }, due),
    ).toBeUndefined();
    expect(
      nextOccurrence({ frequency: "MONTHLY", interval: Number.MAX_SAFE_INTEGER }, due),
    ).toBeUndefined();
  });
  it.each([
    "DAILY",
    "WEEKLY",
  ] as const)("retains wall-clock time across both London DST boundaries for %s", (frequency) => {
    for (const start of [new Date(2026, 2, 28, 9), new Date(2026, 9, 24, 9)]) {
      const next = nextOccurrence({ frequency }, start) as Date;
      expect(next.getHours()).toBe(9);
      expect(next.getTimezoneOffset()).not.toBe(start.getTimezoneOffset());
      expect(next.getTime() - start.getTime()).not.toBe((frequency === "DAILY" ? 1 : 7) * 86400000);
    }
  });
  it("bounds generated weekly dates, including partially supported weeks", () => {
    const last = new Date(9999, 11, 31, 9);
    const rule: RecurrenceRule = { frequency: "WEEKLY", byDay: ["Friday", "Sunday"] };
    expect(expandRecurrence(rule, last, 10)).toEqual([last]);
    expect(nextOccurrence(rule, last)).toBeUndefined();
    expect(expandRecurrence({ frequency: "WEEKLY" }, last, 10)).toEqual([last]);
    expect(nextOccurrence({ frequency: "WEEKLY" }, last)).toBeUndefined();
    const overflow: RecurrenceRule = { frequency: "WEEKLY", interval: Number.MAX_SAFE_INTEGER };
    expect(expandRecurrence(overflow, due, 10)).toEqual([due]);
    expect(nextOccurrence(overflow, due)).toBeUndefined();
    expect(
      expandRecurrence(
        { frequency: "WEEKLY", byDay: ["Monday", "Friday"], until: "2026-10-29" },
        due,
        10,
      ),
    ).toEqual([due]);
  });
  it.each([
    ["DAILY", new Date(2026, 2, 28, 1, 30), new Date(2026, 2, 30, 1, 30)],
    ["WEEKLY", new Date(2026, 2, 22, 1, 30), new Date(2026, 3, 5, 1, 30)],
    ["MONTHLY", new Date(2026, 0, 29, 1, 30), new Date(2026, 3, 29, 1, 30)],
    ["YEARLY", new Date(2025, 2, 29, 1, 30), new Date(2027, 2, 29, 1, 30)],
  ] as const)("skips nonexistent local times for %s without consuming count", (frequency, start, next) => {
    expect(expandRecurrence({ frequency, count: 2 }, start, 10)).toEqual([start, next]);
    expect(nextOccurrence({ frequency }, start)).toEqual(next);
  });
});
describe("recurrence RDF and validation", () => {
  it("reads the §5.4 blank-node shape and writes one structured rule", async () => {
    const url = "https://pod.test/task.ttl";
    const dataset = await parse(
      url,
      `@prefix sched: <${NS.SCHEDULING}>. @prefix schema: <${SCHEMA}>. @prefix xsd: <${NS.XSD}>. <#it> sched:recurrence [a sched:RecurrenceRule; sched:frequency "WEEKLY"; sched:interval 2; schema:byDay schema:Monday, schema:Wednesday; sched:count 10].`,
    );
    const task = node(`${url}#it`, dataset);
    expect(readRecurrence(task)).toMatchObject({
      frequency: "WEEKLY",
      interval: 2,
      byDay: ["Monday", "Wednesday"],
      count: 10,
    });
    const rule: RecurrenceRule = { frequency: "MONTHLY", byMonthDay: 15, until: "2027-01-01" };
    writeRecurrence(task, rule);
    expect(readRecurrence(task)).toMatchObject(rule);
    const copy = await parse(url, await serialize(dataset));
    expect(readRecurrence(node(task.value, copy))).toMatchObject(rule);
    writeRecurrence(task, { frequency: "DAILY", until: due });
    expect(readRecurrence(task)?.until).toEqual(due);
    writeRecurrence(task, { frequency: "WEEKLY", byDay: ["Friday"] });
    expect(readRecurrence(task)?.byDay).toEqual(["Friday"]);
    writeRecurrence(task, undefined);
    expect(readRecurrence(task)).toBeUndefined();
    expect(dataset.size).toBe(0);
  });
  it("accepts legacy scheduling and HTTPS schema only on reads", async () => {
    const url = "https://pod.test/task.ttl";
    const dataset = await parse(
      url,
      `@prefix sched: <https://w3id.org/jeswr/sectors/scheduling#>. @prefix schema: <${NS.SCHEMA}>. <#it> sched:recurrence [sched:frequency "WEEKLY"; schema:byDay schema:Friday].`,
    );
    const task = node(`${url}#it`, dataset);
    const rule = readRecurrence(task);
    expect(rule?.byDay).toEqual(["Friday"]);
    writeRecurrence(task, rule);
    expect(await serialize(dataset)).not.toContain("w3id.org");
    expect(readRecurrence(task)?.byDay).toEqual(["Friday"]);
  });
  it("rejects invalid rules and invalid expansion arguments", () => {
    const invalid = [
      { frequency: "HOURLY" },
      { frequency: "DAILY", interval: 0 },
      { frequency: "DAILY", count: 1.5 },
      { frequency: "DAILY", count: 2, until: due },
      { frequency: "DAILY", byDay: ["Monday"] },
      { frequency: "WEEKLY", byDay: [] },
      { frequency: "WEEKLY", byDay: ["Foo"] },
      { frequency: "DAILY", byMonthDay: 2 },
      { frequency: "MONTHLY", byMonthDay: 0 },
      { frequency: "MONTHLY", byMonthDay: 32 },
      { frequency: "MONTHLY", byMonthDay: 1.5 },
      { frequency: "DAILY", until: new Date("bad") },
      { frequency: "DAILY", until: "2026-02-30" },
      { frequency: "DAILY", until: "oops" },
    ];
    for (const rule of invalid) expect(() => validateRule(rule as RecurrenceRule)).toThrow();
    expect(() => nextOccurrence({ frequency: "DAILY" }, new Date("bad"))).toThrow();
    for (const limit of [0, 1.5, -1])
      expect(() => expandRecurrence({ frequency: "DAILY" }, due, limit)).toThrow("limit");
    const task = node("https://pod.test/task#it", new Store());
    expect(() => writeRecurrence(task, invalid[0] as RecurrenceRule)).toThrow();
    const empty = task.child();
    task.nodes(`${NS.SCHEDULING}recurrence`).add(empty);
    expect(() => readRecurrence(task)).toThrow();
  });
});
describe("recurrence export and copy", () => {
  it("exports RRULE fields without storing RRULE strings", () => {
    expect(toRRule({ frequency: "DAILY" })).toBe("FREQ=DAILY;INTERVAL=1");
    expect(
      toRRule({ frequency: "WEEKLY", interval: 2, byDay: ["Monday", "Wednesday"], count: 10 }),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
    expect(toRRule({ frequency: "MONTHLY", byMonthDay: 15, until: "2027-01-01" })).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15;UNTIL=20270101",
    );
    expect(toRRule({ frequency: "YEARLY", until: new Date("2027-01-01T12:30:00Z") })).toBe(
      "FREQ=YEARLY;INTERVAL=1;UNTIL=20270101T123000Z",
    );
  });
  it("humanises the §7 copy and ordinal suffixes", () => {
    expect(humanise({ frequency: "DAILY" }, due)).toBe("Every day");
    expect(humanise({ frequency: "WEEKLY", byDay: weekdays.slice(0, 5) }, due)).toBe(
      "Every weekday",
    );
    expect(humanise({ frequency: "WEEKLY", byDay: ["Monday", "Wednesday"] }, due)).toBe(
      "Every week on Mon, Wed",
    );
    expect(humanise({ frequency: "WEEKLY", interval: 2, byDay: ["Friday"] }, due)).toBe(
      "Every 2 weeks on Fri",
    );
    expect(humanise({ frequency: "WEEKLY" }, due)).toBe("Every week");
    expect(humanise({ frequency: "MONTHLY" }, due)).toBe("Every month on the 26th");
    for (const [day, suffix] of [
      [1, "1st"],
      [2, "2nd"],
      [3, "3rd"],
      [11, "11th"],
      [12, "12th"],
      [13, "13th"],
      [15, "15th"],
    ] as const)
      expect(humanise({ frequency: "MONTHLY", byMonthDay: day }, due)).toBe(
        `Every month on the ${suffix}`,
      );
    expect(humanise({ frequency: "YEARLY" }, new Date(2026, 10, 3))).toBe("Every year on 3 Nov");
    expect(humanise({ frequency: "DAILY", count: 10 }, due)).toBe("Every day (10 times)");
    expect(humanise({ frequency: "DAILY", until: "2027-01-01" }, due)).toBe(
      "Every day until 2027-01-01",
    );
    expect(humanise({ frequency: "DAILY", until: new Date(2027, 0, 1) }, due)).toBe(
      "Every day until 1 Jan 2027",
    );
  });
});

it.each([
  "<#rule>",
  "_:rule",
])("preserves foreign recurrence metadata when editing a linked node: %s", async (id) => {
  const url = "https://pod.test/task.ttl";
  const dataset = await parse(
    url,
    `
    <#it> <${NS.SCHEDULING}recurrence> ${id}.
    ${id} a <${NS.SCHEDULING}RecurrenceRule>, <https://example.test/Annotated>;
      <${NS.SCHEDULING}frequency> "WEEKLY"; <${SCHEMA}byDay> <${SCHEMA}Monday>;
      <${NS.DCT}description> "Keep this annotation".
  `,
  );
  const task = node(`${url}#it`, dataset);
  const original = [...task.nodes(`${NS.SCHEDULING}recurrence`)][0];
  writeRecurrence(task, { frequency: "DAILY" });
  expect([...task.nodes(`${NS.SCHEDULING}recurrence`)][0]?.value).toBe(original?.value);
  expect(readRecurrence(task)?.frequency).toBe("DAILY");
  expect(readRecurrence(task)?.byDay).toBeUndefined();
  expect(original?.text(`${NS.DCT}description`)).toBe("Keep this annotation");
  expect(original?.types.has("https://example.test/Annotated")).toBe(true);
  writeRecurrence(task, undefined);
  expect(original?.text(`${NS.DCT}description`)).toBe("Keep this annotation");
  expect(original?.text(`${NS.SCHEDULING}frequency`)).toBeUndefined();
});

it("copies shared recurrence nodes on edit and preserves them on unlink", async () => {
  const url = "https://pod.test/task.ttl";
  const dataset = await parse(
    url,
    `
    <#it> <${NS.SCHEDULING}recurrence> <#rule>.
    <#other> <${NS.SCHEDULING}recurrence> <#rule>.
    <#rule> a <${NS.SCHEDULING}RecurrenceRule>;
      <${NS.SCHEDULING}frequency> "WEEKLY"; <${SCHEMA}byDay> <${SCHEMA}Monday>;
      <${NS.DCT}description> "Shared rule".
  `,
  );
  const task = node(`${url}#it`, dataset);
  const other = node(`${url}#other`, dataset);
  writeRecurrence(task, { frequency: "DAILY" });
  expect(readRecurrence(other)?.frequency).toBe("WEEKLY");
  expect(readRecurrence(other)?.byDay).toEqual(["Monday"]);
  expect(readRecurrence(task)?.frequency).toBe("DAILY");
  expect(readRecurrence(task)?.byDay).toBeUndefined();
  expect([...task.nodes(`${NS.SCHEDULING}recurrence`)][0]?.text(`${NS.DCT}description`)).toBe(
    "Shared rule",
  );
  task.nodes(`${NS.SCHEDULING}recurrence`).add(node(`${url}#rule`, dataset));
  writeRecurrence(task, undefined);
  expect(readRecurrence(other)?.frequency).toBe("WEEKLY");
});
