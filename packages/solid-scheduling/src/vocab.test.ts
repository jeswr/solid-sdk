// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ACCEPTED,
  ATTENDANCE_STATUS,
  CALENDAR_CLASS,
  CALENDAR_EVENT_CLASS,
  CORE,
  DCT_SUBJECT,
  PREFIXES,
  RDF_TYPE,
  RECURRENCE_RULE_CLASS,
  REMINDER_CLASS,
  SCHED,
  SCHED_DUE_TIME,
  SCHED_SUMMARY,
  sched,
  TASK_CLASS,
  XSD_DURATION,
  XSD_POSITIVE_INTEGER,
} from "./vocab.js";

describe("vocab IRIs", () => {
  it("reuses the scheduling sector + core namespaces (nothing minted here)", () => {
    expect(SCHED).toBe("https://w3id.org/jeswr/sectors/scheduling#");
    expect(CORE).toBe("https://w3id.org/jeswr/core#");
  });

  it("names the reused scheduling classes", () => {
    expect(TASK_CLASS).toBe("https://w3id.org/jeswr/sectors/scheduling#Task");
    expect(CALENDAR_CLASS).toBe("https://w3id.org/jeswr/sectors/scheduling#Calendar");
    expect(CALENDAR_EVENT_CLASS).toBe("https://w3id.org/jeswr/sectors/scheduling#CalendarEvent");
    expect(RECURRENCE_RULE_CLASS).toBe("https://w3id.org/jeswr/sectors/scheduling#RecurrenceRule");
    expect(REMINDER_CLASS).toBe("https://w3id.org/jeswr/sectors/scheduling#Reminder");
  });

  it("names the reused predicates + the reuse-before-mint label term", () => {
    expect(SCHED_SUMMARY).toBe("https://w3id.org/jeswr/sectors/scheduling#summary");
    expect(SCHED_DUE_TIME).toBe("https://w3id.org/jeswr/sectors/scheduling#dueTime");
    expect(DCT_SUBJECT).toBe("http://purl.org/dc/terms/subject");
    expect(RDF_TYPE).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    expect(XSD_POSITIVE_INTEGER).toBe("http://www.w3.org/2001/XMLSchema#positiveInteger");
    expect(XSD_DURATION).toBe("http://www.w3.org/2001/XMLSchema#duration");
  });

  it("the sched() builder concatenates onto the sector namespace", () => {
    expect(sched("Task")).toBe(TASK_CLASS);
  });

  it("exposes the RSVP status table keyed by lowercase token", () => {
    expect(ATTENDANCE_STATUS.accepted).toBe(ATTENDANCE_ACCEPTED);
    expect(ATTENDANCE_STATUS.accepted).toBe("https://w3id.org/jeswr/sectors/scheduling#Accepted");
    expect(Object.keys(ATTENDANCE_STATUS).sort()).toEqual([
      "accepted",
      "declined",
      "needs-action",
      "tentative",
    ]);
  });

  it("the RSVP status table is frozen (a consumer cannot mutate the shared table)", () => {
    expect(Object.isFrozen(ATTENDANCE_STATUS)).toBe(true);
  });

  it("every PREFIXES value is an absolute IRI ending in # or /", () => {
    expect(PREFIXES.sched).toBe(SCHED);
    for (const ns of Object.values(PREFIXES)) {
      expect(ns).toMatch(/^https?:\/\/.+[#/]$/);
    }
  });
});
