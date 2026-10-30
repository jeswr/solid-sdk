// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  createReminderState,
  dueReminders,
  nextWakeup,
  parseTriggerOffset,
  type ReminderAction,
  ReminderError,
  type ReminderErrorCode,
  type ReminderEvent,
  type ReminderState,
  type ReminderStatus,
  type ReminderTrigger,
  type ReminderWindow,
  reminderKey,
  reminderReducer,
} from "../src/apps/calendar/lib/reminders";

const NOW = Date.parse("2026-10-26T09:45:00Z");
const clock = () => NOW;
const empty = createReminderState();
const key = reminderKey("https://example.org/calendar/meeting", "2026-10-26", "notice");
function event(trigger: ReminderTrigger = { kind: "relative", offset: "-PT15M" }): ReminderEvent {
  return {
    id: "https://example.org/calendar/meeting",
    occurrenceId: "2026-10-26",
    start: NOW + 900_000,
    end: NOW + 4_500_000,
    reminders: [{ id: "notice", trigger }],
  };
}
function scan(events: readonly ReminderEvent[] = [event()], state: ReminderState = empty) {
  return dueReminders(events, { to: NOW + 1 }, state, clock);
}
function fails(operation: () => unknown, code: ReminderErrorCode) {
  expect(operation).toThrow(ReminderError);
  expect(operation).toThrow(expect.objectContaining({ code, name: "ReminderError" }));
}
function state(entry: unknown, entryKey: unknown = key): ReminderState {
  return new Map([[entryKey, entry]]) as ReminderState;
}

describe("TRIGGER instants", () => {
  it.each([
    ["-PT15M", -900_000],
    ["+PT2H", 7_200_000],
    ["PT1H2M3.004S", 3_723_004],
    ["PT0S", 0],
    ["PT0.1S", 100],
    ["PT0.12S", 120],
    ["PT90M", 5_400_000],
    ["PT1.001S", 1001],
    ["PT8640000000000S", 8_640_000_000_000_000],
    ["PT8639999999999.999S", 8_639_999_999_999_999],
  ])("parses fixed duration %s exactly", (offset, expected) => {
    expect(parseTriggerOffset(offset)).toBe(expected);
  });
  it.each([
    "",
    "PT",
    "P",
    "P1D",
    "P1W",
    "P1M",
    "P1Y",
    "-P1DT1H",
    "PT1.0001S",
    "PT1.5H",
    "PT-1M",
    "pt1m",
    " PT1M",
    "PT1S\n",
    "PT1M1H",
  ])("rejects unsupported %j", (offset) => {
    fails(() => parseTriggerOffset(offset), "unsupported-trigger");
  });
  it("rejects wrong types and overflow", () => {
    fails(() => parseTriggerOffset(null as unknown as string), "invalid-trigger");
    fails(() => parseTriggerOffset("PT999999999999999999999999999999H"), "invalid-trigger");
    fails(() => parseTriggerOffset("PT8640000000000.001S"), "invalid-trigger");
  });
  it("resolves start, end and absolute anchors", () => {
    expect(scan()[0]).toEqual({
      key,
      eventId: event().id,
      occurrenceId: event().occurrenceId,
      reminderId: "notice",
      triggerAt: NOW,
      dueAt: NOW,
      revision: 0,
    });
    expect(scan([event({ kind: "relative", related: "start", offset: "-PT15M" })])).toHaveLength(1);
    expect(scan([event({ kind: "relative", related: "end", offset: "-PT75M" })])).toHaveLength(1);
    expect(scan([event({ kind: "absolute", at: NOW })])).toHaveLength(1);
    expect(nextWakeup([event({ kind: "relative", offset: "PT0S" })], empty, clock)).toBe(
      NOW + 900_000,
    );
    expect(nextWakeup([event({ kind: "relative", offset: "+PT1M" })], empty, clock)).toBe(
      NOW + 960_000,
    );
    const noEnd = { ...event(), end: undefined } as unknown as ReminderEvent;
    expect(scan([noEnd])).toHaveLength(1);
    const { end: _end, ...withoutEnd } = event({
      kind: "relative",
      related: "end",
      offset: "PT0S",
    });
    fails(() => scan([withoutEnd]), "invalid-trigger");
  });
  it("uses resolved instants across a DST transition without host timezone arithmetic", () => {
    const start = Date.parse("2026-03-29T03:15:00+02:00");
    const events = [{ ...event({ kind: "relative", offset: "-PT30M" }), start, end: start }];
    expect(nextWakeup(events, empty, () => start - 3_600_000)).toBe(
      Date.parse("2026-03-29T00:45:00Z"),
    );
  });
  it.each([
    [null, "invalid-trigger"],
    [[], "invalid-trigger"],
    [{ kind: "repeat" }, "unsupported-trigger"],
    [{ kind: "relative", offset: "PT0S", related: "middle" }, "unsupported-trigger"],
    [{ kind: "relative", offset: "PT0S", at: NOW }, "invalid-trigger"],
    [{ kind: "absolute", at: NOW, offset: "PT0S" }, "invalid-trigger"],
    [{ kind: "absolute", at: NOW, repeat: 2 }, "invalid-trigger"],
    [{ kind: "absolute", at: "2026-10-26T09:45:00Z" }, "invalid-instant"],
    [{ kind: "absolute" }, "invalid-instant"],
    [{ kind: "relative" }, "invalid-trigger"],
  ] as const)("rejects malformed triggers %j", (trigger, code) => {
    fails(() => scan([event(trigger as unknown as ReminderTrigger)]), code);
  });
  it("rejects addition outside the instant range", () => {
    fails(
      () =>
        scan([
          {
            ...event({ kind: "relative", offset: "PT1S" }),
            start: 8_640_000_000_000_000,
            end: 8_640_000_000_000_000,
          },
        ]),
      "invalid-instant",
    );
  });
});

describe("windows, ordering and wakeups", () => {
  it.each<ReminderTrigger>([
    { kind: "absolute", at: 8_640_000_000_000_000 },
    { kind: "relative", offset: "PT0S" },
  ])("delivers a maximum-instant trigger using the window-end sentinel: %j", (trigger) => {
    const maximum = 8_640_000_000_000_000;
    const events = [{ ...event(trigger), start: maximum, end: maximum }];
    const atMaximum = () => maximum;
    expect(nextWakeup(events, empty, clock)).toBe(maximum);
    expect(dueReminders(events, { to: maximum }, empty, atMaximum)).toEqual([]);
    const due = dueReminders(events, { to: maximum + 1 }, empty, atMaximum);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ key, triggerAt: maximum, dueAt: maximum, revision: 0 });
    const delivered = reminderReducer(empty, { type: "deliver", key, revision: 0 }, atMaximum);
    expect(nextWakeup(events, delivered, atMaximum)).toBeNull();
    expect(dueReminders(events, { to: maximum + 1 }, delivered, atMaximum)).toEqual([]);
  });
  it("delivers a snooze at the maximum instant", () => {
    const maximum = 8_640_000_000_000_000;
    const snoozed = reminderReducer(empty, { type: "snooze", key, until: maximum }, clock);
    expect(nextWakeup([event()], snoozed, clock)).toBe(maximum);
    expect(dueReminders([event()], { to: maximum }, snoozed, clock)).toEqual([]);
    expect(
      dueReminders([event()], { from: maximum, to: maximum + 1 }, snoozed, clock),
    ).toMatchObject([{ key, triggerAt: NOW, dueAt: maximum, revision: 1 }]);
  });
  it("accepts the sentinel only as a window end", () => {
    const sentinel = 8_640_000_000_000_001;
    fails(() => scan([event({ kind: "absolute", at: sentinel })]), "invalid-instant");
    fails(() => dueReminders([], { to: sentinel }, empty, () => sentinel), "invalid-clock");
    fails(
      () => reminderReducer(empty, { type: "snooze", key, until: sentinel }, clock),
      "invalid-action",
    );
    fails(
      () => scan([], state({ status: "snoozed", until: sentinel, revision: 1 })),
      "invalid-state",
    );
  });
  it("uses half-open boundaries and explicit catch-up, including epoch zero", () => {
    const events = [event({ kind: "absolute", at: NOW })];
    expect(dueReminders(events, { from: NOW - 1, to: NOW }, empty, clock)).toEqual([]);
    expect(dueReminders(events, { from: NOW, to: NOW }, empty, clock)).toEqual([]);
    expect(dueReminders(events, { from: NOW + 1, to: NOW + 2 }, empty, clock)).toEqual([]);
    expect(
      dueReminders(events, { from: NOW - 1, to: NOW + 1 }, empty, () => NOW + 100),
    ).toHaveLength(1);
    expect(
      dueReminders([event({ kind: "absolute", at: 0 })], { from: 0, to: 1 }, empty, clock),
    ).toHaveLength(1);
    expect(nextWakeup(events, empty, () => NOW + 1)).toBe(NOW + 1);
    expect(nextWakeup(events, empty, clock)).toBe(NOW);
    expect(nextWakeup([], empty, clock)).toBeNull();
    expect(scan([])).toEqual([]);
    expect(scan([{ ...event(), reminders: [] }])).toEqual([]);
  });
  it("samples the clock once per operation", () => {
    let calls = 0;
    const ticking = () => NOW + calls++;
    expect(dueReminders([event()], { to: NOW + 1 }, empty, ticking)).toHaveLength(1);
    expect(calls).toBe(1);
    nextWakeup([event()], empty, ticking);
    expect(calls).toBe(2);
    reminderReducer(empty, { type: "dismiss", key }, ticking);
    expect(calls).toBe(3);
  });
  it("sorts deterministically and keeps concurrent alarms and separate occurrences", () => {
    const a = { ...event(), id: "a" };
    const b = { ...event(), id: "b" };
    const early = { ...event({ kind: "absolute", at: NOW - 1 }), id: "early" };
    const second = { ...event(), occurrenceId: "second" };
    const multi = {
      ...event(),
      reminders: [
        ...event().reminders,
        { id: "other", trigger: { kind: "absolute", at: NOW } as const },
      ],
    };
    const all = [b, second, early, multi, a];
    const result = dueReminders(all, { from: NOW - 1, to: NOW + 1 }, empty, clock);
    expect(result.map((r) => r.eventId)).toEqual([
      "early",
      "a",
      "b",
      event().id,
      event().id,
      event().id,
    ]);
    expect(dueReminders([...all].reverse(), { from: NOW - 1, to: NOW + 1 }, empty, clock)).toEqual(
      result,
    );
    expect(new Set(result.map((r) => r.key)).size).toBe(6);
    expect(all[0]).toBe(b);
    expect(reminderKey("a,b", "c", "d")).not.toBe(reminderKey("a", "b,c", "d"));
  });
  it.each([
    null,
    [],
    { to: NOW, extra: true },
    { from: NOW + 1, to: NOW },
    { to: NaN },
    { to: Infinity },
    { to: 0.1 },
    { to: 8_640_000_000_000_002 },
    { to: -8_640_000_000_000_001 },
    { to: "8640000000000001" },
    { from: 8_640_000_000_000_001, to: 8_640_000_000_000_001 },
    { from: null, to: NOW },
    { from: "0", to: NOW },
    {},
  ])("rejects invalid windows %j", (window) => {
    fails(() => dueReminders([], window as ReminderWindow, empty, clock), "invalid-window");
  });
  it.each([
    NaN,
    Infinity,
    -Infinity,
    0.1,
    8_640_000_000_000_001,
    "0",
    null,
    undefined,
  ])("rejects invalid instants %j", (start) => {
    fails(() => scan([{ ...event(), start } as ReminderEvent]), "invalid-instant");
  });
  it("rejects bad/throwing clocks without exposing their error", () => {
    for (const invalid of [
      () => NaN,
      () => {
        throw new Error("private value");
      },
      null,
    ]) {
      const badClock = invalid as () => number;
      fails(() => dueReminders([], { to: NOW }, empty, badClock), "invalid-clock");
      fails(() => nextWakeup([], empty, badClock), "invalid-clock");
      fails(() => reminderReducer(empty, { type: "dismiss", key }, badClock), "invalid-clock");
      expect(() => nextWakeup([], empty, badClock)).not.toThrow("private value");
    }
  });
});

describe("delivery state", () => {
  it("dedupes overlapping scans after acknowledgement, without consuming on read", () => {
    const [due] = scan();
    expect(due).toBeDefined();
    expect(scan()).toHaveLength(1);
    const delivered = reminderReducer(empty, { type: "deliver", key, revision: 0 }, clock);
    expect(dueReminders([event()], { from: NOW - 100, to: NOW + 100 }, delivered, clock)).toEqual(
      [],
    );
    expect(nextWakeup([event()], delivered, clock)).toBeNull();
    expect(empty.size).toBe(0);
    expect(reminderReducer(delivered, { type: "deliver", key, revision: 0 }, clock)).toEqual(
      delivered,
    );
    expect(scan([{ ...event(), occurrenceId: "next" }], delivered)).toHaveLength(1);
  });
  it("snoozes, replaces snoozes, fences stale delivery and permits snoozing after delivery", () => {
    const snoozed = reminderReducer(empty, { type: "snooze", key, until: NOW + 10 }, clock);
    expect(scan([event()], snoozed)).toEqual([]);
    expect(nextWakeup([event()], snoozed, clock)).toBe(NOW + 10);
    expect(nextWakeup([event()], snoozed, () => NOW + 20)).toBe(NOW + 20);
    const due = dueReminders([event()], { from: NOW + 10, to: NOW + 11 }, snoozed, clock);
    expect(due[0]).toMatchObject({ dueAt: NOW + 10, triggerAt: NOW, revision: 1 });
    const again = reminderReducer(snoozed, { type: "snooze", key, until: NOW + 30 }, clock);
    expect(reminderReducer(again, { type: "deliver", key, revision: 1 }, clock)).toEqual(again);
    expect(reminderReducer(snoozed, { type: "deliver", key, revision: 0 }, clock)).toEqual(snoozed);
    const delivered = reminderReducer(again, { type: "deliver", key, revision: 2 }, clock);
    expect(nextWakeup([event()], delivered, clock)).toBeNull();
    const resnoozed = reminderReducer(delivered, { type: "snooze", key, until: NOW + 50 }, clock);
    expect(nextWakeup([event()], resnoozed, clock)).toBe(NOW + 50);
    expect(again.get(key)).toEqual({ status: "snoozed", until: NOW + 30, revision: 2 });
    expect(snoozed.get(key)).toEqual({ status: "snoozed", until: NOW + 10, revision: 1 });
  });
  it("dismisses pending/snoozed/delivered reminders terminally and idempotently", () => {
    for (const initial of [
      empty,
      state({ status: "snoozed", until: NOW + 1, revision: 1 }),
      state({ status: "delivered", revision: 0 }),
    ]) {
      const dismissed = reminderReducer(initial, { type: "dismiss", key }, clock);
      expect(scan([event()], dismissed)).toEqual([]);
      expect(nextWakeup([event()], dismissed, clock)).toBeNull();
      expect(reminderReducer(dismissed, { type: "dismiss", key }, clock)).toEqual(dismissed);
      const revision = dismissed.get(key)?.revision as number;
      expect(reminderReducer(dismissed, { type: "deliver", key, revision }, clock)).toEqual(
        dismissed,
      );
      fails(
        () => reminderReducer(dismissed, { type: "snooze", key, until: NOW + 1 }, clock),
        "invalid-action",
      );
    }
  });
  it.each([
    null,
    [],
    { type: "unknown", key },
    { type: "dismiss", key: " " },
    { type: "snooze", key, until: NOW },
    { type: "snooze", key, until: NOW - 1 },
    { type: "snooze", key, until: NaN },
    { type: "deliver", key, revision: -1 },
    { type: "deliver", key, revision: 0.1 },
    { type: "deliver", key },
    { type: "deliver", key, revision: 0, until: NOW },
    { type: "dismiss", key, until: NOW },
    { type: "snooze", key, until: NOW + 1, revision: 1 },
    { type: "dismiss", key, extra: true },
  ])("rejects invalid actions %j", (action) => {
    fails(() => reminderReducer(empty, action as ReminderAction, clock), "invalid-action");
  });
  it("rejects revision overflow", () => {
    const full = state({ status: "delivered", revision: Number.MAX_SAFE_INTEGER });
    fails(() => reminderReducer(full, { type: "dismiss", key }, clock), "invalid-state");
    fails(
      () => reminderReducer(full, { type: "snooze", key, until: NOW + 1 }, clock),
      "invalid-state",
    );
  });
  it.each([
    null,
    [],
    { status: "other", revision: 0 },
    { status: "snoozed", revision: 0 },
    { status: "snoozed", revision: 0, until: NaN },
    { status: "delivered", revision: -1 },
    { status: "delivered", revision: 0.1 },
    { status: "delivered", revision: 0, until: undefined },
    { status: "delivered", revision: 0, extra: true },
    { status: "dismissed" },
  ])("rejects malformed state entries %j", (entry) => {
    fails(() => scan([], state(entry)), "invalid-state");
  });
  it("rejects non-Maps and invalid state keys", () => {
    fails(() => scan([], {} as ReminderState), "invalid-state");
    fails(() => scan([], state({ status: "delivered", revision: 0 }, " ")), "invalid-state");
    fails(() => scan([], state({ status: "delivered", revision: 0 }, 1)), "invalid-state");
    fails(() => reminderKey("", "occurrence", "alarm"), "invalid-event");
    fails(() => reminderKey("event", " ", "alarm"), "invalid-event");
    fails(() => reminderKey("event", "occurrence", 1 as unknown as string), "invalid-event");
  });
});

describe("fail closed for malformed events, even outside the window or suppressed", () => {
  it.each([
    null,
    [],
    {},
    { ...event(), id: " " },
    { ...event(), occurrenceId: 1 },
    { ...event(), end: NOW },
    { ...event(), reminders: null },
    { ...event(), rrule: "FREQ=DAILY" },
    { ...event(), reminders: [null] },
    { ...event(), reminders: [{ id: "" }] },
    { ...event(), reminders: [{ ...event().reminders[0], repeat: 1 }] },
  ])("rejects event %j", (value) => {
    fails(() => scan([value as ReminderEvent]), "invalid-event");
  });
  it("rejects invalid end instants, collections and duplicate identities", () => {
    fails(() => scan([{ ...event(), end: NaN }]), "invalid-instant");
    fails(() => scan(null as unknown as ReminderEvent[]), "invalid-event");
    fails(() => scan([event(), event()]), "invalid-event");
    fails(
      () => scan([{ ...event(), reminders: [...event().reminders, ...event().reminders] }]),
      "invalid-event",
    );
  });
  it("validates triggers before applying suppression or filtering", () => {
    const bad = event({ kind: "relative", offset: "P1D" });
    fails(() => dueReminders([bad], { from: 0, to: 1 }, empty, clock), "unsupported-trigger");
    for (const status of ["delivered", "dismissed"] as const) {
      const suppressed = new Map<string, ReminderStatus>([[key, { status, revision: 0 }]]);
      fails(() => scan([bad], suppressed), "unsupported-trigger");
    }
    const error = new ReminderError("invalid-event");
    expect(error.message).toBe("Calendar reminders: invalid-event");
  });
});
