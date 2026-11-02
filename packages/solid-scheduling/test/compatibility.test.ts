// AUTHORED-BY Claude Opus 5.5
//
// Pins where parsing through the generated model (Phase S, sst-ild.7.5) differs from the
// hand-written model imported in #279. Each case follows the scheduling SHACL profile:
// required fields fail closed on any non-conforming value, ambiguous or mistyped
// optional values drop, sh:class needs the linked node's rdf:type (rdfs:subClassOf in
// the data graph counts), and a root typed by a data-graph subclass of sched:Task is
// recognised. README "Exact divergences" lists them.
import { Parser, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildCalendar,
  parseCalendar,
  parseSchedulingTask,
  serializeSchedulingTask,
} from "../src/index.js";

const RES = "https://alice.pod.example/tasks/x";

function store(body: string): Store {
  const ttl = `
    @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
    @prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
    ${body}`;
  return new Store(new Parser({ baseIRI: RES }).parse(ttl));
}

const task = (body: string) => parseSchedulingTask(RES, store(body));
const rule = (body: string) =>
  task(`<#it> a sched:Task ; sched:summary "x" ; sched:recurrence <#recurrence> .
        <#recurrence> ${body} .`)?.recurrence;

it("rejects a task whose required summary is not exactly one xsd:string", () => {
  expect(task(`<#it> a sched:Task ; sched:summary "x" .`)?.summary).toBe("x");
  expect(task(`<#it> a sched:Task ; sched:summary "x", "y" .`)).toBeUndefined();
  expect(task(`<#it> a sched:Task ; sched:summary "x"@en .`)).toBeUndefined();
  expect(parseCalendar(RES, store(`<#it> a sched:Calendar ; sched:summary "x", "y" .`))).toBe(
    undefined,
  );
  expect(parseCalendar(RES, store(`<#it> a sched:Calendar ; sched:summary "x"@en .`))).toBe(
    undefined,
  );
});

it("drops an ambiguous or language-tagged description and an xsd:date due time", () => {
  const back = task(`<#it> a sched:Task ; sched:summary "x" ; sched:description "a", "b" ;
    sched:dueTime "2026-07-10"^^xsd:date .`);
  expect(back).toEqual({ summary: "x" });
  expect(task(`<#it> a sched:Task ; sched:summary "x" ; sched:description "a"@en .`)).toEqual({
    summary: "x",
  });
});

it("reads a recurrence only when it is one typed rule with one canonical frequency", () => {
  expect(rule(`a sched:RecurrenceRule ; sched:frequency "WEEKLY"`)).toEqual({
    frequency: "WEEKLY",
  });
  expect(rule(`a sched:RecurrenceRule ; sched:frequency "weekly"`)).toBeUndefined();
  expect(rule(`sched:frequency "WEEKLY"`)).toBeUndefined();
  expect(rule(`a sched:RecurrenceRule ; sched:frequency "WEEKLY", "DAILY"`)).toBeUndefined();
  expect(
    task(`<#it> a sched:Task ; sched:summary "x" ; sched:recurrence <#recurrence>, <#r2> .
          <#recurrence> a sched:RecurrenceRule ; sched:frequency "WEEKLY" .
          <#r2> a sched:RecurrenceRule ; sched:frequency "DAILY" .`)?.recurrence,
  ).toBeUndefined();
});

it("drops an interval that is not typed xsd:positiveInteger", () => {
  expect(rule(`a sched:RecurrenceRule ; sched:frequency "WEEKLY" ; sched:interval 2`)).toEqual({
    frequency: "WEEKLY",
  });
});

it("recognises a root typed by a data-graph subclass of sched:Task", () => {
  expect(
    task(`<https://e.example/Sub> rdfs:subClassOf sched:Task .
          <#it> a <https://e.example/Sub> ; sched:summary "x" .`),
  ).toEqual({ summary: "x" });
});

it("writes an empty summary, so the document reads back", async () => {
  const ttl = await serializeSchedulingTask(RES, { summary: "" });
  expect(parseSchedulingTask(RES, new Store(new Parser({ baseIRI: RES }).parse(ttl)))).toEqual({
    summary: "",
  });
});

it("strips control characters from written text in both graphs", async () => {
  const ttl = await serializeSchedulingTask(RES, { summary: "a\u0000b", description: "d\u0001e" });
  const quads = new Parser({ baseIRI: RES }).parse(ttl);
  const text = (p: string) =>
    quads.filter((q) => q.predicate.value === p).map((q) => q.object.value);
  expect(text("https://w3id.org/jeswr/sectors/scheduling#summary")).toEqual(["ab"]);
  expect(text("http://purl.org/dc/terms/title")).toEqual(["ab"]);
  expect(text("https://w3id.org/jeswr/sectors/scheduling#description")).toEqual(["de"]);
  expect(quads.some((q) => q.object.value.includes("\u0001"))).toBe(false);
});

it("rejects an unsafe or relative resource URL", async () => {
  expect(() => serializeSchedulingTask("https://a.example/x y", { summary: "x" })).toThrow(
    TypeError,
  );
  expect(() => buildCalendar("tasks/x", { summary: "x" })).toThrow(TypeError);
  expect(parseSchedulingTask("tasks/x", store(`<#it> a sched:Task ; sched:summary "x" .`))).toBe(
    undefined,
  );
});

it("rejects a non-string summary and recognises Calendar subclasses", () => {
  expect(task(`<#it> a sched:Task ; sched:summary 5 .`)).toBeUndefined();
  expect(task(`<#it> a sched:Task ; sched:summary <https://e.example/s> .`)).toBeUndefined();
  expect(
    parseCalendar(
      RES,
      store(`<https://e.example/Cal> rdfs:subClassOf sched:Calendar .
             <#it> a <https://e.example/Cal> ; sched:summary "x" .`),
    ),
  ).toEqual({ summary: "x" });
});

it("drops a padded or out-of-range positiveInteger", () => {
  expect(
    rule(
      `a sched:RecurrenceRule ; sched:frequency "WEEKLY" ; sched:interval " 2"^^xsd:positiveInteger`,
    ),
  ).toEqual({ frequency: "WEEKLY" });
  expect(
    rule(
      `a sched:RecurrenceRule ; sched:frequency "WEEKLY" ; sched:count "99999999999999999999"^^xsd:positiveInteger`,
    ),
  ).toEqual({ frequency: "WEEKLY" });
});
