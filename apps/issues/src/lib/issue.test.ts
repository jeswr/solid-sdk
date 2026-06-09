import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import { Issue, STATE } from "./issue";
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
