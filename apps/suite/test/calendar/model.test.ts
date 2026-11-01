// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  asDate,
  buildCalendar,
  buildEvent,
  CalendarDoc,
  type CalendarEvent,
  computeFireTimes,
  dayKey,
  deserializeDataset,
  durationMilliseconds,
  EventDoc,
  expandEvent,
  fromWallClock,
  groupByDay,
  groupByMonth,
  ModelNode,
  monthKey,
  monthMatrix,
  monthsInRange,
  NS,
  parseCalendar,
  parseEvent,
  type RecurrenceRule,
  readReminder,
  readRule,
  selectMonthListings,
  serializeDataset,
  sortByStart,
  toRRule,
  validateCalendar,
  validateEvent,
  validateReminder,
  validateRule,
  wallClock,
  writeReminder,
  writeRule,
} from "../../src/apps/calendar/lib/model";

const url = "https://pod.example/calendar/work/event.ttl";
const date = (v: string) => new Date(v);
const event: CalendarEvent = {
  name: "Meeting",
  start: date("2026-03-02T09:00:00Z"),
  end: date("2026-03-02T10:00:00Z"),
  location: "Home",
  description: "Notes",
  uid: "unique",
  inCalendar: "https://pod.example/calendar/work.ttl#it",
  recurrence: {
    frequency: "WEEKLY",
    interval: 2,
    count: 7,
    byDay: ["MO", "WE"],
    byMonth: [3, 4],
    byMonthDay: [2, 4],
    exceptDate: [date("2026-03-04T09:00:00Z"), "2026-03-16"],
  },
  reminders: [{ triggerOffset: "-PT1H" }, { triggerTime: date("2026-03-02T07:00:00Z") }],
};
const item = (data: CalendarEvent) => ({ url, etag: '"v1"', data });

describe("typed RDF model", () => {
  it("round-trips event, recurrence and both reminder kinds through Turtle", async () => {
    const ds = buildEvent(url, event);
    const parsed = parseEvent(url, await deserializeDataset(await serializeDataset(ds), url));
    expect(parsed).toEqual(event);
    const types = new EventDoc(`${url}#it`, ds, DataFactory).types;
    expect([...types]).toEqual([`${NS.SCHEDULING}CalendarEvent`, `${NS.SCHEMA}Event`]);
    expect(
      parseEvent(
        url,
        buildEvent(url, {
          name: "All day",
          start: "2026-03-01",
          end: "2026-03-03",
          recurrence: { frequency: "DAILY", until: "2026-03-07" },
        }),
      ),
    ).toMatchObject({
      start: "2026-03-01",
      end: "2026-03-03",
      recurrence: { until: "2026-03-07" },
    });
    expect(
      [...ds].find((q) => q.predicate.value === `${NS.SCHEDULING}interval`)?.object,
    ).toMatchObject({ datatype: { value: `${NS.XSD}positiveInteger` } });
  });
  it("round-trips calendar documents and clears optional typed values", async () => {
    const ds = buildCalendar(url, { title: "Work", color: "calendar" });
    expect(parseCalendar(url, await deserializeDataset(await serializeDataset(ds), url))).toEqual({
      title: "Work",
      color: "calendar",
    });
    const doc = new CalendarDoc(`${url}#it`, ds, DataFactory);
    doc.color = undefined;
    expect(doc.color).toBeUndefined();
    doc.title = undefined;
    expect(() => parseCalendar(url, ds)).toThrow("title");
    const events = buildEvent(url, { name: "E", start: date("2026-03-01Z") });
    const e = new EventDoc(`${url}#it`, events, DataFactory);
    e.start = undefined;
    e.end = undefined;
    e.inCalendar = undefined;
    expect(parseEvent(url, events)).toBeUndefined();
    expect(parseEvent(url, new Store())).toBeUndefined();
    expect(parseCalendar(url, new Store())).toBeUndefined();
  });
  it("reads legacy schema and scheduling predicates without changing identifiers or text", async () => {
    const legacy = await deserializeDataset(
      `@prefix sc: <http://schema.org/>. @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#>. @prefix xsd: <${NS.XSD}>. <#it> a sc:Event; sc:name "http://schema.org/Keep"; sc:startDate "2026-03-01T09:00:00Z"^^xsd:dateTime; sched:recurrence [ sched:frequency "WEEKLY"; sc:byDay sc:Monday ].`,
      url,
    );
    expect(parseEvent(url, legacy)).toMatchObject({
      name: "http://schema.org/Keep",
      recurrence: { frequency: "WEEKLY", byDay: ["MO"] },
    });
    const sector = await deserializeDataset(
      `@prefix sched: <${NS.SCHEDULING}>. @prefix sc:<${NS.SCHEMA}>. @prefix xsd:<${NS.XSD}>. <#it> a sched:CalendarEvent; sc:name "E"; sched:startTime "2026-03-01"^^xsd:date; sched:endTime "2026-03-02"^^xsd:date.`,
      url,
    );
    expect(parseEvent(url, sector)).toMatchObject({ start: "2026-03-01", end: "2026-03-02" });
    const malformed = await deserializeDataset(
      `@prefix sched:<${NS.SCHEDULING}>. @prefix sc:<${NS.SCHEMA}>. <#rule> sched:frequency "WEEKLY"; sc:byDay sc:NotADay.`,
      url,
    );
    expect(() => readRule(new ModelNode(`${url}#rule`, malformed, DataFactory))).toThrow("weekday");
    const untitled = await deserializeDataset(
      `<#it> a <${NS.SCHEMA}Event>; <${NS.SCHEMA}startDate> "2026-03-01"^^<${NS.XSD}date>.`,
      url,
    );
    expect(() => parseEvent(url, untitled)).toThrow("title");
  });
  it("writes both title predicates and accepts scheduling-only summaries", async () => {
    const ds = buildEvent(url, { name: "Title", start: "2026-03-01" });
    const doc = new EventDoc(`${url}#it`, ds, DataFactory);
    expect(doc.text(`${NS.SCHEMA}name`)).toBe("Title");
    expect(doc.text(`${NS.SCHEDULING}summary`)).toBe("Title");
    for (const sched of [NS.SCHEDULING, "https://w3id.org/jeswr/sectors/scheduling#"]) {
      const ds = await deserializeDataset(
        `<#it> a <${sched}CalendarEvent>; <${sched}summary> "Scheduling"; <${sched}startTime> "2026-03-01"^^<${NS.XSD}date>.`,
        url,
      );
      expect(parseEvent(url, ds)).toMatchObject({ name: "Scheduling", start: "2026-03-01" });
      const doc = new EventDoc(`${url}#it`, ds, DataFactory);
      doc.name = "Changed";
      expect(doc.text(`${NS.SCHEDULING}summary`)).toBe("Changed");
      doc.name = undefined;
      expect(doc.name).toBeUndefined();
    }
  });
  it("replaces and clears supported legacy scalar and recurrence aliases", async () => {
    const ds = await deserializeDataset(
      `@prefix sc: <http://schema.org/>. @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#>. @prefix xsd: <${NS.XSD}>.
      <#it> a sc:Event; sc:name "Old"; sc:startDate "2026-03-01"^^xsd:date; sc:endDate "2026-03-02"^^xsd:date; sched:endTime "2026-03-02"^^xsd:date; sched:inCalendar <https://pod.example/old>; sched:recurrence <#rule>.
      <#rule> sched:frequency "WEEKLY"; sched:interval 2; sched:count 3; sched:until "2026-03-10"^^xsd:date; sc:byDay sc:Monday; sc:byMonth 3; sc:byMonthDay 2; sc:exceptDate "2026-03-02"^^xsd:date.
      <#reminder> sched:triggerOffset "-PT1H"^^xsd:duration; sched:triggerTime "2026-03-01T08:00:00Z"^^xsd:dateTime.`,
      url,
    );
    const doc = new EventDoc(`${url}#it`, ds, DataFactory);
    doc.end = undefined;
    expect(doc.end).toBeUndefined();
    doc.start = "2026-03-04";
    doc.name = "New";
    doc.inCalendar = "https://pod.example/new";
    expect(doc.start).toBe("2026-03-04");
    expect(doc.name).toBe("New");
    expect(doc.inCalendar).toBe("https://pod.example/new");
    doc.inCalendar = undefined;
    expect(doc.inCalendar).toBeUndefined();
    const rule = doc.nodes(`${NS.SCHEDULING}recurrence`)[0] as ModelNode;
    writeRule(rule, { frequency: "DAILY" });
    expect(readRule(rule)).toEqual({
      frequency: "DAILY",
      interval: undefined,
      count: undefined,
      until: undefined,
      byDay: [],
      byMonth: [],
      byMonthDay: [],
      exceptDate: [],
    });
    writeRule(rule, {
      frequency: "MONTHLY",
      interval: 1,
      byDay: ["TU"],
      byMonth: [4],
      byMonthDay: [7],
      exceptDate: ["2026-04-07"],
    });
    expect(readRule(rule)).toMatchObject({
      frequency: "MONTHLY",
      interval: 1,
      byDay: ["TU"],
      byMonth: [4],
      byMonthDay: [7],
      exceptDate: ["2026-04-07"],
    });
    const reminder = new ModelNode(`${url}#reminder`, ds, DataFactory);
    writeReminder(reminder, { triggerOffset: "-PT2H" });
    expect(readReminder(reminder)).toEqual({ triggerOffset: "-PT2H", triggerTime: undefined });
    writeReminder(reminder, { triggerTime: date("2026-03-01T07:00Z") });
    expect(readReminder(reminder)).toEqual({
      triggerOffset: undefined,
      triggerTime: date("2026-03-01T07:00Z"),
    });
    expect(
      [...ds].some(
        (q) =>
          q.predicate.value.startsWith("http://schema.org/") ||
          (q.predicate.value.startsWith("https://w3id.org/jeswr/sectors/scheduling#") &&
            q.subject.value.endsWith("#rule")),
      ),
    ).toBe(false);
  });
  it("replaces rule sets and rejects malformed RDF datatypes", async () => {
    const ds = new Store();
    const node = new ModelNode(`${url}#rule`, ds, DataFactory);
    writeRule(node, event.recurrence as RecurrenceRule);
    writeRule(node, { frequency: "DAILY" });
    expect(readRule(node)).toMatchObject({
      byDay: [],
      byMonth: [],
      byMonthDay: [],
      exceptDate: [],
    });
    const foreign = await deserializeDataset(
      `<#it> a <${NS.SCHEMA}Event>; <${NS.SCHEMA}startDate> "bogus".`,
      url,
    );
    expect(() => parseEvent(url, foreign)).toThrow();
    node.setNumber(`${NS.SCHEDULING}count`, 3);
    expect(node.number(`${NS.SCHEDULING}count`)).toBe(3);
  });
});

describe("validation", () => {
  it("validates civil dates without rollover", () => {
    expect(asDate("2024-02-29").toISOString()).toBe("2024-02-29T00:00:00.000Z");
    for (const value of ["2026-02-29", "2026-13-01", "2026-1-01", new Date(NaN)])
      expect(() => asDate(value)).toThrow();
  });
  it("requires title, valid end and scoped-safe calendar IRIs", () => {
    for (const patch of [
      { name: " " },
      { start: "2026-01-01", end: date("2026-03-01Z") },
      { end: date("2026-03-01Z") },
      { inCalendar: "javascript:bad" },
    ])
      expect(() => validateEvent({ ...event, ...patch })).toThrow();
    expect(() => validateCalendar({ title: " " })).toThrow();
    validateEvent({ name: "OK", start: "2026-01-01" });
  });
  it("rejects invalid recurrence constraints", () => {
    for (const patch of [
      { frequency: "HOURLY" },
      { interval: 0 },
      { count: 1.5 },
      { count: 2, until: "2026-01-01" },
      { byDay: ["XX"] },
      { byMonthDay: [0] },
      { byMonthDay: [32] },
      { byMonth: [0] },
      { byMonth: [13] },
    ])
      expect(() => validateRule({ frequency: "DAILY", ...patch } as RecurrenceRule)).toThrow();
    validateRule({
      frequency: "MONTHLY",
      byMonthDay: [-1, 1, 31],
      byMonth: [1, 12],
      until: date("2027-01-01Z"),
    });
  });
  it("requires exactly one valid reminder trigger and fixed durations", () => {
    for (const r of [
      {},
      { triggerOffset: "PT0S", triggerTime: new Date() },
      { triggerOffset: "P1M" },
      { triggerTime: new Date(NaN) },
    ])
      expect(() => validateReminder(r)).toThrow();
    for (const v of ["P", "PT", "P1DT", "no"]) expect(() => durationMilliseconds(v)).toThrow();
    expect(durationMilliseconds("P1W")).toBe(604800000);
    expect(durationMilliseconds("P1DT2H3M4S")).toBe(93784000);
    expect(durationMilliseconds("PT0S")).toBe(0);
  });
});

describe("recurrence and reminders", () => {
  it("expands explicit weekdays and month selectors", () => {
    expect(
      toRRule({ frequency: "WEEKLY", byDay: ["MO", "WE"], count: 4 }, "2026-03-02")
        .all()
        .map((d) => d.toISOString().slice(0, 10)),
    ).toEqual(["2026-03-02", "2026-03-04", "2026-03-09", "2026-03-11"]);
    expect(
      toRRule({ frequency: "MONTHLY", byMonthDay: [-1], byMonth: [3, 4], count: 2 }, "2026-03-01")
        .all()
        .map((d) => d.toISOString().slice(0, 10)),
    ).toEqual(["2026-03-31", "2026-04-30"]);
  });

  it.each([
    ["WEEKLY", "2026-03-23T09:00:00Z", "2026-04-06T08:00:00.000Z"],
    ["MONTHLY", "2026-02-28T09:00:00Z", "2026-04-28T08:00:00.000Z"],
    ["WEEKLY", "2026-10-19T08:00:00Z", "2026-11-02T09:00:00.000Z"],
    ["MONTHLY", "2026-09-28T08:00:00Z", "2026-11-28T09:00:00.000Z"],
  ] as const)("preserves 09:00 London across DST for %s from %s", (frequency, start, last) => {
    const e = { name: "Repeat", start: date(start), recurrence: { frequency, count: 3 } };
    const expanded = expandEvent(e, date("2026-01-01Z"), date("2027-01-01Z"), "Europe/London");
    expect(expanded).toHaveLength(3);
    expect(asDate((expanded[2] as CalendarEvent).start).toISOString()).toBe(last);
    for (const occurrence of expanded)
      expect(wallClock(asDate(occurrence.start), "Europe/London").getUTCHours()).toBe(9);
  });
  it("handles ranges, all-day, exceptions, interval/count/until, and overlap", () => {
    expect(
      expandEvent(
        { name: "All day", start: "2026-03-01" },
        date("2026-03-01T12:00Z"),
        date("2026-03-02Z"),
      ),
    ).toHaveLength(1);
    expect(toRRule({ frequency: "DAILY", until: "2026-03-02" }, "2026-03-01").all()).toHaveLength(
      2,
    );
    expect(
      toRRule(
        { frequency: "DAILY", until: date("2026-03-02T09:00Z") },
        date("2026-03-01T09:00Z"),
      ).all(),
    ).toEqual([date("2026-03-01T09:00Z"), date("2026-03-02T09:00Z")]);
    expect(
      expandEvent(
        {
          name: "Late",
          start: date("2026-03-30T03:30Z"),
          recurrence: { frequency: "DAILY", until: "2026-03-31" },
        },
        date("2026-03-29Z"),
        date("2026-04-03Z"),
        "America/New_York",
      ).map((e) => asDate(e.start).toISOString()),
    ).toEqual(["2026-03-30T03:30:00.000Z", "2026-03-31T03:30:00.000Z", "2026-04-01T03:30:00.000Z"]);

    const e: CalendarEvent = {
      name: "Repeat",
      start: "2026-03-01",
      end: "2026-03-03",
      recurrence: {
        frequency: "DAILY",
        interval: 2,
        count: 4,
        exceptDate: ["2026-03-03", date("2026-03-05Z")],
      },
    };
    expect(expandEvent(e, date("2026-03-02Z"), date("2026-03-08Z")).map((e) => e.start)).toEqual([
      "2026-03-01",
      "2026-03-07",
    ]);
    expect(
      expandEvent(
        { ...e, recurrence: { frequency: "DAILY", until: "2026-03-03" } },
        date("2026-03-01Z"),
        date("2026-03-09Z"),
      ),
    ).toHaveLength(3);
    expect(
      expandEvent(
        { ...e, recurrence: { frequency: "DAILY", until: date("2026-03-02Z") } },
        date("2026-03-01Z"),
        date("2026-03-09Z"),
      ),
    ).toHaveLength(2);
    expect(expandEvent(event, date("2027-01-01Z"), date("2026-01-01Z"))).toEqual([]);
    const simple = { name: "One", start: date("2026-03-01T09:00Z") };
    expect(expandEvent(simple, date("2026-03-01Z"), date("2026-03-02Z"))).toEqual([simple]);
    expect(expandEvent(simple, date("2026-03-02Z"), date("2026-03-03Z"))).toEqual([]);
    expect(
      expandEvent(
        { ...simple, end: date("2026-03-02T09:00Z") },
        date("2026-03-02Z"),
        date("2026-03-03Z"),
      ),
    ).toHaveLength(1);
    expect(
      expandEvent(
        { ...simple, recurrence: { frequency: "DAILY", count: 3 } },
        date("2026-03-01Z"),
        date("2026-03-04Z"),
      ),
    ).toHaveLength(3);
    expect(
      toRRule({ frequency: "YEARLY", byMonth: [3], byMonthDay: [1] }, "2026-03-01").all(
        (_, i) => i < 2,
      ),
    ).toHaveLength(2);
  });
  it("rejects nonexistent wall times without consuming recurrence count", () => {
    expect(() => fromWallClock(date("2026-03-29T01:30Z"), "Europe/London")).toThrow(
      "does not exist",
    );
    const gap: CalendarEvent = {
      name: "Gap",
      start: date("2026-03-28T01:30Z"),
      recurrence: { frequency: "DAILY", count: 3 },
    };
    const starts = (event: CalendarEvent, from = "2026-03-28Z", to = "2026-04-05Z") =>
      expandEvent(event, date(from), date(to), "Europe/London").map((e) =>
        asDate(e.start).toISOString(),
      );
    expect(starts(gap)).toEqual([
      "2026-03-28T01:30:00.000Z",
      "2026-03-30T00:30:00.000Z",
      "2026-03-31T00:30:00.000Z",
    ]);
    expect(starts(gap, "2026-03-31Z")).toEqual(["2026-03-31T00:30:00.000Z"]);
    expect(starts(gap, "2026-04-01Z")).toEqual([]);
    expect(starts(gap, "2026-03-28Z", "2026-03-30Z")).toEqual(["2026-03-28T01:30:00.000Z"]);
    expect(
      starts({
        ...gap,
        recurrence: {
          frequency: "DAILY",
          count: 3,
          exceptDate: ["2026-03-28", date("2026-03-30T00:30Z")],
        },
      }),
    ).toEqual(["2026-03-31T00:30:00.000Z"]);
    expect(starts({ ...gap, recurrence: { frequency: "DAILY", until: "2026-03-31" } })).toEqual(
      starts(gap),
    );
  });
  it.each([
    ["Europe/London", "2026-10-25T01:30Z", "2026-10-25T00:30Z"],
    ["America/New_York", "2026-11-01T01:30Z", "2026-11-01T05:30Z"],
    ["Australia/Lord_Howe", "2026-04-05T01:45Z", "2026-04-04T14:45Z"],
  ])("resolves overlapping wall times to the first instant in %s", (zone, wall, first) => {
    expect(fromWallClock(date(wall), zone)).toEqual(date(first));
    expect(fromWallClock(wallClock(date(first), zone), zone)).toEqual(date(first));
  });
  it("retains a first-occurrence start when expanding through a DST overlap", () => {
    expect(
      expandEvent(
        {
          name: "Overlap",
          start: date("2026-10-25T00:30Z"),
          recurrence: { frequency: "DAILY", count: 2 },
        },
        date("2026-10-25Z"),
        date("2026-10-27Z"),
        "Europe/London",
      ).map((e) => asDate(e.start).toISOString()),
    ).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
  });
  it.each([
    "2026-10-25T01:15Z",
    "2026-10-25T00:30Z",
    "2026-10-25T00:29Z",
  ])("compares inclusive instant cutoffs after resolving rollback candidates (%s)", (until) => {
    const event: CalendarEvent = {
      name: "Cutoff",
      start: date("2026-10-24T00:30Z"),
      recurrence: { frequency: "DAILY", until: date(until) },
    };
    const starts = expandEvent(
      event,
      date("2026-10-24Z"),
      date("2026-10-28Z"),
      "Europe/London",
    ).map((e) => e.start);
    expect(starts).toEqual(
      until.endsWith("00:29Z") ? [event.start] : [event.start, date("2026-10-25T00:30Z")],
    );
  });
  it.each([
    ["Europe/London", "2026-10-25T01:30Z", "2026-10-26T01:30Z"],
    ["America/New_York", "2026-11-01T06:30Z", "2026-11-02T06:30Z"],
    ["Australia/Lord_Howe", "2026-04-04T15:15Z", "2026-04-05T15:15Z"],
  ])("preserves the explicit later DTSTART instant in %s", (zone, start, next) => {
    const event: CalendarEvent = {
      name: "Later overlap",
      start: date(start),
      end: new Date(+date(start) + 1800000),
      recurrence: { frequency: "DAILY", count: 2 },
    };
    const expanded = expandEvent(
      event,
      new Date(+date(start) - 3600000),
      new Date(+date(next) + 3600000),
      zone,
    );
    expect(expanded.map((e) => e.start)).toEqual([date(start), date(next)]);
    expect(expanded[0]?.end).toEqual(event.end);
    expect(
      expandEvent(event, date(start), new Date(+date(start) + 1), zone).map((e) => e.start),
    ).toEqual([date(start)]);
    expect(
      expandEvent(
        { ...event, recurrence: { frequency: "DAILY", count: 2, exceptDate: [date(start)] } },
        date(start),
        new Date(+date(next) + 3600000),
        zone,
      ).map((e) => e.start),
    ).toEqual([date(next)]);
    expect(
      expandEvent(
        { ...event, recurrence: { frequency: "DAILY", until: date(start) } },
        date(start),
        new Date(+date(next) + 3600000),
        zone,
      ).map((e) => e.start),
    ).toEqual([date(start)]);
  });
  it("computes sorted absolute and offset fire times without mutating reminders", () => {
    expect(computeFireTimes(event).map((d) => d.toISOString())).toEqual([
      "2026-03-02T07:00:00.000Z",
      "2026-03-02T08:00:00.000Z",
    ]);
    expect(computeFireTimes({ name: "E", start: "2026-03-01" })).toEqual([]);
  });
});

describe("ported agenda helpers and month listing selection", () => {
  it.each([
    "America/Los_Angeles",
    "Europe/London",
    "Pacific/Auckland",
  ])("keeps civil dates in their display day and month in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    try {
      const allDay = item({ name: "All day", start: "2026-03-01" });
      const timed = item({ name: "Timed", start: new Date(2026, 2, 1, 9) });
      const previous = item({ name: "Previous", start: "2026-02-28" });
      const input = [timed, allDay, previous];
      expect(dayKey(allDay.data.start)).toBe("2026-03-01");
      expect(monthKey(allDay.data.start)).toBe("2026-03");
      expect(sortByStart(input)).toEqual([previous, allDay, timed]);
      const days = groupByDay(input);
      expect(days.map((day) => day.key)).toEqual(["2026-02-28", "2026-03-01"]);
      expect(days[1]?.date).toEqual(new Date(2026, 2, 1));
      expect(days[1]?.events).toEqual([allDay, timed]);
      expect([...groupByMonth(input)]).toEqual([
        ["2026-02", [previous]],
        ["2026-03", [allDay, timed]],
      ]);
      const cell = monthMatrix(new Date(2026, 2, 15), input)
        .flat()
        .find((cell) => dayKey(cell.date) === "2026-03-01");
      expect(cell?.inMonth).toBe(true);
      expect(cell?.events).toEqual([allDay, timed]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("sorts and groups without mutating inputs; constructs a fixed six-week grid", () => {
    const first = item({ name: "A", start: date("2026-03-02T10:00Z") });
    const second = item({ name: "B", start: date("2026-03-02T09:00Z") });
    const third = item({ name: "C", start: date("2026-04-03T09:00Z") });
    const input = [third, first, second];
    expect(sortByStart(input)).toEqual([second, first, third]);
    expect(input[0]).toBe(third);
    expect(groupByDay(input).map((d) => [d.key, d.events.length])).toEqual([
      ["2026-03-02", 2],
      ["2026-04-03", 1],
    ]);
    expect([...groupByMonth(input).keys()]).toEqual(["2026-03", "2026-04"]);
    expect(monthKey(date("2026-03-02Z"))).toBe("2026-03");
    expect(dayKey(date("2026-03-02Z"))).toBe("2026-03-02");
    const grid = monthMatrix(date("2026-03-02Z"), input);
    expect(grid).toHaveLength(6);
    expect(grid.flat()).toHaveLength(42);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid.flat().find((c) => dayKey(c.date) === "2026-03-02")?.events).toEqual([
      second,
      first,
    ]);
    expect(groupByDay([])).toEqual([]);
  });
  it("selects UTC months in a half-open range without inventing paths", () => {
    expect(monthsInRange(date("2026-12-23Z"), date("2027-02-01Z"))).toEqual(["2026-12", "2027-01"]);
    expect(monthsInRange(date("2027-01-01Z"), date("2026-01-01Z"))).toEqual([]);
    expect(
      selectMonthListings(
        new Map([["2026-12", "https://pod.example/m1"]]),
        date("2026-12-01Z"),
        date("2027-02-01Z"),
      ),
    ).toEqual(["https://pod.example/m1"]);
  });
});
