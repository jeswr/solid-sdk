import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import {
  Issue,
  Tracker,
  Activity,
  ActivityLog,
  STATE,
  STATUSES,
  DEFAULT_WORKFLOW,
  canTransition,
  statusState,
  safeHttpUrl,
  ISSUE_TYPES,
  typeLevel,
  canNest,
  type IssueType,
  type WorkflowDef,
} from "./issue";
import { rdf, wf, dct, prov, rdfs } from "./vocab";

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

  it("stamps prov:endedAtTime when closed and clears it on reopen", () => {
    const issue = newIssue();
    issue.status = "done";
    const ended = issue.endedAt;
    expect(ended).toBeInstanceOf(Date);

    // Re-asserting a terminal status keeps the original completion time.
    issue.status = "done";
    expect(issue.endedAt?.toISOString()).toBe(ended!.toISOString());

    issue.status = "todo";
    expect(issue.endedAt).toBeUndefined();
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

  it("F2: round-trips typed links (relates / duplicate-of / cloned-from) to the right predicates", () => {
    const issue = newIssue();
    const r1 = "http://localhost:3000/alice/issue-tracker/issues/r1.ttl#this";
    const r2 = "http://localhost:3000/alice/issue-tracker/issues/r2.ttl#this";
    const orig = "http://localhost:3000/alice/issue-tracker/issues/orig.ttl#this";
    const canonical = "http://localhost:3000/alice/issue-tracker/issues/canon.ttl#this";

    issue.relatesTo.add(r1);
    issue.relatesTo.add(r2);
    issue.duplicateOf = canonical;
    issue.clonedFrom = orig;

    expect([...issue.relatesTo].sort()).toEqual([r1, r2].sort());
    expect(issue.duplicateOf).toBe(canonical);
    expect(issue.clonedFrom).toBe(orig);

    // The links land on the exact reused predicates (dct:relation /
    // dct:isReplacedBy / prov:wasDerivedFrom), as IRIs.
    const dataset = (issue as unknown as { dataset: Store }).dataset;
    const obj = (pred: string) =>
      [...dataset.match(DataFactory.namedNode(IRI), DataFactory.namedNode(pred))].map((q) => q.object.value);
    expect(obj(dct("relation")).sort()).toEqual([r1, r2].sort());
    expect(obj(dct("isReplacedBy"))).toEqual([canonical]);
    expect(obj(prov("wasDerivedFrom"))).toEqual([orig]);

    // Supersession/clone sources are single — set replaces, clear removes.
    issue.duplicateOf = undefined;
    issue.relatesTo.delete(r1);
    expect(issue.duplicateOf).toBeUndefined();
    expect([...issue.relatesTo]).toEqual([r2]);
  });

  it("F5: declares all six issue-type levels including initiative and feature", () => {
    const slugs = ISSUE_TYPES.map((t) => t.slug);
    expect(slugs).toEqual(["initiative", "epic", "feature", "story", "task", "bug"]);

    const issue = newIssue();
    issue.tracker = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
    for (const slug of slugs as IssueType[]) {
      issue.issueType = slug;
      expect(issue.issueType).toBe(slug); // replaces, never stacks
    }
  });

  it("F5: typeLevel orders the full hierarchy coarse→fine and canNest enforces strict nesting", () => {
    // Full ordering: Initiative > Epic > Feature > Story > Task/Bug.
    expect(typeLevel("initiative")).toBeLessThan(typeLevel("epic"));
    expect(typeLevel("epic")).toBeLessThan(typeLevel("feature"));
    expect(typeLevel("feature")).toBeLessThan(typeLevel("story")); // feature is coarser than story
    expect(typeLevel("story")).toBeLessThan(typeLevel("task"));
    expect(typeLevel("task")).toBe(typeLevel("bug")); // both leaves at the same depth

    // A parent must be strictly coarser than its child — verify each step.
    expect(canNest("initiative", "epic")).toBe(true);
    expect(canNest("initiative", "feature")).toBe(true);
    expect(canNest("initiative", "story")).toBe(true);
    expect(canNest("initiative", "task")).toBe(true);
    expect(canNest("epic", "feature")).toBe(true);
    expect(canNest("epic", "story")).toBe(true);
    expect(canNest("epic", "task")).toBe(true);
    expect(canNest("feature", "story")).toBe(true); // feature can parent story
    expect(canNest("feature", "task")).toBe(true);
    expect(canNest("feature", "bug")).toBe(true);
    expect(canNest("story", "task")).toBe(true);   // story can parent task
    expect(canNest("story", "bug")).toBe(true);

    // Same-level or inverted nesting is rejected — a task/bug is always a leaf.
    expect(canNest("epic", "epic")).toBe(false);
    expect(canNest("feature", "feature")).toBe(false);
    expect(canNest("story", "story")).toBe(false);
    expect(canNest("task", "bug")).toBe(false);
    expect(canNest("task", "story")).toBe(false);
    expect(canNest("story", "feature")).toBe(false); // inverted
    expect(canNest("story", "initiative")).toBe(false);
    expect(canNest("task", "task")).toBe(false);
  });

  it("F5: declares #type-initiative and #type-feature classes on the tracker", () => {
    const DOC = "http://localhost:3000/alice/issue-tracker/tracker.ttl";
    const store = new Store();
    const tracker = new Tracker(`${DOC}#this`, store, DataFactory);
    tracker.configure("Issues");
    const ser = [...store].map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`).join("\n");
    expect(ser).toContain(`${DOC}#type-initiative`);
    expect(ser).toContain(`${DOC}#type-feature`);
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

  it("never serialises an unsafe URL scheme, even when set directly", () => {
    const { tracker, store } = newTracker();
    const url = tracker.defineField("Design doc", "url");
    const issue = new Issue(IRI, store, DataFactory);
    issue.setField(url, "https://example.org/ok");
    issue.setField(url, "javascript:alert(1)"); // overwrite attempt is dropped
    expect(issue.getField(url)).toBeUndefined();
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

describe("F1: configurable workflows", () => {
  const DOC = "http://localhost:3000/alice/issue-tracker/tracker.ttl";
  const TRACKER = `${DOC}#this`;
  const ISSUE = "http://localhost:3000/alice/issue-tracker/issues/x.ttl#this";

  /** A custom 4-state workflow with a directed transition graph. */
  const CUSTOM: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "in-progress", label: "In Progress", terminal: false },
      { slug: "in-review", label: "In Review", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    transitions: {
      backlog: ["in-progress"],
      "in-progress": ["in-review", "backlog"],
      "in-review": ["done", "in-progress"],
      done: [],
    },
  };

  function configuredTracker(workflow?: WorkflowDef) {
    const store = new Store();
    const tracker = new Tracker(TRACKER, store, DataFactory);
    tracker.configure("Issues");
    if (workflow) tracker.defineWorkflow(workflow);
    return { tracker, store };
  }

  it("the built-in tracker exposes the default To Do → In Progress → Done workflow", () => {
    const { tracker } = configuredTracker();
    const wfDef = tracker.workflow;
    expect(wfDef.statuses.map((s) => s.slug)).toEqual(["todo", "in-progress", "done"]);
    expect(wfDef.statuses.find((s) => s.slug === "done")?.terminal).toBe(true);
    // The first status (initial state) is todo.
    expect(wfDef.statuses[0].slug).toBe("todo");
  });

  it("declares a custom workflow with ≥3 states and reads it back faithfully", () => {
    const { tracker } = configuredTracker(CUSTOM);
    const wfDef = tracker.workflow;
    expect(wfDef.statuses.map((s) => s.slug)).toEqual(["backlog", "in-progress", "in-review", "done"]);
    expect(wfDef.statuses.map((s) => s.label)).toEqual(["Backlog", "In Progress", "In Review", "Done"]);
    // Initial state is the first declared status.
    expect(wfDef.statuses[0].slug).toBe("backlog");
    // Transition edges round-trip.
    expect(wfDef.transitions["in-review"].sort()).toEqual(["done", "in-progress"]);
    expect(wfDef.transitions["done"]).toEqual([]);
  });

  it("every custom state resolves to an open/closed disposition (subclass of wf:Open|wf:Closed)", () => {
    const { store } = configuredTracker(CUSTOM);
    for (const s of CUSTOM.statuses) {
      const iri = `${DOC}#status-${s.slug}`;
      const supers = [...store.match(DataFactory.namedNode(iri), DataFactory.namedNode(rdfs("subClassOf")))].map(
        (q) => q.object.value,
      );
      // Exactly one of Open / Closed — the SHACL exactly-one rule still holds.
      const resolution = supers.filter((x) => x === STATE.Open || x === STATE.Closed);
      expect(resolution).toHaveLength(1);
      expect(resolution[0]).toBe(s.terminal ? STATE.Closed : STATE.Open);
      // It is typed wf:State so the workflow reader (and SHACL) find it.
      const types = [...store.match(DataFactory.namedNode(iri), DataFactory.namedNode(rdf("type")))].map((q) => q.object.value);
      expect(types).toContain(wf("State"));
    }
    // statusState resolves each declared status correctly.
    expect(statusState(CUSTOM, "backlog")).toBe("open");
    expect(statusState(CUSTOM, "done")).toBe("closed");
  });

  it("canTransition respects the declared rules (allowed accepted, others rejected)", () => {
    expect(canTransition(CUSTOM, "backlog", "in-progress")).toBe(true);
    expect(canTransition(CUSTOM, "in-review", "done")).toBe(true);
    // Same status is always allowed (a no-op re-assert).
    expect(canTransition(CUSTOM, "done", "done")).toBe(true);
    // Not in the source's allowed set → rejected.
    expect(canTransition(CUSTOM, "backlog", "done")).toBe(false);
    expect(canTransition(CUSTOM, "done", "backlog")).toBe(false); // terminal, no outbound
    // An unknown target is never reachable.
    expect(canTransition(CUSTOM, "backlog", "nope")).toBe(false);
  });

  it("redefining a workflow drops statuses that are no longer declared", () => {
    const { tracker, store } = configuredTracker(CUSTOM);
    // Redefine to a smaller 3-state set; the old extra status must be removed.
    const SMALLER: WorkflowDef = {
      statuses: [
        { slug: "open", label: "Open", terminal: false },
        { slug: "doing", label: "Doing", terminal: false },
        { slug: "shipped", label: "Shipped", terminal: true },
      ],
      transitions: { open: ["doing"], doing: ["shipped"], shipped: [] },
    };
    tracker.defineWorkflow(SMALLER);
    expect(tracker.workflow.statuses.map((s) => s.slug)).toEqual(["open", "doing", "shipped"]);
    // No orphan #status-backlog / #status-in-review left behind.
    const stale = [...store].filter((q) => q.subject.value.includes("#status-backlog") || q.subject.value.includes("#status-in-review"));
    expect(stale).toEqual([]);
  });

  it("an issue reads its status from the #status- class regardless of the workflow", () => {
    const store = new Store();
    const issue = new Issue(ISSUE, store, DataFactory);
    issue.tracker = TRACKER;
    // Set a custom status with its (terminal=false) resolution.
    issue.setStatus("in-review", false);
    expect(issue.status).toBe("in-review");
    expect(issue.state).toBe("open"); // non-terminal resolves to open
    // Move to a terminal status: resolves to closed and stamps completion.
    issue.setStatus("done", true);
    expect(issue.status).toBe("done");
    expect(issue.state).toBe("closed");
    expect(issue.endedAt).toBeInstanceOf(Date);
    // Setting a status replaces the previous #status- class (never stacks).
    const statusTypes = [...store.match(DataFactory.namedNode(ISSUE), DataFactory.namedNode(rdf("type")))]
      .map((q) => q.object.value)
      .filter((t) => t.includes("#status-"));
    expect(statusTypes).toEqual([`${DOC}#status-done`]);
  });

  it("STATUSES stays the default workflow's statuses (back-compat)", () => {
    expect(STATUSES).toBe(DEFAULT_WORKFLOW.statuses);
    expect(STATUSES.map((s) => s.slug)).toEqual(["todo", "in-progress", "done"]);
  });
});

describe("F3: provenance activity log (prov:Activity)", () => {
  const PAGE = "http://localhost:3000/alice/issue-tracker/activity/x.ttl";
  const ME = "http://localhost:3000/alice/profile/card#me";
  const BOB = "http://localhost:3000/bob/profile/card#me";

  function newActivity(id: string, store: Store) {
    return new Activity(`${PAGE}#${id}`, store, DataFactory);
  }

  it("records a status change with actor, timestamp, and prov:used/generated", () => {
    const store = new Store();
    const at = new Date("2026-06-10T09:00:00.000Z");
    const act = newActivity("act-1", store);
    act.record({
      kind: "status",
      actor: ME,
      at,
      used: "http://localhost:3000/alice/issue-tracker/tracker.ttl#status-todo",
      generated: "http://localhost:3000/alice/issue-tracker/tracker.ttl#status-in-progress",
    });

    expect(act.kind).toBe("status");
    expect(act.actor).toBe(ME);
    expect(act.at?.toISOString()).toBe(at.toISOString());
    expect(act.used).toContain("#status-todo");
    expect(act.generated).toContain("#status-in-progress");

    // It lands on the exact PROV-O predicates as IRIs / dateTime.
    const obj = (pred: string) =>
      [...store.match(DataFactory.namedNode(act.id), DataFactory.namedNode(pred))].map((q) => q.object.value);
    expect(obj(rdf("type"))).toContain(prov("Activity"));
    expect(obj(prov("wasAssociatedWith"))).toEqual([ME]);
    expect(obj(prov("startedAtTime"))).toHaveLength(1);
    expect(obj(prov("used"))).toHaveLength(1);
    expect(obj(prov("generated"))).toHaveLength(1);
  });

  it("records an assignment change (used/generated are WebIDs)", () => {
    const store = new Store();
    const act = newActivity("act-2", store);
    act.record({ kind: "assignment", actor: ME, at: new Date("2026-06-11T00:00:00Z"), used: ME, generated: BOB });
    expect(act.kind).toBe("assignment");
    expect(act.used).toBe(ME);
    expect(act.generated).toBe(BOB);
  });

  it("omits empty endpoints (first assignment has no prior assignee)", () => {
    const store = new Store();
    const act = newActivity("act-3", store);
    act.record({ kind: "assignment", actor: ME, at: new Date(), generated: BOB });
    expect(act.used).toBeUndefined();
    expect(act.generated).toBe(BOB);
  });

  it("the log is append-only: a new entry never mutates or deletes existing ones", () => {
    // Simulate a page that already holds one entry, then append a second.
    const store = new Store();
    const first = newActivity("act-1", store);
    first.record({ kind: "status", actor: ME, at: new Date("2026-06-10T09:00:00Z"), generated: "tracker.ttl#status-todo" });
    const firstQuads = [...store.match(DataFactory.namedNode(first.id))].map((q) => `${q.predicate.value} ${q.object.value}`);

    const second = newActivity("act-2", store);
    second.record({ kind: "status", actor: BOB, at: new Date("2026-06-11T09:00:00Z"), generated: "tracker.ttl#status-done" });

    // The first entry is byte-for-byte untouched (no predicate added/removed/changed).
    const firstAfter = [...store.match(DataFactory.namedNode(first.id))].map((q) => `${q.predicate.value} ${q.object.value}`);
    expect(firstAfter.sort()).toEqual(firstQuads.sort());
    // Both entries are present.
    expect(new ActivityLog(store, DataFactory).entries).toHaveLength(2);
  });

  it("ActivityLog.entries returns entries newest-first", () => {
    const store = new Store();
    const older = newActivity("older", store);
    older.record({ kind: "status", actor: ME, at: new Date("2026-06-10T00:00:00Z"), generated: "x#status-todo" });
    const newer = newActivity("newer", store);
    newer.record({ kind: "status", actor: ME, at: new Date("2026-06-12T00:00:00Z"), generated: "x#status-done" });

    const entries = new ActivityLog(store, DataFactory).entries;
    expect(entries.map((e) => e.id)).toEqual([newer.id, older.id]);
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
