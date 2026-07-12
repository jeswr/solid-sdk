import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Store, DataFactory, Parser } from "n3";
import env from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { Issue, Comment, Tracker, Activity, Worklog, type WorkflowDef } from "./issue";

const TRACKER = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
const URL_ = "http://localhost:3000/alice/issue-tracker/issues/x.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const AS = "https://www.w3.org/ns/activitystreams#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const TIME = "http://www.w3.org/2006/time#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const shapesTtl = readFileSync("shapes/issue.ttl", "utf8");

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Store/Parser into an env dataset — no serialise round-trip.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}
const shapes = toDataset(new Parser().parse(shapesTtl));

function validate(store: Store) {
  const validator = new SHACLValidator(shapes, { factory: env });
  return validator.validate(toDataset(store));
}

describe("SHACL shape (shapes/issue.ttl)", () => {
  it("a fully-populated issue + comment conforms", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.state = "open";
    issue.title = "Login button overflows on mobile";
    issue.description = "Repro steps included.";
    issue.created = new Date("2026-06-09T10:00:00Z");
    issue.modified = new Date("2026-06-09T10:00:00Z");
    issue.creator = ME;
    issue.assignee = ME;
    issue.priority = "high";
    issue.labels = ["bug", "ui"];
    issue.components = ["auth", "ui"];
    issue.affectsVersion = "v1-0";
    issue.fixVersion = "v2-0";
    issue.dateDue = new Date("2026-07-01");

    const comment = new Comment(`${URL_}#msg-1`, ds, DataFactory);
    comment.markMessage();
    comment.content = "Looking into it.";
    comment.author = ME;
    comment.created = new Date("2026-06-09T11:00:00Z");
    issue.messages.add(comment);

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("flags an issue with no title", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.state = "open";
    issue.created = new Date("2026-06-09T10:00:00Z");

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === "http://purl.org/dc/terms/title")).toBe(true);
  });

  it("flags a comment missing its content", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.state = "open";
    issue.title = "Has a bad comment";
    const comment = new Comment(`${URL_}#msg-1`, ds, DataFactory);
    comment.markMessage();
    comment.author = ME; // no sioc:content
    issue.messages.add(comment);

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
  });

  it("a real open task (rdf:type wf:Task, wf:Open) conforms — the state shape is satisfied", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Investigate flaky CI";
    issue.state = "open"; // emits rdf:type wf:Task + wf:Open
    issue.created = new Date("2026-06-10T09:00:00Z");

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("a closed task conforms (wf:Closed satisfies the state shape too)", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Shipped the fix";
    issue.state = "closed"; // rdf:type wf:Task + wf:Closed
    issue.created = new Date("2026-06-10T09:00:00Z");

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("warns when a wf:Task is typed with neither wf:Open nor wf:Closed", async () => {
    // Untrusted / mid-migration data: a wf:Task that carries no state class. The
    // wrapper never produces this (Issue.state always sets one), so we add the
    // bare type quad directly.
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Stateless task";
    issue.created = new Date("2026-06-10T09:00:00Z");
    ds.addQuad(
      DataFactory.namedNode(`${URL_}#this`),
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(`${WF}Task`),
    );

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    const stateResult = report.results.find((r) => r.path?.value === RDF_TYPE);
    expect(stateResult).toBeDefined();
    // The state constraint is advisory, not fatal: it reports at Warning severity.
    expect(stateResult?.severity?.value).toBe("http://www.w3.org/ns/shacl#Warning");
  });

  it("warns when a wf:Task is typed with BOTH wf:Open AND wf:Closed (qualifiedMaxCount violation)", async () => {
    // A contradictory task: Open and Closed simultaneously. Issue.state prevents
    // this at write time, but sh:qualifiedMaxCount 1 now catches it on read of
    // untrusted data too.
    const ds = new Store();
    const subject = DataFactory.namedNode(`${URL_}#this`);
    ds.addQuad(subject, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}Task`));
    ds.addQuad(subject, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}Open`));
    ds.addQuad(subject, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}Closed`));
    ds.addQuad(
      subject,
      DataFactory.namedNode(`${DCT}title`),
      DataFactory.literal("Contradictory state task"),
    );

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    const stateResult = report.results.find((r) => r.path?.value === RDF_TYPE);
    expect(stateResult).toBeDefined();
    // The shape reports at Warning severity (not Violation) — the caller
    // escalates if desired; see decisions/0003 rationale.
    expect(stateResult?.severity?.value).toBe("http://www.w3.org/ns/shacl#Warning");
  });

  it("flags a non-IRI dct:isPartOf (parent must be an IRI, not a literal)", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Sub-task with a bogus parent";
    issue.state = "open";
    // Malformed read data: a literal where an issue IRI is required.
    ds.addQuad(
      DataFactory.namedNode(`${URL_}#this`),
      DataFactory.namedNode(`${DCT}isPartOf`),
      DataFactory.literal("not-an-iri"),
    );

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${DCT}isPartOf`)).toBe(true);
  });

  it("flags an assignee whose IRI is not http(s)-schemed", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Assigned to a non-web IRI";
    issue.state = "open";
    issue.assignee = "urn:agent:bob"; // a valid IRI (passes nodeKind) but not ^https?://

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${WF}assignee`)).toBe(true);
  });

  it("F2: an issue with all typed links (relation/duplicate/clone) conforms", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Linked issue";
    issue.state = "open";
    issue.relatesTo.add(`${URL_}#r1`);
    issue.relatesTo.add(`${URL_}#r2`);
    issue.duplicateOf = `${URL_}#canonical`;
    issue.clonedFrom = `${URL_}#orig`;

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("F2: flags a non-IRI dct:isReplacedBy (duplicate-of must be an issue IRI)", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Bad duplicate link";
    issue.state = "open";
    ds.addQuad(
      DataFactory.namedNode(`${URL_}#this`),
      DataFactory.namedNode(`${DCT}isReplacedBy`),
      DataFactory.literal("not-an-iri"),
    );
    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${DCT}isReplacedBy`)).toBe(true);
  });

  it("F2: flags more than one prov:wasDerivedFrom (a clone has a single source)", async () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Two clone sources";
    issue.state = "open";
    const subject = DataFactory.namedNode(`${URL_}#this`);
    ds.addQuad(subject, DataFactory.namedNode(`${PROV}wasDerivedFrom`), DataFactory.namedNode(`${URL_}#o1`));
    ds.addQuad(subject, DataFactory.namedNode(`${PROV}wasDerivedFrom`), DataFactory.namedNode(`${URL_}#o2`));
    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${PROV}wasDerivedFrom`)).toBe(true);
  });

  it("a well-formed as:Announce assignment notification conforms", async () => {
    const ds = new Store();
    const note = DataFactory.namedNode(`${URL_}#assign-1`);
    ds.addQuad(note, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${AS}Announce`));
    ds.addQuad(note, DataFactory.namedNode(`${AS}object`), DataFactory.namedNode(`${URL_}#this`));
    ds.addQuad(note, DataFactory.namedNode(`${AS}target`), DataFactory.namedNode(ME));

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("flags an as:Announce notification missing its object", async () => {
    const ds = new Store();
    const note = DataFactory.namedNode(`${URL_}#assign-1`);
    ds.addQuad(note, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${AS}Announce`));
    ds.addQuad(note, DataFactory.namedNode(`${AS}target`), DataFactory.namedNode(ME)); // no as:object

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${AS}object`)).toBe(true);
  });

  it("F1: a tracker with a custom workflow conforms — every state resolves to Open/Closed", async () => {
    const ds = new Store();
    const tracker = new Tracker(TRACKER, ds, DataFactory);
    tracker.configure("Issues");
    const custom: WorkflowDef = {
      statuses: [
        { slug: "backlog", label: "Backlog", terminal: false },
        { slug: "in-progress", label: "In Progress", terminal: false },
        { slug: "in-review", label: "In Review", terminal: false },
        { slug: "done", label: "Done", terminal: true },
      ],
      transitions: { backlog: ["in-progress"], "in-progress": ["in-review"], "in-review": ["done"], done: [] },
    };
    tracker.defineWorkflow(custom);

    const report = await validate(ds);
    // Each wf:State subclasses exactly one of wf:Open/wf:Closed, so the State
    // shape's qualified-exactly-one resolution constraint is satisfied.
    expect(report.conforms).toBe(true);
  });

  it("F1: flags a wf:State that resolves to neither wf:Open nor wf:Closed", async () => {
    // A malformed/foreign status class with no open/closed disposition.
    const ds = new Store();
    const state = DataFactory.namedNode(`${TRACKER.replace("#this", "")}#status-orphan`);
    ds.addQuad(state, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${RDFS}Class`));
    ds.addQuad(state, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}State`));
    ds.addQuad(state, DataFactory.namedNode(`${RDFS}label`), DataFactory.literal("Orphan"));
    // No rdfs:subClassOf wf:Open|wf:Closed at all.

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${RDFS}subClassOf`)).toBe(true);
  });

  it("F1: flags a wf:State that resolves to BOTH wf:Open AND wf:Closed", async () => {
    const ds = new Store();
    const state = DataFactory.namedNode(`${TRACKER.replace("#this", "")}#status-both`);
    ds.addQuad(state, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}State`));
    ds.addQuad(state, DataFactory.namedNode(`${RDFS}subClassOf`), DataFactory.namedNode(`${WF}Open`));
    ds.addQuad(state, DataFactory.namedNode(`${RDFS}subClassOf`), DataFactory.namedNode(`${WF}Closed`));

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${RDFS}subClassOf`)).toBe(true);
  });

  it("F3: a well-formed prov:Activity log entry conforms", async () => {
    const ds = new Store();
    const act = new Activity(`${URL_}#act-1`, ds, DataFactory);
    act.record({
      kind: "status",
      actor: ME,
      at: new Date("2026-06-10T09:00:00.000Z"),
      used: `${TRACKER.replace("#this", "")}#status-todo`,
      generated: `${TRACKER.replace("#this", "")}#status-in-progress`,
    });

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
  });

  it("F3: flags a prov:Activity missing its prov:startedAtTime", async () => {
    const ds = new Store();
    const act = DataFactory.namedNode(`${URL_}#act-2`);
    ds.addQuad(act, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${PROV}Activity`));
    ds.addQuad(act, DataFactory.namedNode(`${PROV}wasAssociatedWith`), DataFactory.namedNode(ME));
    // no prov:startedAtTime

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${PROV}startedAtTime`)).toBe(true);
  });

  it("F3: flags a prov:Activity actor that is not an http(s) IRI", async () => {
    const ds = new Store();
    const act = new Activity(`${URL_}#act-3`, ds, DataFactory);
    act.record({ kind: "assignment", actor: "urn:agent:bob", at: new Date("2026-06-10T09:00:00.000Z") });

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${PROV}wasAssociatedWith`)).toBe(true);
  });

  it("F4: a well-formed worklog entry (+ its time:Duration) conforms", async () => {
    const ds = new Store();
    const entry = new Worklog(`${URL_}#work-1`, ds, DataFactory);
    entry.record({ issueIri: `${URL_}#this`, actor: ME, at: new Date("2026-06-12T09:00:00.000Z"), seconds: 5400, note: "Pairing on the repro." });

    const report = await validate(ds);
    expect(report.conforms).toBe(true);
    // The duration is stored as xsd:decimal seconds (OWL-Time's numericDuration range).
    const decimalQuad = [...ds.match(null, DataFactory.namedNode(`${TIME}numericDuration`))][0];
    const obj = decimalQuad.object;
    expect(obj.termType).toBe("Literal");
    expect((obj as { datatype: { value: string } }).datatype.value).toBe(`${XSD}decimal`);
    expect(obj.value).toBe("5400");
  });

  it("F4: flags a time:Duration missing its numericDuration", async () => {
    const ds = new Store();
    const dur = DataFactory.namedNode(`${URL_}#work-2-dur`);
    ds.addQuad(dur, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${TIME}Duration`));
    ds.addQuad(dur, DataFactory.namedNode(`${TIME}unitType`), DataFactory.namedNode(`${TIME}unitSecond`));
    // no time:numericDuration

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${TIME}numericDuration`)).toBe(true);
  });

  it("F4: flags a time:Duration missing its unitType", async () => {
    const ds = new Store();
    const dur = DataFactory.namedNode(`${URL_}#work-3-dur`);
    ds.addQuad(dur, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${TIME}Duration`));
    ds.addQuad(
      dur,
      DataFactory.namedNode(`${TIME}numericDuration`),
      DataFactory.literal("3600", DataFactory.namedNode(`${XSD}decimal`)),
    );
    // no time:unitType

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${TIME}unitType`)).toBe(true);
  });

  it("F4: flags a time:Duration whose unit is not time:unitSecond", async () => {
    // Seconds is the only supported unit (the reader skips anything else); the shape
    // requires time:unitType = time:unitSecond (sh:hasValue), so a minutes duration
    // can't be written in the first place.
    const ds = new Store();
    const dur = DataFactory.namedNode(`${URL_}#work-5-dur`);
    ds.addQuad(dur, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${TIME}Duration`));
    ds.addQuad(
      dur,
      DataFactory.namedNode(`${TIME}numericDuration`),
      DataFactory.literal("90", DataFactory.namedNode(`${XSD}decimal`)),
    );
    ds.addQuad(dur, DataFactory.namedNode(`${TIME}unitType`), DataFactory.namedNode(`${TIME}unitMinute`)); // NOT unitSecond

    const report = await validate(ds);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${TIME}unitType`)).toBe(true);
  });

  it("F4: a worklog-kind prov:Activity also satisfies the F3 activity shape (used = issue IRI)", async () => {
    // A worklog is a prov:Activity, so the F3 shape (required startedAtTime, single
    // IRI prov:used, http actor) must hold for it too — they coexist on one node.
    const ds = new Store();
    const entry = new Worklog(`${URL_}#work-4`, ds, DataFactory);
    entry.record({ issueIri: `${URL_}#this`, actor: ME, at: new Date("2026-06-12T10:00:00.000Z"), seconds: 1800 });
    const report = await validate(ds);
    expect(report.conforms).toBe(true);
    // No prov:startedAtTime violation, no prov:used cardinality violation.
    expect(report.results.some((r) => r.path?.value === `${PROV}startedAtTime`)).toBe(false);
    expect(report.results.some((r) => r.path?.value === `${PROV}used`)).toBe(false);
  });
});
