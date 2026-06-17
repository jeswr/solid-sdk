// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { trackerShapeTtl } from "./shape.js";
import { parseTask, taskSubject } from "./task.js";
import {
  buildTracker,
  canTransition,
  DEFAULT_WORKFLOW,
  parseTracker,
  parseTrackerTtl,
  serializeTracker,
  statusState,
  Tracker,
  type TrackerData,
  trackerSubject,
  type WorkflowDef,
} from "./tracker.js";
import { rdfs, schema, TASK_CLASS, vcard, WF_CLOSED, WF_OPEN, wf } from "./vocab.js";

const DOC = "http://localhost:3000/alice/issues/tracker.ttl";
const STORE = "http://localhost:3000/alice/issues/";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

function parseStore(ttl: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI: DOC }).parse(ttl));
  return store;
}

function has(store: Store, s: string, p: string, o: string): boolean {
  return (
    store.getQuads(
      DataFactory.namedNode(s),
      DataFactory.namedNode(p),
      DataFactory.namedNode(o),
      null,
    ).length > 0
  );
}

describe("Tracker typed accessor", () => {
  it("marks the subject as wf:Tracker and reads it back", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    expect(t.isTracker).toBe(true);
    expect(t.id).toBe(`${DOC}#this`);
    expect(t.types.has(wf("Tracker"))).toBe(true);
  });

  it("issueClass defaults to wf:Task on read and write", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    // Unset → defaults to wf:Task.
    expect(t.issueClass).toBe(TASK_CLASS);
    // Setting undefined still writes wf:Task (SolidOS requires the triple).
    t.issueClass = undefined;
    expect(has(store, `${DOC}#this`, wf("issueClass"), TASK_CLASS)).toBe(true);
  });

  it("title / stateStore round-trip via typed accessors", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    t.title = "Alice's Issues";
    t.stateStore = STORE;
    expect(t.title).toBe("Alice's Issues");
    expect(t.stateStore).toBe(STORE);
  });

  it("setGroupMembers links a vcard:Group and reads members back", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    t.setGroupMembers([ME, BOB]);
    expect(t.assigneeGroup).toBe(`${DOC}#team`);
    expect(new Set(t.groupMembers)).toEqual(new Set([ME, BOB]));
    // The group node is typed vcard:Group with vcard:hasMember edges.
    const RdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    expect(has(store, `${DOC}#team`, RdfType, vcard("Group"))).toBe(true);
    expect(has(store, `${DOC}#team`, vcard("hasMember"), ME)).toBe(true);
    // Replacing members clears the old set.
    t.setGroupMembers([ME]);
    expect(new Set(t.groupMembers)).toEqual(new Set([ME]));
  });

  it("drops a non-http(s) group member (untrusted input)", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    t.setGroupMembers([ME, "urn:agent:bob", "mailto:x@y.z"]);
    expect(t.groupMembers).toEqual([ME]);
  });

  it("groupMembers READ filters out non-http(s) members written by a foreign doc", () => {
    // A malicious/foreign tracker doc that bypasses our write path and asserts
    // dangerous vcard:hasMember URIs directly. The READ accessor must scheme-
    // filter them the same way setGroupMembers does on write (the asymmetry G7
    // Builder B flagged: write filtered, read did not) — a consumer rendering
    // members as links must never receive a `javascript:`/`data:` URI.
    const foreign = parseStore(`
      @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a wf:Tracker ; wf:assigneeGroup <#team> .
      <#team> a vcard:Group ;
        vcard:hasMember <${ME}> ,
          <${BOB}> ,
          <javascript:alert(1)> ,
          <data:text/html,evil> ,
          <urn:agent:mallory> ,
          <mailto:x@y.z> .
    `);
    const t = new Tracker(trackerSubject(DOC), foreign, DataFactory);
    const members = t.groupMembers;
    // Only the http(s) WebIDs survive the read.
    expect(new Set(members)).toEqual(new Set([ME, BOB]));
    // None of the dangerous / non-http(s) schemes leak through.
    expect(members).not.toContain("javascript:alert(1)");
    expect(members).not.toContain("data:text/html,evil");
    expect(members).not.toContain("urn:agent:mallory");
    expect(members).not.toContain("mailto:x@y.z");
    // And parseTracker (the public entry point) surfaces only the clean set.
    const parsed = parseTracker(DOC, foreign);
    expect(new Set(parsed?.groupMembers)).toEqual(new Set([ME, BOB]));
  });

  it("groupMembers round-trip (setGroupMembers → groupMembers) still passes valid http(s) WebIDs through", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    const carol = "http://localhost:3000/carol/profile/card#me";
    t.setGroupMembers([ME, BOB, carol]);
    expect(new Set(t.groupMembers)).toEqual(new Set([ME, BOB, carol]));
  });

  it("defineWorkflow + workflow round-trip with custom statuses and transitions", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    const custom: WorkflowDef = {
      statuses: [
        { slug: "backlog", label: "Backlog", terminal: false },
        { slug: "active", label: "Active", terminal: false },
        { slug: "shipped", label: "Shipped", terminal: true },
      ],
      transitions: { backlog: ["active"], active: ["shipped", "backlog"], shipped: [] },
    };
    t.defineWorkflow(custom);
    const wf_ = t.workflow;
    expect(wf_.statuses.map((s) => s.slug)).toEqual(["backlog", "active", "shipped"]);
    expect(wf_.statuses.find((s) => s.slug === "shipped")?.terminal).toBe(true);
    expect(wf_.transitions.active).toContain("shipped");
    expect(canTransition(wf_, "backlog", "active")).toBe(true);
    expect(canTransition(wf_, "backlog", "shipped")).toBe(false);
    expect(statusState(wf_, "shipped")).toBe("closed");
    expect(statusState(wf_, "backlog")).toBe("open");
  });

  it("a tracker with no declared statuses yields DEFAULT_WORKFLOW", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    expect(t.workflow).toEqual(DEFAULT_WORKFLOW);
  });

  it("the default-workflow getter returns a defensive COPY (no shared-constant aliasing)", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    const wf1 = t.workflow;
    // The returned default must not BE the shared constant…
    expect(wf1).not.toBe(DEFAULT_WORKFLOW);
    expect(wf1.statuses).not.toBe(DEFAULT_WORKFLOW.statuses);
    // …and mutating the returned copy must not corrupt the constant or the next read.
    wf1.statuses.push({ slug: "rogue", label: "Rogue", terminal: false });
    wf1.transitions.todo?.push("rogue");
    expect(DEFAULT_WORKFLOW.statuses.map((s) => s.slug)).toEqual(["todo", "in-progress", "done"]);
    expect(t.workflow.statuses.map((s) => s.slug)).toEqual(["todo", "in-progress", "done"]);
    expect(t.workflow.transitions.todo).toEqual(["in-progress", "done"]);
  });

  it("DEFAULT_WORKFLOW is deep-frozen (a shared constant must be immutable)", () => {
    expect(Object.isFrozen(DEFAULT_WORKFLOW)).toBe(true);
    expect(Object.isFrozen(DEFAULT_WORKFLOW.statuses)).toBe(true);
    expect(Object.isFrozen(DEFAULT_WORKFLOW.transitions)).toBe(true);
    expect(Object.isFrozen(DEFAULT_WORKFLOW.statuses[0])).toBe(true);
  });

  it("canTransition rejects an unknown `from` status (malformed workflow data)", () => {
    const wf_ = DEFAULT_WORKFLOW;
    // A `from` that is not a declared status authorizes nothing…
    expect(canTransition(wf_, "ghost", "todo")).toBe(false);
    expect(canTransition(wf_, "ghost", "done")).toBe(false);
    // …even if a malformed transitions map names it as a source.
    const malformed: WorkflowDef = {
      statuses: [{ slug: "todo", label: "To Do", terminal: false }],
      transitions: { ghost: ["todo"] },
    };
    expect(canTransition(malformed, "ghost", "todo")).toBe(false);
    // But the identity move from an unknown status is still allowed (same-status).
    expect(canTransition(wf_, "ghost", "ghost")).toBe(true);
  });

  it("redefining a workflow leaves no orphan #status- class", () => {
    const store = new Store();
    const t = new Tracker(trackerSubject(DOC), store, DataFactory).mark();
    t.defineWorkflow(DEFAULT_WORKFLOW);
    t.defineWorkflow({
      statuses: [{ slug: "only", label: "Only", terminal: false }],
      transitions: {},
    });
    expect(t.workflow.statuses.map((s) => s.slug)).toEqual(["only"]);
    // No leftover #status-todo triples.
    expect(
      store.getQuads(DataFactory.namedNode(`${DOC}#status-todo`), null, null, null),
    ).toHaveLength(0);
  });
});

describe("buildTracker / parseTracker round-trip", () => {
  it("round-trips a fully-populated tracker", () => {
    const data: TrackerData = {
      title: "Alice's Issues",
      stateStore: STORE,
      groupMembers: [ME, BOB],
      categories: [`${DOC}#Priority`, `${DOC}#Label`],
      workflow: DEFAULT_WORKFLOW,
    };
    const store = buildTracker(DOC, data);
    const parsed = parseTracker(DOC, store);
    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe("Alice's Issues");
    expect(parsed?.issueClass).toBe(TASK_CLASS);
    expect(parsed?.stateStore).toBe(STORE);
    expect(new Set(parsed?.groupMembers)).toEqual(new Set([ME, BOB]));
    expect(new Set(parsed?.categories)).toEqual(new Set([`${DOC}#Priority`, `${DOC}#Label`]));
    expect(parsed?.workflow?.statuses.map((s) => s.slug)).toEqual(
      DEFAULT_WORKFLOW.statuses.map((s) => s.slug),
    );
  });

  it("round-trips a minimal tracker (title only)", () => {
    const store = buildTracker(DOC, { title: "Minimal" });
    const parsed = parseTracker(DOC, store);
    expect(parsed?.title).toBe("Minimal");
    // SolidOS-required defaults are always present.
    expect(parsed?.issueClass).toBe(TASK_CLASS);
    expect(parsed?.workflow).toBeDefined();
  });

  it("parseTracker returns undefined when the subject is not a wf:Tracker", () => {
    const store = parseStore(`
      @prefix dct: <http://purl.org/dc/terms/> .
      <#this> dct:title "Not a tracker" .
    `);
    expect(parseTracker(DOC, store)).toBeUndefined();
  });

  it("the tracker subject is #this, NOT #it (distinct from the task)", () => {
    expect(trackerSubject(DOC)).toBe(`${DOC}#this`);
    expect(taskSubject(DOC)).toBe(`${DOC}#it`);
    // A tracker built at #this is NOT found at #it.
    const store = buildTracker(DOC, { title: "Frag test" });
    const wrongFrag = new Tracker(`${DOC}#it`, store, DataFactory);
    expect(wrongFrag.isTracker).toBe(false);
  });

  it("drops a non-http(s) stateStore / issueClass (falls back to wf:Task)", () => {
    const store = buildTracker(DOC, {
      title: "Untrusted",
      stateStore: "urn:bad",
      issueClass: "not a url",
    });
    const parsed = parseTracker(DOC, store);
    expect(parsed?.stateStore).toBeUndefined();
    expect(parsed?.issueClass).toBe(TASK_CLASS);
  });
});

describe("SolidOS-readable triples (the pane throws without these)", () => {
  it("buildTracker writes rdf:type wf:Tracker, wf:issueClass wf:Task, wf:stateStore, wf:initialState", async () => {
    const store = buildTracker(DOC, { title: "Readable", stateStore: STORE });
    const sub = `${DOC}#this`;
    const RdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    expect(has(store, sub, RdfType, wf("Tracker"))).toBe(true);
    expect(has(store, sub, wf("issueClass"), TASK_CLASS)).toBe(true);
    expect(has(store, sub, wf("stateStore"), STORE)).toBe(true);
    // A wf:initialState pointing at a declared #status- class.
    const init = store.getQuads(
      DataFactory.namedNode(sub),
      DataFactory.namedNode(wf("initialState")),
      null,
      null,
    );
    expect(init).toHaveLength(1);
    const initClass = init[0]?.object.value ?? "";
    expect(initClass.startsWith(`${DOC}#status-`)).toBe(true);
    // The status class is a wf:State subClassOf wf:Open/wf:Closed (SolidOS reads this).
    expect(has(store, initClass, RdfType, wf("State"))).toBe(true);
    const supers = store
      .getQuads(
        DataFactory.namedNode(initClass),
        DataFactory.namedNode(rdfs("subClassOf")),
        null,
        null,
      )
      .map((q) => q.object.value);
    expect(supers.includes(WF_OPEN) || supers.includes(WF_CLOSED)).toBe(true);
    // schema:position records the column order.
    expect(
      store.getQuads(
        DataFactory.namedNode(initClass),
        DataFactory.namedNode(schema("position")),
        null,
        null,
      ),
    ).not.toHaveLength(0);
  });
});

describe("back-compat: a legacy flat wf:Task with NO tracker still parses", () => {
  it("parseTask succeeds on a task that has no wf:tracker link", () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ;
        dct:title "Legacy flat task" .
    `;
    const store = parseStore(ttl);
    const task = parseTask(DOC, store);
    expect(task).toBeDefined();
    expect(task?.title).toBe("Legacy flat task");
    expect(task?.project).toBeUndefined(); // no wf:tracker — still valid.
    expect(task?.state).toBe("open");
  });

  it("parseTracker ignores a doc that holds only a flat task (no #this tracker)", () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open ; dct:title "Just a task" .
    `;
    expect(parseTracker(DOC, parseStore(ttl))).toBeUndefined();
  });
});

describe("parseTrackerTtl (content-type dispatch via @jeswr/fetch-rdf)", () => {
  it("parses a serialised tracker from Turtle", async () => {
    const ttl = await serializeTracker(DOC, { title: "Serialised", stateStore: STORE });
    const parsed = await parseTrackerTtl(DOC, ttl, "text/turtle");
    expect(parsed?.title).toBe("Serialised");
    expect(parsed?.stateStore).toBe(STORE);
  });

  it("treats a null content-type as text/turtle", async () => {
    const ttl = await serializeTracker(DOC, { title: "Null CT" });
    const parsed = await parseTrackerTtl(DOC, ttl, null);
    expect(parsed?.title).toBe("Null CT");
  });
});

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Parser/Store into an env dataset — the exact pattern
// the task shape test uses, so verdicts match across the suite.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const trackerShapes = toDataset(new Parser().parse(trackerShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: DOC }).parse(ttl));
  return new SHACLValidator(trackerShapes, { factory: env }).validate(data);
}

describe("SHACL shape (shapes/tracker.ttl)", () => {
  it("a fully-populated, well-formed tracker conforms", async () => {
    const ttl = await serializeTracker(DOC, {
      title: "Alice's Issues",
      stateStore: STORE,
      groupMembers: [ME, BOB],
      categories: [`${DOC}#Priority`],
    });
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(true);
  });

  it("a minimal tracker (title only) conforms", async () => {
    const report = await validateTtl(await serializeTracker(DOC, { title: "Minimal" }));
    expect(report.conforms).toBe(true);
  });

  it("buildTracker output conforms without serialising (store → dataset)", async () => {
    const store = buildTracker(DOC, { title: "Direct store", stateStore: STORE });
    const report = await new SHACLValidator(trackerShapes, { factory: env }).validate(
      toDataset(store),
    );
    expect(report.conforms).toBe(true);
  });

  it("a tracker with NO title is non-conforming (title is required)", async () => {
    const report = await validateTtl(await serializeTracker(DOC, { title: "" }));
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("title"))).toBe(true);
  });

  it("two wf:issueClass values are non-conforming (maxCount 1)", async () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#this> a wf:Tracker ;
        dct:title "Two classes" ;
        wf:issueClass wf:Task, wf:Issue .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("issueClass"))).toBe(true);
  });

  it("a tracker with NO wf:issueClass is non-conforming (required — SolidOS throws without it)", async () => {
    // A bare tracker (no issueClass / initialState) is NOT a valid SolidOS tracker.
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#this> a wf:Tracker ; dct:title "No issue class" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("issueClass"))).toBe(true);
  });

  it("a tracker with NO wf:initialState warns (soft compatibility requirement)", async () => {
    // issueClass present (so it's not a hard violation), but no initialState.
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#this> a wf:Tracker ; dct:title "No initial state" ; wf:issueClass wf:Task .
    `;
    const report = await validateTtl(ttl);
    // The missing-initialState rule is sh:Warning → a result, but advisory.
    expect(
      report.results.some(
        (r) =>
          String(r.path?.value).endsWith("initialState") &&
          String(r.severity?.value).endsWith("Warning"),
      ),
    ).toBe(true);
  });

  it("a literal wf:issueCategory is non-conforming (must be an IRI)", async () => {
    const ttl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#this> a wf:Tracker ;
        dct:title "Bad category" ;
        wf:issueCategory "not an IRI" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("issueCategory"))).toBe(true);
  });

  it("a second wf:assigneeGroup warns (soft maxCount 1)", async () => {
    const ttl = `
      @prefix wf:    <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:   <http://purl.org/dc/terms/> .
      <#this> a wf:Tracker ;
        dct:title "Two groups" ;
        wf:assigneeGroup <#team>, <#team2> .
    `;
    const report = await validateTtl(ttl);
    // sh:Warning severity → a result, but advisory (does not fail conformance hard).
    expect(report.results.some((r) => String(r.severity?.value).endsWith("Warning"))).toBe(true);
  });
});
