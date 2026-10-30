// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import * as tz from "../src/apps/calendar/lib/tz";
import {
  adherenceByPeriod,
  type DoseEntry,
  type DoseLog,
  type DoseWindow,
  generateDueDoses,
  logDose,
  MedicationError,
  type MedicationSchedule,
  validateSchedule,
} from "../src/apps/health/lib/medication";

const at = (value: string) => Date.parse(value);
const day = (date: string): DoseWindow => ({
  start: at(`${date}T00:00:00Z`),
  end: at(`${date}T00:00:00Z`) + 86_400_000,
});
const base: MedicationSchedule = {
  id: "https://example.org/health/medications/fictional-a",
  startDate: "2026-01-01",
  kind: "daily",
  times: ["09:00"],
};
const asNeeded: MedicationSchedule = {
  id: "https://example.org/health/medications/fictional-b",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  kind: "as-needed",
};
const due = at("2026-01-01T09:00:00Z");
const entry: DoseEntry = { scheduledAt: due, at: due, outcome: "taken" };
const taken: DoseLog = { scheduleId: base.id, scheduledAt: due, at: due, status: "taken" };

afterEach(() => vi.restoreAllMocks());

function fails(action: () => unknown, code: MedicationError["code"]): void {
  expect(action).toThrow(MedicationError);
  expect(action).toThrow(expect.objectContaining({ code }));
}

const dates = (schedule: MedicationSchedule, window: DoseWindow, zone = "UTC") =>
  generateDueDoses(schedule, window, zone).map((dose) => new Date(dose.scheduledAt).toISOString());

describe("medication schedule generation", () => {
  it("sorts explicit daily slots without mutating input and uses half-open windows", () => {
    const times = Object.freeze(["21:00", "00:00", "09:00"]);
    const schedule = Object.freeze({ ...base, times });
    const window = Object.freeze({ start: due, end: due + 86_400_000 });
    expect(dates(schedule, window)).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-01-01T21:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    ]);
    expect(generateDueDoses(base, day("2026-01-01"), "UTC")).toEqual([
      { scheduleId: base.id, scheduledAt: due },
    ]);
    expect(times).toEqual(["21:00", "00:00", "09:00"]);
    expect(generateDueDoses(base, { start: due, end: due }, "UTC")).toEqual([]);
    expect(dates(base, { start: due + 1000, end: due + 2000 })).toEqual([]);
  });

  it("clips to inclusive start/end dates and accepts an empty date intersection", () => {
    const schedule = { ...base, startDate: "2026-01-02", endDate: "2026-01-03" };
    expect(dates(schedule, { start: day("2026-01-01").start, end: day("2026-01-05").end })).toEqual(
      ["2026-01-02T09:00:00.000Z", "2026-01-03T09:00:00.000Z"],
    );
    expect(dates(schedule, day("2026-01-05"))).toEqual([]);
  });

  it("uses ISO weekdays and local dates rather than UTC weekdays", () => {
    const schedule: MedicationSchedule = { ...base, kind: "weekdays", weekdays: [7, 1] };
    expect(
      dates(schedule, { start: at("2026-01-03T00:00:00Z"), end: at("2026-01-07T00:00:00Z") }),
    ).toEqual(["2026-01-04T09:00:00.000Z", "2026-01-05T09:00:00.000Z"]);
    expect(
      dates(
        { ...schedule, times: ["00:15"] },
        { start: at("2026-01-04T00:00:00Z"), end: at("2026-01-05T00:00:00Z") },
        "Pacific/Kiritimati",
      ),
    ).toEqual(["2026-01-04T10:15:00.000Z"]);
  });

  it("anchors intervals before the window and crosses leap days, months and years", () => {
    const schedule: MedicationSchedule = {
      ...base,
      startDate: "2024-02-27",
      kind: "interval",
      everyDays: 2,
    };
    expect(
      dates(schedule, { start: at("2024-02-28T00:00:00Z"), end: at("2024-03-04T00:00:00Z") }),
    ).toEqual(["2024-02-29T09:00:00.000Z", "2024-03-02T09:00:00.000Z"]);
    expect(
      dates(
        { ...schedule, startDate: "2025-12-30", everyDays: 3 },
        { start: at("2025-12-31T00:00:00Z"), end: at("2026-01-06T00:00:00Z") },
      ),
    ).toEqual(["2026-01-02T09:00:00.000Z", "2026-01-05T09:00:00.000Z"]);
  });

  it("preserves local times across spring/fall DST and fractional offsets", () => {
    expect(
      dates(
        base,
        { start: at("2026-03-07T00:00:00Z"), end: at("2026-03-10T00:00:00Z") },
        "America/New_York",
      ),
    ).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z"]);
    expect(
      dates(
        base,
        { start: at("2026-10-31T00:00:00Z"), end: at("2026-11-03T00:00:00Z") },
        "America/New_York",
      ),
    ).toEqual(["2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
    expect(dates(base, day("2026-01-01"), "Asia/Kathmandu")).toEqual(["2026-01-01T03:15:00.000Z"]);
    expect(
      dates(
        { ...base, kind: "interval", everyDays: 2, startDate: "2026-03-07" },
        { start: at("2026-03-07T00:00:00Z"), end: at("2026-03-12T00:00:00Z") },
        "America/New_York",
      ),
    ).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-09T13:00:00.000Z", "2026-03-11T13:00:00.000Z"]);
  });

  it.each([
    ["2026-03-08", "02:30", "America/New_York"],
    ["2026-11-01", "01:30", "America/New_York"],
    ["2026-10-04", "02:15", "Australia/Lord_Howe"],
    ["2026-04-05", "01:45", "Australia/Lord_Howe"],
  ])("rejects DST gaps/overlaps on %s at %s in %s", (date, time, zone) => {
    fails(() => dates({ ...base, times: [time] }, day(date), zone), "invalid-zoned-time");
  });

  it.each([
    ["2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", "2026-03-08T13:00:00Z"],
    ["2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", "2026-11-01T14:00:00Z"],
  ])("partitions a DST day into adjacent windows without losing or duplicating doses", (start, end, middle) => {
    const schedule = { ...base, times: ["00:00", "09:00", "23:00"] };
    const window = { start: at(start), end: at(end) };
    const all = generateDueDoses(schedule, window, "America/New_York");
    const left = generateDueDoses(
      schedule,
      { start: window.start, end: at(middle) },
      "America/New_York",
    );
    const right = generateDueDoses(
      schedule,
      { start: at(middle), end: window.end },
      "America/New_York",
    );
    expect(all).toHaveLength(3);
    expect([...left, ...right]).toEqual(all);
    expect(new Set(all.map((dose) => dose.scheduledAt)).size).toBe(3);
  });

  it("rejects an unsupported slot even when outside the instant window on a touched local date", () => {
    fails(
      () =>
        dates(
          { ...base, times: ["02:30"] },
          {
            start: at("2026-03-08T16:00:00Z"),
            end: at("2026-03-08T17:00:00Z"),
          },
          "America/New_York",
        ),
      "invalid-zoned-time",
    );
  });

  it("rejects a skipped local calendar date rather than deleting an expected dose", () => {
    fails(
      () =>
        dates(
          { ...base, startDate: "2011-01-01" },
          { start: at("2011-12-29T10:00:00Z"), end: at("2011-12-31T10:00:00Z") },
          "Pacific/Apia",
        ),
      "invalid-zoned-time",
    );
  });

  it.each([
    ["2009-11-01T03:00:00Z", "2009-11-01T03:02:00Z"],
    ["2009-11-01T02:59:00Z", "2009-11-01T03:02:00Z"],
  ])("rejects midnight rollbacks even when endpoint dates hide a visited date", (start, end) => {
    // Goose Bay briefly visits November 1 before returning to October 31.
    // The first window's dates run backwards; the second's both say October 31.
    fails(
      () =>
        dates(
          { ...base, startDate: "2009-01-01", times: ["00:00"] },
          { start: at(start), end: at(end) },
          "America/Goose_Bay",
        ),
      "invalid-zoned-time",
    );
  });

  it("does not resolve slots on excluded weekdays/dates and yields no as-needed doses", () => {
    expect(
      dates(
        { ...base, kind: "weekdays", weekdays: [1], times: ["02:30"] },
        day("2026-03-08"),
        "America/New_York",
      ),
    ).toEqual([]);
    expect(dates(asNeeded, day("2026-01-01"))).toEqual([]);
  });

  it("supports midnight and bounds consistently with the calendar core", () => {
    expect(
      dates({ ...base, startDate: "2000-01-01", times: ["00:00"] }, day("2000-01-01")),
    ).toEqual(["2000-01-01T00:00:00.000Z"]);
    expect(
      dates(
        { ...base, times: ["23:59"] },
        {
          start: at("2099-12-31T23:58:00Z"),
          end: at("2099-12-31T23:59:59Z"),
        },
      ),
    ).toEqual(["2099-12-31T23:59:00.000Z"]);
    fails(() => dates(base, day("2000-01-01"), "America/New_York"), "invalid-zoned-time");
    fails(
      () =>
        dates(
          base,
          {
            start: at("2099-12-31T23:58:00Z"),
            end: at("2099-12-31T23:59:59Z"),
          },
          "Asia/Tokyo",
        ),
      "invalid-zoned-time",
    );
  });

  it.each([
    "",
    "Mars/Olympus",
    "+01:00",
    null,
    123,
  ])("rejects invalid zone %s even for as-needed", (zone) => {
    fails(
      () => generateDueDoses(asNeeded, day("2026-01-01"), zone as string),
      "invalid-zoned-time",
    );
  });

  it("bounds expansion work before doing expensive timezone conversions", () => {
    fails(
      () =>
        dates(
          {
            ...base,
            times: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
          },
          {
            start: at("2026-01-01T00:00:00Z"),
            end: at("2026-02-14T00:00:00Z"),
          },
        ),
      "limit-exceeded",
    );
  });
});

describe("medication validation", () => {
  it.each([
    null,
    [],
    "daily",
    {},
    { ...base, id: " " },
    { ...base, id: 1 },
    { ...base, unsupported: true },
    { ...base, kind: "monthly" },
    { ...base, endDate: "2025-12-31" },
    { ...base, times: undefined },
    { ...base, times: [] },
    { ...base, times: "09:00" },
    { ...base, times: ["09:00", "09:00"] },
    {
      ...base,
      times: Array.from({ length: 25 }, (_, minute) => `09:${String(minute).padStart(2, "0")}`),
    },
    ...["24:00", "9:00", "09:60", "09:00:00", " 09:00", 9, null, undefined].map((time) => ({
      ...base,
      times: [time],
    })),
    { ...base, times: new Array(1) },
    { ...base, weekdays: [1] },
    { ...base, everyDays: 2 },
    { ...asNeeded, times: ["09:00"] },
    ...[undefined, [], [1, 1], [0], [8], [1.5], ["1"], new Array(1)].map((weekdays) => ({
      ...base,
      kind: "weekdays",
      weekdays,
    })),
    ...[undefined, 0, -1, 1.5, Infinity, "2", Number.MAX_SAFE_INTEGER + 1].map((everyDays) => ({
      ...base,
      kind: "interval",
      everyDays,
    })),
  ])("rejects unsupported or malformed schedule %#", (schedule) => {
    fails(() => validateSchedule(schedule as MedicationSchedule), "invalid-schedule");
  });

  it.each([
    "1999-12-31",
    "2100-01-01",
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "2026-1-01",
    "2026-01-01Z",
    null,
    123,
  ])("rejects invalid date %s", (date) => {
    fails(
      () => validateSchedule({ ...base, startDate: date } as MedicationSchedule),
      "invalid-date",
    );
    fails(() => validateSchedule({ ...base, endDate: date } as MedicationSchedule), "invalid-date");
  });

  it.each([
    NaN,
    Infinity,
    null,
    "2026-01-01",
    due + 1,
    due + 0.5,
    at("1999-12-31T23:59:59Z"),
    at("2100-01-01T00:00:00Z"),
  ])("rejects invalid instant %s", (value) => {
    fails(
      () => generateDueDoses(base, { start: value, end: due } as DoseWindow, "UTC"),
      "invalid-instant",
    );
    fails(
      () => generateDueDoses(base, { start: due, end: value } as DoseWindow, "UTC"),
      "invalid-instant",
    );
  });

  it.each([
    null,
    [],
    { start: due + 1000, end: due },
    { start: due, end: due, extra: true },
  ])("rejects invalid window %#", (window) => {
    fails(() => generateDueDoses(base, window as DoseWindow, "UTC"), "invalid-window");
  });

  it("rejects windows exceeding 366 elapsed days", () => {
    fails(() => dates(base, { start: due, end: due + 367 * 86_400_000 }), "limit-exceeded");
  });
});

describe("medication dose logging", () => {
  it("records taken, early, late and skipped events immutably", () => {
    const logs = Object.freeze([Object.freeze(taken)]);
    const tomorrow = due + 86_400_000;
    const result = logDose(base, "UTC", logs, {
      scheduledAt: tomorrow,
      at: tomorrow + 1000,
      outcome: "taken",
    });
    expect(result).toEqual([
      taken,
      { scheduleId: base.id, scheduledAt: tomorrow, at: tomorrow + 1000, status: "late" },
    ]);
    expect(result).not.toBe(logs);
    expect(result[0]).not.toBe(taken);
    expect(logs).toEqual([taken]);
    expect(logDose(base, "UTC", [], { ...entry, at: due - 1000 })[0]?.status).toBe("taken");
    expect(
      logDose(base, "UTC", [], { ...entry, outcome: "skipped", at: due + 1000 })[0]?.status,
    ).toBe("skipped");
    fails(() => logDose(base, "UTC", logs, { ...entry, outcome: "skipped" }), "duplicate-log");
  });

  it("logs distinct as-needed taken events without scheduled expectations", () => {
    const logs = logDose(asNeeded, "UTC", [], { scheduledAt: null, at: due, outcome: "taken" });
    expect(logs[0]).toEqual({
      scheduleId: asNeeded.id,
      scheduledAt: null,
      at: due,
      status: "taken",
    });
    expect(
      logDose(asNeeded, "UTC", logs, { scheduledAt: null, at: due + 1000, outcome: "taken" }),
    ).toHaveLength(2);
    fails(
      () => logDose(asNeeded, "UTC", logs, { scheduledAt: null, at: due, outcome: "taken" }),
      "duplicate-log",
    );
    fails(
      () => logDose(asNeeded, "UTC", [], { scheduledAt: null, at: due, outcome: "skipped" }),
      "invalid-log",
    );
    fails(() => logDose(asNeeded, "UTC", [], entry), "invalid-log");
    for (const date of ["2025-12-31", "2027-01-01"]) {
      fails(
        () =>
          logDose(asNeeded, "UTC", [], {
            scheduledAt: null,
            at: day(date).start,
            outcome: "taken",
          }),
        "invalid-log",
      );
    }
  });

  it("checks scheduled references against local weekday, interval and clock time", () => {
    for (const scheduledAt of [due + 1000, due + 60_000, due - 3600_000]) {
      fails(() => logDose(base, "UTC", [], { ...entry, scheduledAt }), "invalid-log");
    }
    fails(() => logDose({ ...base, startDate: "2026-01-02" }, "UTC", [], entry), "invalid-log");
    fails(
      () => logDose({ ...base, kind: "weekdays", weekdays: [1] }, "UTC", [], entry),
      "invalid-log",
    );
    fails(
      () =>
        logDose({ ...base, kind: "interval", everyDays: 2 }, "UTC", [], {
          ...entry,
          scheduledAt: due + 86_400_000,
        }),
      "invalid-log",
    );
    const localDue = at("2026-03-08T13:00:00Z");
    expect(
      logDose(base, "America/New_York", [], {
        scheduledAt: localDue,
        at: localDue,
        outcome: "taken",
      })[0]?.status,
    ).toBe("taken");
    for (const repeated of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
      fails(
        () =>
          logDose({ ...base, times: ["01:30"] }, "America/New_York", [], {
            scheduledAt: at(repeated),
            at: at(repeated),
            outcome: "taken",
          }),
        "invalid-zoned-time",
      );
    }
  });

  it.each([
    null,
    [],
    { ...entry, outcome: "late" },
    { ...entry, extra: true },
  ])("rejects invalid entry %#", (value) => {
    fails(() => logDose(base, "UTC", [], value as DoseEntry), "invalid-log");
  });

  it("rejects invalid instants, schedule, and log collections with typed errors", () => {
    fails(() => logDose(base, "UTC", [], { ...entry, at: NaN }), "invalid-instant");
    for (const value of [Symbol("unsupported"), undefined, {}, "123"]) {
      fails(
        () => logDose(base, "UTC", [], { ...entry, at: value } as DoseEntry),
        "invalid-instant",
      );
      fails(
        () => logDose(base, "UTC", [], { ...entry, scheduledAt: value } as DoseEntry),
        "invalid-instant",
      );
    }
    fails(() => logDose(base, "UTC", [], { ...entry, scheduledAt: null }), "invalid-instant");
    fails(
      () => logDose(null as unknown as MedicationSchedule, "UTC", [], entry),
      "invalid-schedule",
    );
    fails(() => logDose(base, "UTC", null as unknown as DoseLog[], entry), "invalid-log");
    fails(() => logDose(base, "UTC", new Array(1), entry), "invalid-log");
  });

  it.each([
    null,
    [],
    { ...taken, scheduleId: "https://example.org/unrelated" },
    { ...taken, status: "unknown" },
    { ...taken, status: "late" },
    { ...taken, at: due + 1000 },
    { ...taken, extra: true },
  ])("rejects corrupt existing outcomes %#", (value) => {
    fails(() => adherenceByPeriod(base, "UTC", [value] as DoseLog[], [], due), "invalid-log");
  });

  it("validates empty collections and sparse periods", () => {
    fails(
      () => adherenceByPeriod(base, "UTC", null as unknown as DoseLog[], [], due),
      "invalid-log",
    );
    fails(() => adherenceByPeriod(base, "invalid", [], [], due), "invalid-zoned-time");
    fails(
      () => adherenceByPeriod(base, "UTC", [], null as unknown as DoseWindow[], due),
      "invalid-window",
    );
    fails(() => adherenceByPeriod(base, "UTC", [], new Array(1), due), "invalid-window");
    fails(() => adherenceByPeriod(base, "UTC", [], [], NaN), "invalid-instant");
    expect(adherenceByPeriod(base, "UTC", [], [], due)).toEqual([]);
  });
});

describe("medication adherence", () => {
  it("counts taken, late, skipped and missed and groups by due instant", () => {
    const schedule: MedicationSchedule = { ...base, times: ["09:00", "12:00", "15:00", "18:00"] };
    let logs = logDose(schedule, "UTC", [], entry);
    // Taken after midnight still belongs to the previous day's due period.
    logs = logDose(schedule, "UTC", logs, {
      scheduledAt: due + 3 * 3600_000,
      at: due + 20 * 3600_000,
      outcome: "taken",
    });
    logs = logDose(schedule, "UTC", logs, {
      scheduledAt: due + 6 * 3600_000,
      at: due + 6 * 3600_000,
      outcome: "skipped",
    });
    const before = JSON.stringify(logs);
    expect(
      adherenceByPeriod(schedule, "UTC", logs, [day("2026-01-01")], day("2026-01-03").start),
    ).toEqual([
      {
        ...day("2026-01-01"),
        expected: 4,
        taken: 1,
        late: 1,
        skipped: 1,
        missed: 1,
        adherencePercent: 50,
        onTimePercent: 25,
      },
    ]);
    expect(JSON.stringify(logs)).toBe(before);
  });

  it("excludes future doses and outcomes after asOf, including future skips", () => {
    const logs = [
      taken,
      { ...taken, scheduledAt: due + 86_400_000, at: due + 86_400_000, status: "skipped" as const },
    ];
    const periods = [day("2026-01-01"), day("2026-01-02")];
    const results = adherenceByPeriod(base, "UTC", logs, periods, due);
    expect(results.map(({ expected, adherencePercent }) => [expected, adherencePercent])).toEqual([
      [1, 100],
      [0, null],
    ]);
    expect(
      adherenceByPeriod(
        base,
        "UTC",
        [{ ...taken, at: due + 1000, status: "late" }],
        [periods[0] as DoseWindow],
        due,
      )[0]?.missed,
    ).toBe(1);
    expect(
      adherenceByPeriod(base, "UTC", [taken], [periods[0] as DoseWindow], due - 1000)[0]?.expected,
    ).toBe(0);
  });

  it("returns unrounded percentages, overlapping periods in caller order and zero expectations", () => {
    const schedule = { ...base, times: ["09:00", "10:00", "11:00"] };
    const window = { start: due, end: due + 1000 };
    const result = adherenceByPeriod(
      schedule,
      "UTC",
      [taken],
      [day("2026-01-01"), window],
      day("2026-01-02").start,
    );
    expect(result[0]?.adherencePercent).toBeCloseTo(100 / 3, 12);
    expect(result[1]?.adherencePercent).toBe(100);
    expect(result.map((period) => period.expected)).toEqual([3, 1]);
    const empty = adherenceByPeriod(asNeeded, "UTC", [], [day("2026-01-01")], due)[0];
    expect(empty).toEqual({
      ...day("2026-01-01"),
      expected: 0,
      taken: 0,
      late: 0,
      skipped: 0,
      missed: 0,
      adherencePercent: null,
      onTimePercent: null,
    });
  });
});

describe("medication call-wide conversion work", () => {
  const oneSlot = { start: due, end: due + 1000 };
  const history = (count: number): DoseLog[] =>
    Array.from({ length: count }, (_, index) => ({
      ...taken,
      scheduledAt: due + index * 86_400_000,
      at: due + index * 86_400_000,
    }));

  it("rejects oversized histories before converting or copying them, including the appended entry", () => {
    const inverse = vi.spyOn(tz, "wallClockToInstant");
    const forward = vi.spyOn(tz, "instantToWallClock");
    const logs = history(1025);
    fails(() => adherenceByPeriod(base, "UTC", logs, [], due), "limit-exceeded");
    fails(
      () =>
        logDose(base, "UTC", logs.slice(0, 1024), {
          ...entry,
          scheduledAt: due + 1024 * 86_400_000,
        }),
      "limit-exceeded",
    );
    expect(inverse).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    expect(logs).toEqual(history(1025));
  });

  it("accepts exactly 1024 history records and includes the new entry in that allowance", () => {
    // Isolate budget accounting from the exhaustive IANA search for these UTC fixtures.
    const inverse = vi.spyOn(tz, "wallClockToInstant").mockImplementation((wall) => at(`${wall}Z`));
    const logs = history(1024);
    expect(adherenceByPeriod(base, "UTC", logs, [], due)).toEqual([]);
    expect(inverse).toHaveBeenCalledTimes(1024);
    inverse.mockClear();
    const last = due + 1023 * 86_400_000;
    expect(
      logDose(base, "UTC", logs.slice(0, -1), {
        scheduledAt: last,
        at: last,
        outcome: "taken",
      }),
    ).toEqual(logs);
    expect(inverse).toHaveBeenCalledTimes(1024);
  });

  it("preflights the combined history and period slots before inverse conversions", () => {
    const inverse = vi.spyOn(tz, "wallClockToInstant").mockImplementation((wall) => at(`${wall}Z`));
    const logs = history(1024);
    fails(() => adherenceByPeriod(base, "UTC", logs, [oneSlot], due), "limit-exceeded");
    expect(inverse).not.toHaveBeenCalled();
    const result = adherenceByPeriod(base, "UTC", logs.slice(0, -1), [oneSlot], due);
    expect(result[0]).toMatchObject({ expected: 1, taken: 1, adherencePercent: 100 });
    // The period's slot shares the history's validated conversion.
    expect(inverse).toHaveBeenCalledTimes(1023);
  });

  it("shares one budget across periods and preflights the entire collection", () => {
    const inverse = vi.spyOn(tz, "wallClockToInstant");
    fails(
      () => adherenceByPeriod(base, "UTC", [], Array(1025).fill(oneSlot), due),
      "limit-exceeded",
    );
    expect(inverse).not.toHaveBeenCalled();
    const results = adherenceByPeriod(base, "UTC", [], Array(1024).fill(oneSlot), due);
    expect(results).toHaveLength(1024);
    expect(results.every((period) => period.expected === 1 && period.missed === 1)).toBe(true);
    expect(inverse).toHaveBeenCalledTimes(1);
  });

  it("reuses scheduled references for overlapping periods and revalidates on the next call", () => {
    const inverse = vi.spyOn(tz, "wallClockToInstant");
    const log = { ...taken };
    const logs = [log];
    const results = adherenceByPeriod(base, "UTC", logs, [oneSlot, oneSlot], due);
    expect(results.map((period) => period.adherencePercent)).toEqual([100, 100]);
    expect(inverse).toHaveBeenCalledTimes(1);
    log.status = "late";
    fails(() => adherenceByPeriod(base, "UTC", logs, [oneSlot], due), "invalid-log");
  });

  it("also bounds as-needed histories before forward conversions", () => {
    const forward = vi.spyOn(tz, "instantToWallClock");
    const logs: DoseLog[] = Array.from({ length: 1025 }, (_, index) => ({
      scheduleId: asNeeded.id,
      scheduledAt: null,
      at: due + index * 1000,
      status: "taken",
    }));
    fails(() => adherenceByPeriod(asNeeded, "UTC", logs, [], due), "limit-exceeded");
    fails(
      () =>
        logDose(asNeeded, "UTC", logs.slice(0, -1), {
          scheduledAt: null,
          at: due + 1024 * 1000,
          outcome: "taken",
        }),
      "limit-exceeded",
    );
    expect(forward).not.toHaveBeenCalled();
    expect(adherenceByPeriod(asNeeded, "UTC", logs.slice(0, -1), [oneSlot], due)[0]?.expected).toBe(
      0,
    );
  });
});
