// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { taskShapeTtl } from "./shape.js";
import { buildTask, serializeTask, type TaskData } from "./task.js";

const URL_ = "http://localhost:3000/alice/issues/x";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Parser/Store into an env dataset — the exact pattern
// solid-issues' shape test uses, so verdicts match across the suite.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(taskShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: URL_ }).parse(ttl));
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

describe("SHACL shape (shapes/task.ttl)", () => {
  it("a fully-populated, well-formed task conforms", async () => {
    const data: TaskData = {
      title: "Login button overflows on mobile",
      description: "Repro steps included.",
      state: "open",
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-09T11:00:00.000Z"),
      creator: ME,
      assignee: BOB,
      project: "http://localhost:3000/alice/issues/tracker.ttl#this",
      dueDate: new Date("2026-07-01T00:00:00.000Z"),
      rank: 5,
      blockedBy: ["http://localhost:3000/alice/issues/dep"],
    };
    const report = await validateTtl(await serializeTask(URL_, data));
    expect(report.conforms).toBe(true);
  });

  it("a minimal task (title + open state) conforms", async () => {
    const report = await validateTtl(
      await serializeTask(URL_, { title: "Minimal", state: "open" }),
    );
    expect(report.conforms).toBe(true);
  });

  it("a closed task with prov:endedAtTime conforms", async () => {
    const report = await validateTtl(await serializeTask(URL_, { title: "Done", state: "closed" }));
    expect(report.conforms).toBe(true);
  });

  it("a task with NO title is non-conforming (title is required)", async () => {
    // Build with an empty title (dropped on write), then validate — minCount 1 fails.
    const report = await validateTtl(await serializeTask(URL_, { title: "", state: "open" }));
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("title"))).toBe(true);
  });

  it("a non-http(s) assignee is rejected by the sh:pattern", async () => {
    // Hand-craft an assignee IRI with a urn: scheme (the writer would drop it, so
    // we validate raw Turtle to exercise the shape directly).
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ;
        dct:title "Bad assignee" ;
        wf:assignee <urn:agent:bob> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("assignee"))).toBe(true);
  });

  it("a task typed BOTH wf:Open and wf:Closed warns (exactly-one-state rule)", async () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open, wf:Closed ;
        dct:title "Contradictory state" .
    `;
    const report = await validateTtl(ttl);
    // The state shape is sh:Warning severity → a result, but advisory.
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.some((r) => String(r.severity?.value).endsWith("Warning"))).toBe(true);
  });

  it("a Pod Manager-style dct:description body conforms", async () => {
    // PM writes the body as dct:description (solid-issues uses wf:description).
    // The shape constrains BOTH predicates, so a well-formed PM body conforms.
    const pmTtl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ;
        dct:title "PM body" ;
        dct:description "Body written by the Pod Manager." .
    `;
    expect((await validateTtl(pmTtl)).conforms).toBe(true);
  });

  it("two dct:description values are non-conforming (maxCount 1 on the DC predicate)", async () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ;
        dct:title "Two bodies" ;
        dct:description "first" ;
        dct:description "second" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("description"))).toBe(true);
  });

  it("the Pod Manager + solid-issues wire formats both conform (federation contract)", async () => {
    const pmTtl = `
      @prefix wf:   <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a wf:Task, wf:Open ;
        dct:title "PM issue" ;
        dct:created "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        wf:assignee <${ME}> .
    `;
    const siTtl = `
      @prefix wf:   <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ;
        dct:title "solid-issues task" ;
        wf:description "body" ;
        wf:tracker <http://localhost:3000/alice/issues/tracker.ttl#this> ;
        dct:creator <${ME}> .
    `;
    expect((await validateTtl(pmTtl)).conforms).toBe(true);
    expect((await validateTtl(siTtl)).conforms).toBe(true);
  });

  it("buildTask output conforms without serialising (store → dataset)", async () => {
    const store = buildTask(URL_, { title: "Direct store", state: "open", assignee: ME });
    const report = await new SHACLValidator(shapes, { factory: env }).validate(toDataset(store));
    expect(report.conforms).toBe(true);
  });
});
