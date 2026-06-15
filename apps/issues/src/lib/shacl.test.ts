import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Store, DataFactory, Parser } from "n3";
import env from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { Issue, Comment } from "./issue";

const TRACKER = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
const URL_ = "http://localhost:3000/alice/issue-tracker/issues/x.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const AS = "https://www.w3.org/ns/activitystreams#";

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
});
