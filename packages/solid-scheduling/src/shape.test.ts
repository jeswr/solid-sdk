// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { serializeCalendar } from "./calendar.js";
import { schedulingProposalsTtl, schedulingShapeTtl } from "./shape.js";
import { schedulingTaskSubject, serializeSchedulingTask } from "./task.js";

const RES = "http://localhost:3000/alice/tasks/x";
const SUBJ = schedulingTaskSubject(RES);

const PREFIXES = `
  @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
  @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(schedulingShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: RES }).parse(ttl));
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

const failedPaths = (report: { results: { path?: { value?: string } }[] }) =>
  report.results.map((r) => String(r.path?.value));

describe("the shipped .ttl artifacts parse", () => {
  it("scheduling.shacl.ttl is well-formed Turtle", () => {
    expect(new Parser().parse(schedulingShapeTtl()).length).toBeGreaterThan(0);
  });

  it("scheduling.proposals.ttl declares fedcon:Proposal candidates", () => {
    const quads = new Parser().parse(schedulingProposalsTtl());
    expect(quads.length).toBeGreaterThan(0);
    const proposals = quads.filter(
      (q) =>
        q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
        q.object.value === "https://jeswr.org/fedcon#Proposal",
    );
    // Five candidates: board-position, labels, task-relations, percent-done, event-reconciliation.
    expect(proposals.length).toBe(5);
  });
});

describe("SHACL shape (scheduling.shacl.ttl)", () => {
  it("a fully-populated task conforms", async () => {
    const ttl = await serializeSchedulingTask(RES, {
      summary: "Ship v1",
      description: "Cut the release",
      dueTime: new Date("2026-07-10T17:00:00.000Z"),
      completed: false,
      organizer: "https://alice.pod.example/profile/card#me",
      calendar: "https://alice.pod.example/calendars/work#it",
      labels: ["urgent"],
      recurrence: { frequency: "WEEKLY", interval: 2 },
      reminders: [{ triggerOffset: "-PT15M" }],
    });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
  });

  it("a minimal task (summary only) conforms with zero results", async () => {
    const ttl = await serializeSchedulingTask(RES, { summary: "Solo" });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it("a minimal calendar conforms", async () => {
    const ttl = await serializeCalendar("http://localhost:3000/alice/calendars/c", {
      summary: "Work",
    });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
  });

  it("a sched:Task with NO summary is non-conforming (summary minCount 1)", async () => {
    const ttl = `${PREFIXES} <${SUBJ}> a sched:Task .`;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("summary"))).toBe(true);
  });

  it("a completed value typed non-boolean is rejected by sh:datatype", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a sched:Task ; sched:summary "T" ; sched:completed "yes"^^xsd:string .`;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("completed"))).toBe(true);
  });

  it("a RecurrenceRule with an unknown frequency is rejected by sh:pattern", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a sched:Task ; sched:summary "T" ; sched:recurrence <${RES}#r> .
      <${RES}#r> a sched:RecurrenceRule ; sched:frequency "FORTNIGHTLY" .`;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("frequency"))).toBe(true);
  });

  it("a RecurrenceRule with NO frequency is non-conforming (minCount 1)", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a sched:Task ; sched:summary "T" ; sched:recurrence <${RES}#r> .
      <${RES}#r> a sched:RecurrenceRule .`;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("frequency"))).toBe(true);
  });

  it("a literal-valued inCalendar is rejected by sh:nodeKind sh:IRI", async () => {
    const ttl = `${PREFIXES}
      <${SUBJ}> a sched:Task ; sched:summary "T" ; sched:inCalendar "not-an-iri" .`;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(failedPaths(report).some((p) => p.endsWith("inCalendar"))).toBe(true);
  });
});
