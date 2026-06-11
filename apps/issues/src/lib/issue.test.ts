import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import { Issue, Tracker, STATE, safeHttpUrl } from "./issue";
import { rdf, wf, dct } from "./vocab";

const IRI = "http://localhost:3000/alice/issue-tracker/issues.ttl#issue-1";

function newIssue() {
  return new Issue(IRI, new Store(), DataFactory);
}

describe("Issue wrapper", () => {
  it("round-trips scalar properties through typed accessors", () => {
    const issue = newIssue();
    issue.title = "Login button is misaligned";
    issue.description = "On mobile the button overflows.";
    issue.creator = "http://localhost:3000/alice/profile/card#me";
    issue.assignee = "http://localhost:3000/bob/profile/card#me";

    expect(issue.title).toBe("Login button is misaligned");
    expect(issue.description).toBe("On mobile the button overflows.");
    expect(issue.creator).toBe("http://localhost:3000/alice/profile/card#me");
    expect(issue.assignee).toBe("http://localhost:3000/bob/profile/card#me");
  });

  it("reads and writes dates", () => {
    const issue = newIssue();
    const created = new Date("2026-06-09T10:00:00.000Z");
    issue.created = created;
    issue.dateDue = new Date("2026-06-20T00:00:00.000Z");

    expect(issue.created?.toISOString()).toBe(created.toISOString());
    expect(issue.dateDue?.getUTCFullYear()).toBe(2026);
  });

  it("defaults to open and carries state via rdf:type", () => {
    const issue = newIssue();
    issue.state = "open";
    const dataset = (issue as unknown as { dataset: Store }).dataset;

    expect(issue.state).toBe("open");
    expect(issue.isOpen).toBe(true);
    // rdf:type contains wf:Open and wf:Task, not wf:Closed
    const types = [...dataset.match(DataFactory.namedNode(IRI), DataFactory.namedNode(rdf("type")))].map(
      (q) => q.object.value,
    );
    expect(types).toContain(STATE.Open);
    expect(types).toContain(wf("Task"));
    expect(types).not.toContain(STATE.Closed);
  });

  it("toggles state by retyping (open -> closed -> open)", () => {
    const issue = newIssue();
    issue.state = "open";
    issue.state = "closed";
    expect(issue.state).toBe("closed");
    expect(issue.isOpen).toBe(false);

    issue.state = "open";
    expect(issue.state).toBe("open");
  });

  it("clearing an optional property removes the quad", () => {
    const issue = newIssue();
    issue.assignee = "http://localhost:3000/bob/profile/card#me";
    issue.assignee = undefined;
    expect(issue.assignee).toBeUndefined();
  });

  it("exposes its IRI as id", () => {
    expect(newIssue().id).toBe(IRI);
  });

  it("round-trips the issue type (defaults to task)", () => {
    const issue = newIssue();
    issue.tracker = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
    expect(issue.issueType).toBe("task"); // default when untyped
    issue.issueType = "epic";
    expect(issue.issueType).toBe("epic");
    issue.issueType = "bug";
    expect(issue.issueType).toBe("bug"); // replaces, never stacks
  });

  it("links a parent (sub-task) and blockers", () => {
    const issue = newIssue();
    const parent = "http://localhost:3000/alice/issue-tracker/issues/parent.ttl#this";
    const b1 = "http://localhost:3000/alice/issue-tracker/issues/b1.ttl#this";
    const b2 = "http://localhost:3000/alice/issue-tracker/issues/b2.ttl#this";
    issue.parent = parent;
    issue.blockedBy.add(b1);
    issue.blockedBy.add(b2);

    expect(issue.parent).toBe(parent);
    expect([...issue.blockedBy].sort()).toEqual([b1, b2].sort());

    issue.blockedBy.delete(b1);
    issue.parent = undefined;
    expect(issue.parent).toBeUndefined();
    expect([...issue.blockedBy]).toEqual([b2]);
  });

  it("is readable from data parsed independently", () => {
    const store = new Store();
    store.addQuad(
      DataFactory.namedNode(IRI),
      DataFactory.namedNode(dct("title")),
      DataFactory.literal("Parsed issue"),
    );
    store.addQuad(
      DataFactory.namedNode(IRI),
      DataFactory.namedNode(rdf("type")),
      DataFactory.namedNode(STATE.Closed),
    );
    const issue = new Issue(IRI, store, DataFactory);
    expect(issue.title).toBe("Parsed issue");
    expect(issue.state).toBe("closed");
  });
});

describe("Custom fields", () => {
  const DOC = "http://localhost:3000/alice/issue-tracker/tracker.ttl";

  function newTracker() {
    const store = new Store();
    const tracker = new Tracker(`${DOC}#this`, store, DataFactory);
    tracker.configure("Issues");
    return { tracker, store };
  }

  it("defines fields of each type as resolvable fragments of the tracker doc", () => {
    const { tracker } = newTracker();
    const team = tracker.defineField("Team", "text");
    expect(team.iri).toBe(`${DOC}#field-team`);

    const stage = tracker.defineField("Stage", "select", ["Alpha", "Beta"]);
    expect(stage.type).toBe("select");
    expect(stage.options.map((o) => o.label)).toEqual(["Alpha", "Beta"]);
    expect(stage.options[0].iri).toBe(`${DOC}#field-stage-opt-alpha`);

    const defs = tracker.fieldDefs;
    expect(defs.map((f) => f.slug).sort()).toEqual(["stage", "team"]);
    expect(defs.find((f) => f.slug === "stage")?.options.map((o) => o.label)).toEqual(["Alpha", "Beta"]);
  });

  it("round-trips a value of every field type on an issue", () => {
    const { tracker, store } = newTracker();
    const text = tracker.defineField("Team", "text");
    const num = tracker.defineField("Story value", "number");
    const date = tracker.defineField("Launch", "date");
    const url = tracker.defineField("Design doc", "url");
    const select = tracker.defineField("Stage", "select", ["Alpha", "Beta"]);

    const issue = new Issue(IRI, store, DataFactory);
    issue.setField(text, "Platform");
    issue.setField(num, 13);
    issue.setField(date, new Date("2026-07-01T00:00:00.000Z"));
    issue.setField(url, "https://example.org/spec");
    issue.setField(select, select.options[1].iri);

    expect(issue.getField(text)).toBe("Platform");
    expect(issue.getField(num)).toBe(13);
    expect((issue.getField(date) as Date).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(issue.getField(url)).toBe("https://example.org/spec");
    expect(issue.getField(select)).toBe(`${DOC}#field-stage-opt-beta`);

    issue.setField(text, undefined);
    expect(issue.getField(text)).toBeUndefined();
  });

  it("removes a field definition together with its options", () => {
    const { tracker } = newTracker();
    tracker.defineField("Stage", "select", ["Alpha"]);
    tracker.defineField("Team", "text");
    tracker.removeField("stage");
    expect(tracker.fieldDefs.map((f) => f.slug)).toEqual(["team"]);
  });

  it("redefining a slug replaces it cleanly — no stale options or scheme typing", () => {
    const { tracker, store } = newTracker();
    tracker.defineField("Stage", "select", ["Alpha", "Beta"]);
    tracker.defineField("Stage", "select", ["Live"]);
    expect(tracker.fieldDefs.find((f) => f.slug === "stage")?.options.map((o) => o.label)).toEqual(["Live"]);

    // Changing the type drops the SKOS metadata entirely.
    tracker.defineField("Stage", "text");
    const def = tracker.fieldDefs.find((f) => f.slug === "stage");
    expect(def?.type).toBe("text");
    expect(def?.options).toEqual([]);
    const skosQuads = [...store].filter((q) => q.predicate.value.includes("skos") || q.object.value.includes("skos"));
    expect(skosQuads).toEqual([]);
  });
});

describe("safeHttpUrl", () => {
  it("accepts http(s) and rejects everything else", () => {
    expect(safeHttpUrl("https://example.org/spec")).toBe("https://example.org/spec");
    expect(safeHttpUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
     
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,hi")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl("")).toBeUndefined();
  });
});
