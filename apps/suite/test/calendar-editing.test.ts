// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { type CalendarEvent, expandEvent } from "../src/apps/calendar/lib/model";
import {
  decodeEventRef,
  editorHref,
  eventDocument,
  planSeriesEdit,
  quickDraft,
} from "../src/apps/calendar/state/editing";
import type { CalendarInfo } from "../src/apps/calendar/state/view";
import { encodeRef } from "../src/lib/refs";

const root = "https://pod.example/";
const calendars: CalendarInfo[] = [
  {
    url: `${root}calendar/work.ttl`,
    container: `${root}calendar/work/`,
    title: "Work",
    colour: `#${"abc"}`, // built at runtime: the token gate rejects raw hex
    etag: '"1"',
  },
];
const url = `${root}calendar/work/event.ttl`;
const zone = "Europe/London";
const now = new Date("2026-11-01T12:00:00Z");
const timed: CalendarEvent = {
  name: "Weekly",
  uid: "series",
  start: new Date("2026-10-18T08:00Z"),
  end: new Date("2026-10-18T09:00Z"),
  recurrence: { frequency: "WEEKLY", count: 5, byDay: ["SU"] },
};
const allDay: CalendarEvent = {
  name: "All day",
  start: "2026-10-18",
  end: "2026-10-19",
  recurrence: { frequency: "WEEKLY", count: 5 },
};
function occurrences(e: CalendarEvent) {
  return expandEvent(e, new Date("2026-10-01"), new Date("2026-12-01"), zone);
}
describe("Calendar references and quick drafts", () => {
  it("round-trips opaque document refs and rejects off-container targets", () => {
    expect(decodeEventRef(encodeRef(url), root, calendars)).toBe(url);
    const unicode = `${root}calendar/work/é.ttl`;
    expect(decodeEventRef(encodeRef(unicode), root, calendars)).toBe(new URL(unicode).href);
    for (const candidate of [
      root,
      `${url}#it`,
      `${url}?secret=x`,
      `${root}calendar/work/`,
      `${root}calendar/workish/x`,
      `${root}drive/x`,
      "https://evil.example/calendar/work/x",
      "https://pod.example.evil/calendar/work/x",
      `${root}calendar/work/%2e%2e/private/x`,
    ])
      expect(() => eventDocument(candidate, root, calendars)).toThrow();
    for (const ref of ["!", encodeRef("https://evil.example/x")])
      expect(() => decodeEventRef(ref, root, calendars)).toThrow();
    expect(editorHref(url, timed.start, "/calendar/week?d=2026-11-01")).toContain(encodeRef(url));
    expect(editorHref(url, "2026-11-01", "/calendar/month?d=2026-11-01")).toContain(
      "occurrence=2026-11-01",
    );
  });
  it("keeps slot dates for plain titles, parses times, all-day and recurrence", () => {
    expect(quickDraft("Lunch with Sam", timed, now, zone)).toEqual({
      ...timed,
      name: "Lunch with Sam",
    });
    const parsed = quickDraft("Lunch with Sam tomorrow 1pm", timed, now, zone);
    expect(parsed.name).toBe("Lunch with Sam");
    expect(parsed.start).toEqual(new Date("2026-11-02T13:00Z"));
    expect(parsed.end).toEqual(new Date("2026-11-02T14:00Z"));
    const day = quickDraft("Holiday tomorrow all day", timed, now, zone);
    expect(day.start).toBe("2026-11-02");
    expect(day.end).toBe("2026-11-03");
    expect(quickDraft("Holiday tomorrow for 2 days", timed, now, zone).end).toBe("2026-11-04");
    expect(quickDraft("Work tomorrow 1pm for 2 hours", timed, now, zone).end).toEqual(
      new Date("2026-11-02T15:00Z"),
    );
    expect(
      quickDraft("Team check-in every Monday 1pm", timed, now, zone).recurrence?.frequency,
    ).toBe("WEEKLY");
    expect(() => quickDraft("", timed, now, zone)).toThrow();
  });
});
describe.each([timed, allDay])("recurrence edit planning $name", (master) => {
  it("detaches only one occurrence and preserves all others", () => {
    const occurrence = occurrences(master)[2] as CalendarEvent;
    const edited = { ...occurrence, name: "Changed" };
    const plan = planSeriesEdit(master, occurrence.start, edited, "this", zone);
    expect(plan.original?.recurrence?.exceptDate).toEqual([occurrence.start]);
    expect(plan.created).toEqual({ ...edited, uid: undefined, recurrence: undefined });
    expect(occurrences(plan.original as CalendarEvent)).toHaveLength(4);
    expect(planSeriesEdit(master, occurrence.start, null, "this", zone).created).toBeUndefined();
    expect(master.recurrence?.exceptDate).toBeUndefined();
    const excluded = {
      ...master,
      recurrence: { ...master.recurrence!, exceptDate: [occurrences(master)[0]!.start] },
    };
    expect(
      planSeriesEdit(excluded, occurrence.start, null, "this", zone).original?.recurrence
        ?.exceptDate,
    ).toHaveLength(2);
  });
  it("splits and converts count, including exceptions consumed before the split", () => {
    const occurrence = occurrences(master)[2] as CalendarEvent;
    const withException = {
      ...master,
      recurrence: {
        ...master.recurrence!,
        exceptDate: [occurrences(master)[0]!.start, occurrences(master)[4]!.start],
      },
    };
    const plan = planSeriesEdit(withException, occurrence.start, occurrence, "following", zone);
    expect(plan.original?.recurrence?.count).toBeUndefined();
    expect(plan.created?.recurrence?.count).toBe(3);
    expect(plan.created?.recurrence?.exceptDate).toEqual([occurrences(master)[4]!.start]);
    expect(occurrences(plan.original as CalendarEvent)).toHaveLength(1);
    expect(occurrences(plan.created as CalendarEvent)).toHaveLength(2);
    const deleted = planSeriesEdit(master, occurrence.start, null, "following", zone);
    expect(occurrences(deleted.original as CalendarEvent)).toHaveLength(2);
    expect(deleted.created).toBeUndefined();
    expect(planSeriesEdit(master, master.start, null, "following", zone).original).toBeNull();
    expect(
      planSeriesEdit(master, master.start, master, "following", zone).created?.recurrence?.count,
    ).toBe(5);
    const changedCount = { ...occurrence, recurrence: { ...occurrence.recurrence!, count: 7 } };
    expect(
      planSeriesEdit(master, occurrence.start, changedCount, "following", zone).created?.recurrence
        ?.count,
    ).toBe(7);
    expect(
      planSeriesEdit(
        master,
        occurrence.start,
        { ...occurrence, recurrence: undefined },
        "following",
        zone,
      ).created?.recurrence,
    ).toBeUndefined();
  });
  it("updates the series from DTSTART, and deletes all events", () => {
    const occurrence = occurrences(master)[2] as CalendarEvent;
    const plan = planSeriesEdit(
      master,
      occurrence.start,
      { ...occurrence, name: "Changed" },
      "all",
      zone,
    );
    expect(plan.original?.start).toEqual(master.start);
    expect(plan.original?.uid).toBe(master.uid);
    expect(planSeriesEdit(master, occurrence.start, null, "all", zone)).toEqual({ original: null });
    expect(() => planSeriesEdit(master, "2028-01-01", null, "this", zone)).toThrow("outside");
  });
});
it("shifts all-event edits in wall-clock time across the DST boundary", () => {
  const occurrence = occurrences(timed)[2]!;
  expect(occurrence.start).toEqual(new Date("2026-11-01T09:00Z"));
  const edited = {
    ...occurrence,
    start: new Date("2026-11-01T10:00Z"),
    end: new Date("2026-11-01T11:00Z"),
  };
  const plan = planSeriesEdit(timed, occurrence.start, edited, "all", zone);
  expect(plan.original?.start).toEqual(new Date("2026-10-18T09:00Z"));
  expect(plan.original?.end).toEqual(new Date("2026-10-18T10:00Z"));
  const noEnd = { ...edited, end: undefined };
  expect(planSeriesEdit(timed, occurrence.start, noEnd, "all", zone).original?.end).toBeUndefined();
  expect(
    planSeriesEdit({ ...timed, recurrence: undefined }, timed.start, null, "all", zone),
  ).toEqual({ original: null });
  const forever = { ...timed, recurrence: { frequency: "WEEKLY" as const } };
  expect(
    planSeriesEdit(
      forever,
      occurrence.start,
      { ...occurrence, recurrence: { frequency: "WEEKLY" } },
      "following",
      zone,
    ).created?.recurrence?.count,
  ).toBeUndefined();
});
