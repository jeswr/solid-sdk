// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  type CalendarData,
  calendarSubject,
  parseCalendar,
  parseCalendarTtl,
  serializeCalendar,
} from "./calendar.js";
import { CALENDAR_CLASS, RDF_TYPE } from "./vocab.js";

const RES = "https://alice.pod.example/calendars/work";
const OWNER = "https://alice.pod.example/profile/card#me";

async function roundTrip(data: CalendarData): Promise<CalendarData | undefined> {
  const ttl = await serializeCalendar(RES, data);
  return parseCalendarTtl(RES, ttl, "text/turtle");
}

describe("Calendar round-trip", () => {
  it("round-trips a full calendar", async () => {
    const out = await roundTrip({ summary: "Work", description: "Day job", organizer: OWNER });
    expect(out).toEqual({ summary: "Work", description: "Day job", organizer: OWNER });
  });

  it("round-trips a minimal calendar (summary only)", async () => {
    const out = await roundTrip({ summary: "Personal" });
    expect(out).toEqual({ summary: "Personal" });
  });

  it("marks #it a sched:Calendar", () => {
    const store = buildCalendar(RES, { summary: "C" });
    const typed = [...store].some(
      (q) =>
        q.subject.value === calendarSubject(RES) &&
        q.predicate.value === RDF_TYPE &&
        q.object.value === CALENDAR_CLASS,
    );
    expect(typed).toBe(true);
  });

  it("drops a non-http(s) organizer", async () => {
    const out = await roundTrip({ summary: "C", organizer: "javascript:alert(1)" });
    expect(out?.organizer).toBeUndefined();
  });

  it("returns undefined for a non-Calendar / summary-less document", async () => {
    expect(
      await parseCalendarTtl(RES, `<${RES}#it> <http://x/p> "y" .`, "text/turtle"),
    ).toBeUndefined();
    const noSummary = `@prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> . <${RES}#it> a sched:Calendar .`;
    expect(await parseCalendarTtl(RES, noSummary, "text/turtle")).toBeUndefined();
  });

  it("parseCalendar reads directly from a store/dataset", () => {
    const store = buildCalendar(RES, { summary: "Direct" });
    expect(parseCalendar(RES, store)?.summary).toBe("Direct");
  });
});
