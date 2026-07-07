// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  buildSchedulingTask,
  parseSchedulingTask,
  parseSchedulingTaskTtl,
  type SchedulingTaskData,
  schedulingNodeIris,
  schedulingTaskSubject,
  serializeSchedulingTask,
} from "./task.js";
import {
  RDF_TYPE,
  RECURRENCE_RULE_CLASS,
  SCHED_INTERVAL,
  SCHED_RECURRENCE,
  SCHED_TRIGGER_OFFSET,
  TASK_CLASS,
  XSD_DURATION,
  XSD_POSITIVE_INTEGER,
} from "./vocab.js";

const RES = "https://alice.pod.example/tasks/ship-v1";
const OWNER = "https://alice.pod.example/profile/card#me";
const BOB = "https://bob.pod.example/profile/card#me";

async function roundTrip(data: SchedulingTaskData): Promise<SchedulingTaskData | undefined> {
  const ttl = await serializeSchedulingTask(RES, data);
  return parseSchedulingTaskTtl(RES, ttl, "text/turtle");
}

describe("buildSchedulingTask + parse round-trip", () => {
  it("round-trips a fully-populated task", async () => {
    const data: SchedulingTaskData = {
      summary: "Ship v1",
      description: "Cut the release",
      startTime: new Date("2026-07-01T09:00:00.000Z"),
      dueTime: new Date("2026-07-10T17:00:00.000Z"),
      completed: false,
      organizer: OWNER,
      assignee: BOB,
      calendar: "https://alice.pod.example/calendars/work#it",
      priority: "high",
      position: 3,
      labels: ["backlog", "urgent"],
      recurrence: { frequency: "WEEKLY", interval: 2, count: 5 },
      reminders: [
        { triggerOffset: "-PT15M" },
        { triggerTime: new Date("2026-07-10T08:00:00.000Z") },
      ],
    };
    const out = await roundTrip(data);
    expect(out).toBeDefined();
    expect(out?.summary).toBe("Ship v1");
    expect(out?.description).toBe("Cut the release");
    expect(out?.dueTime?.toISOString()).toBe("2026-07-10T17:00:00.000Z");
    expect(out?.startTime?.toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(out?.completed).toBe(false);
    expect(out?.organizer).toBe(OWNER);
    expect(out?.assignee).toBe(BOB);
    expect(out?.calendar).toBe("https://alice.pod.example/calendars/work#it");
    expect(out?.priority).toBe("high");
    expect(out?.position).toBe(3);
    expect(out?.labels?.sort()).toEqual(["backlog", "urgent"]);
    expect(out?.recurrence).toEqual({ frequency: "WEEKLY", interval: 2, count: 5 });
    expect(out?.reminders).toHaveLength(2);
  });

  it("round-trips a minimal task (summary only)", async () => {
    const out = await roundTrip({ summary: "Just do it" });
    expect(out).toBeDefined();
    expect(out?.summary).toBe("Just do it");
    expect(out?.assignee).toBeUndefined();
    expect(out?.recurrence).toBeUndefined();
    expect(out?.reminders).toBeUndefined();
  });

  it("defaults completedAt to now when closing", async () => {
    const before = Date.now();
    const out = await roundTrip({ summary: "Done thing", completed: true });
    expect(out?.completed).toBe(true);
    expect(out?.completedAt).toBeInstanceOf(Date);
    expect(out?.completedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before - 1000);
  });

  it("uses the #it subject shared with wf:Task", () => {
    expect(schedulingTaskSubject(RES)).toBe(`${RES}#it`);
    expect(schedulingNodeIris(RES).task).toBe(`${RES}#it`);
    expect(schedulingNodeIris(RES).recurrence).toBe(`${RES}#recurrence`);
  });
});

describe("the built document carries sched:Task + typed literals", () => {
  it("marks #it a sched:Task", async () => {
    const ttl = await serializeSchedulingTask(RES, { summary: "T" });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const typed = [...ds].some(
      (q) =>
        q.subject.value === `${RES}#it` &&
        q.predicate.value === RDF_TYPE &&
        q.object.value === TASK_CLASS,
    );
    expect(typed).toBe(true);
  });

  it("writes sched:interval as xsd:positiveInteger (not xsd:integer)", async () => {
    const ttl = await serializeSchedulingTask(RES, {
      summary: "T",
      recurrence: { frequency: "DAILY", interval: 3 },
    });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const interval = [...ds].find((q) => q.predicate.value === SCHED_INTERVAL);
    expect(interval?.object.value).toBe("3");
    // biome-ignore lint/suspicious/noExplicitAny: n3 literal has .datatype
    expect((interval?.object as any).datatype?.value).toBe(XSD_POSITIVE_INTEGER);
  });

  it("writes sched:triggerOffset as xsd:duration", async () => {
    const ttl = await serializeSchedulingTask(RES, {
      summary: "T",
      reminders: [{ triggerOffset: "-PT30M" }],
    });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const off = [...ds].find((q) => q.predicate.value === SCHED_TRIGGER_OFFSET);
    expect(off?.object.value).toBe("-PT30M");
    // biome-ignore lint/suspicious/noExplicitAny: n3 literal has .datatype
    expect((off?.object as any).datatype?.value).toBe(XSD_DURATION);
  });
});

describe("untrusted-input hardening", () => {
  it("drops a non-http(s) organizer / calendar rather than coercing it", async () => {
    const out = await roundTrip({
      summary: "T",
      organizer: "javascript:alert(1)",
      calendar: "data:text/html,x",
    });
    expect(out?.organizer).toBeUndefined();
    expect(out?.calendar).toBeUndefined();
  });

  it("drops a non-http(s) assignee (federation WebID) via the shared wf model", async () => {
    const out = await roundTrip({ summary: "T", assignee: "not-a-url" });
    expect(out?.assignee).toBeUndefined();
  });

  it("drops an invalid interval / count (must be a positive integer)", async () => {
    const out = await roundTrip({
      summary: "T",
      recurrence: { frequency: "WEEKLY", interval: 0, count: -3 },
    });
    expect(out?.recurrence?.frequency).toBe("WEEKLY");
    expect(out?.recurrence?.interval).toBeUndefined();
    expect(out?.recurrence?.count).toBeUndefined();
  });

  it("drops an unknown recurrence frequency (whole recurrence is not usable)", async () => {
    const out = await roundTrip({
      summary: "T",
      // biome-ignore lint/suspicious/noExplicitAny: intentionally passing a bad value
      recurrence: { frequency: "FORTNIGHTLY" as any, interval: 1 },
    });
    expect(out?.recurrence).toBeUndefined();
  });

  it("an invalid frequency leaves NO orphan recurrence node + no link (SHACL-safe)", () => {
    const store = buildSchedulingTask(RES, {
      summary: "T",
      // biome-ignore lint/suspicious/noExplicitAny: intentionally passing a bad value
      recurrence: { frequency: "FORTNIGHTLY" as any, interval: 1 },
    });
    const quads = [...store];
    // No sched:recurrence link, and no sched:RecurrenceRule node was created.
    expect(quads.some((q) => q.predicate.value === SCHED_RECURRENCE)).toBe(false);
    expect(
      quads.some((q) => q.predicate.value === RDF_TYPE && q.object.value === RECURRENCE_RULE_CLASS),
    ).toBe(false);
    // No orphan node under the #recurrence subject at all.
    expect(quads.some((q) => q.subject.value === `${RES}#recurrence`)).toBe(false);
  });

  it("drops a week-form duration (P1W — invalid xsd:duration in XSD 1.1)", async () => {
    const out = await roundTrip({
      summary: "T",
      reminders: [{ triggerOffset: "P1W" }, { triggerOffset: "-P7D" }],
    });
    // The week-form reminder carries nothing valid → dropped; the day-form survives.
    expect(out?.reminders).toHaveLength(1);
    expect(out?.reminders?.[0]?.triggerOffset).toBe("-P7D");
  });

  it("drops an Invalid Date (never throws / aborts the build)", async () => {
    const out = await roundTrip({
      summary: "T",
      dueTime: new Date("nonsense"),
      reminders: [{ triggerTime: new Date("also-bad") }],
    });
    expect(out?.summary).toBe("T");
    expect(out?.dueTime).toBeUndefined();
    expect(out?.reminders).toBeUndefined();
  });

  it("drops a malformed triggerOffset (not a well-formed xsd:duration)", async () => {
    const out = await roundTrip({
      summary: "T",
      reminders: [{ triggerOffset: "15 minutes" }, { triggerOffset: "-PT10M" }],
    });
    // The malformed offset reminder carries nothing → dropped; only the valid one survives.
    expect(out?.reminders).toHaveLength(1);
    expect(out?.reminders?.[0]?.triggerOffset).toBe("-PT10M");
  });

  it("a malformed foreign literal drops the field, never aborts the parse", async () => {
    // dueTime: a lexically-invalid dateTime → Invalid Date → dropped.
    // completed: the WRONG datatype (xsd:string, not xsd:boolean) → the typed
    // accessor throws → tryRead drops it. Both drop; the summary still parses.
    const ttl = `
      @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${RES}#it> a sched:Task ;
        sched:summary "Survivor" ;
        sched:dueTime "not-a-date"^^xsd:dateTime ;
        sched:completed "notbool"^^xsd:string .
    `;
    const out = await parseSchedulingTaskTtl(RES, ttl, "text/turtle");
    expect(out?.summary).toBe("Survivor");
    expect(out?.dueTime).toBeUndefined();
    expect(out?.completed).toBeUndefined();
  });

  it("returns undefined for a document that is not a sched:Task", async () => {
    const ttl = `<${RES}#it> <http://example.org/p> "x" .`;
    expect(await parseSchedulingTaskTtl(RES, ttl, "text/turtle")).toBeUndefined();
  });

  it("returns undefined for a sched:Task with no summary", async () => {
    const ttl = `
      @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
      <${RES}#it> a sched:Task .
    `;
    expect(await parseSchedulingTaskTtl(RES, ttl, "text/turtle")).toBeUndefined();
  });

  it("coalesces a null content-type to text/turtle", async () => {
    const ttl = await serializeSchedulingTask(RES, { summary: "T" });
    const out = await parseSchedulingTaskTtl(RES, ttl, null);
    expect(out?.summary).toBe("T");
  });
});

describe("parseSchedulingTask over a dataset", () => {
  it("reads directly from a DatasetCore", async () => {
    const ttl = await serializeSchedulingTask(RES, { summary: "Direct", priority: "low" });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const out = parseSchedulingTask(RES, ds);
    expect(out?.summary).toBe("Direct");
    expect(out?.priority).toBe("low");
  });
});
