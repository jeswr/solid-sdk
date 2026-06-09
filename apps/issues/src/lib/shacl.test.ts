import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Store, DataFactory, Parser } from "n3";
import env from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { Issue, Comment } from "./issue";

const TRACKER = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
const URL_ = "http://localhost:3000/alice/issue-tracker/issues/x.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";

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
});
