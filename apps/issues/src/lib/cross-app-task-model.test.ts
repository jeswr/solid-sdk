// Cross-app federation contract: solid-issues ⇄ @jeswr/solid-task-model.
//
// The linchpin of the data-federation initiative — a task created in solid-issues
// must read identically in the Pod Manager (and every suite app), and vice-versa,
// because BOTH go through the shared `@jeswr/solid-task-model` RDF model. These
// tests prove the round-trip in both directions, pin the exact predicates the Pod
// Manager queries (`wf:assignee` for "assigned to me", `dct:title`, and BOTH
// description predicates so a PM-authored body is never dropped on a solid-issues
// read), and validate solid-issues' writes against the SHARED task SHACL shape.
//
// NOTE on the SHACL helper: `rdf-validate-shacl`'s `validate()` returns either a
// ValidationReport (sync) OR a Promise of one (async — taken when the shapes graph
// pulls in extra resources, as the shared task shape does). So the helpers `await`
// it unconditionally — awaiting a plain report is harmless, but NOT awaiting the
// async path leaves you reading `.conforms` off a Promise (always `undefined`).
// The shapes datasets are built ONCE at module scope and reused (each call only
// `new SHACLValidator(<that dataset>)`), mirroring shacl.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Store, DataFactory, Parser } from "n3";
import env from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import {
  buildTask,
  parseTask,
  serializeTask,
  taskSubject,
  isAssignedTo,
  type TaskData,
} from "@jeswr/solid-task-model/task";
import { taskShapeTtl } from "@jeswr/solid-task-model/shape";
import { Issue } from "./issue";

const RESOURCE = "http://localhost:3000/alice/issue-tracker/issues/shared-1.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";

// The shared model and solid-issues both root the task at `${resourceUrl}#it`
// (taskSubject); solid-issues' read path additionally finds the task subject by
// `rdf:type wf:Task` regardless of its fragment, so a foreign `#it` task is located.
const SUBJECT = taskSubject(RESOURCE);

/** Feed n3 quads straight into an @zazuko/env dataset (clownface-capable for SHACL). */
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

// Built ONCE at module scope (see the note at the top), then reused per test.
const SHARED_SHAPES = toDataset(new Parser().parse(taskShapeTtl()));
const LOCAL_SHAPES = toDataset(new Parser().parse(readFileSync("shapes/issue.ttl", "utf8")));

/** Validate a store against the SHARED task shape exported by the package. */
async function validateShared(store: Store) {
  return await new SHACLValidator(SHARED_SHAPES, { factory: env }).validate(toDataset(store));
}
/** Validate against solid-issues' own (now dct:description-aware) shape. */
async function validateLocal(store: Store) {
  return await new SHACLValidator(LOCAL_SHAPES, { factory: env }).validate(toDataset(store));
}

const objectsOf = (store: Store, predicate: string) =>
  [...store.match(DataFactory.namedNode(SUBJECT), DataFactory.namedNode(predicate))].map((q) => q.object.value);

describe("cross-app federation: @jeswr/solid-task-model ⇄ solid-issues", () => {
  it("a Task written via the shared model round-trips through the Issue read path", async () => {
    // 1. Author a task with the SHARED model (as the Pod Manager / a foreign app would).
    const data: TaskData = {
      title: "Add OAuth login",
      description: "Implement the auth-code flow.",
      state: "open",
      assignee: ME,
      creator: BOB,
      project: "http://localhost:3000/alice/issue-tracker/tracker.ttl#this",
      dueDate: new Date("2026-07-01T00:00:00.000Z"),
      priority: "high",
      rank: 10,
    };
    const ttl = await serializeTask(RESOURCE, data);

    // 2. Parse the bytes and read them through solid-issues' OWN Issue wrapper.
    const store = new Store();
    store.addQuads(new Parser({ baseIRI: RESOURCE }).parse(ttl));
    const issue = new Issue(SUBJECT, store, DataFactory);

    // 3. The federated fields are read by solid-issues exactly as authored.
    expect(issue.title).toBe("Add OAuth login");
    expect(issue.description).toBe("Implement the auth-code flow.");
    expect(issue.state).toBe("open");
    expect(issue.assignee).toBe(ME);
    expect(issue.creator).toBe(BOB);
    expect(issue.tracker).toBe(data.project);
    expect(issue.dateDue?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(issue.rank).toBe(10);
    // Priority is read off the shared `schema:priority` literal when no tracker-local
    // `#priority-*` subclass is present (a foreign producer carries only the literal).
    expect(issue.priority).toBe("high");
  });

  it("the bytes carry the exact predicates the Pod Manager queries", async () => {
    const ttl = await serializeTask(RESOURCE, {
      title: "Assigned to me",
      description: "Body text.",
      state: "open",
      assignee: ME,
    });
    const store = new Store();
    store.addQuads(new Parser({ baseIRI: RESOURCE }).parse(ttl));

    // dct:title — the title PM reads.
    expect(objectsOf(store, `${DCT}title`)).toEqual(["Assigned to me"]);
    // wf:assignee — the "assigned to me" predicate PM's federation-tasks gate filters on.
    expect(objectsOf(store, `${WF}assignee`)).toEqual([ME]);
    // BOTH description predicates are present (the cross-app reconciliation): a PM
    // reader querying dct:description AND a solid-issues reader querying wf:description
    // both find the body.
    expect(objectsOf(store, `${WF}description`)).toEqual(["Body text."]);
    expect(objectsOf(store, `${DCT}description`)).toEqual(["Body text."]);
    // The "assigned to me" check the shared model exposes resolves for this WebID.
    expect(isAssignedTo(ME, ME)).toBe(true);
    expect(isAssignedTo(ME, BOB)).toBe(false);
  });

  it("an Issue written by solid-issues is read back by the shared parseTask (reverse direction)", () => {
    // Author with solid-issues' OWN wrapper.
    const store = new Store();
    const issue = new Issue(SUBJECT, store, DataFactory);
    issue.title = "Found in solid-issues";
    issue.description = "Authored here.";
    issue.state = "open";
    issue.assignee = BOB;
    issue.creator = ME;
    issue.dateDue = new Date("2026-08-15T00:00:00.000Z");
    issue.rank = 3;

    // Read it through the SHARED model's parse path — what the Pod Manager runs.
    const task = parseTask(RESOURCE, store);
    expect(task).toBeDefined();
    expect(task?.title).toBe("Found in solid-issues");
    expect(task?.description).toBe("Authored here.");
    expect(task?.state).toBe("open");
    expect(task?.assignee).toBe(BOB);
    expect(task?.creator).toBe(ME);
    expect(task?.dueDate?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(task?.rank).toBe(3);
  });

  it("a solid-issues Issue body is co-written on BOTH description predicates", () => {
    const store = new Store();
    const issue = new Issue(SUBJECT, store, DataFactory);
    issue.title = "T";
    issue.state = "open";
    issue.description = "Body authored in solid-issues.";
    // Co-write of wf:description AND dct:description (the cross-app reconciliation).
    expect(objectsOf(store, `${WF}description`)).toEqual(["Body authored in solid-issues."]);
    expect(objectsOf(store, `${DCT}description`)).toEqual(["Body authored in solid-issues."]);
  });

  it("a PM-authored dct:description-only body is read by solid-issues (no longer dropped)", () => {
    // Simulate a Pod-Manager-authored body that uses ONLY dct:description (the
    // historical PM predicate) — before adopting the shared model, solid-issues read
    // only wf:description and would have shown an empty body. Now it falls back.
    const store = new Store();
    const s = DataFactory.namedNode(SUBJECT);
    store.addQuad(s, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${WF}Task`));
    store.addQuad(s, DataFactory.namedNode(`${DCT}title`), DataFactory.literal("PM task"));
    store.addQuad(s, DataFactory.namedNode(`${DCT}description`), DataFactory.literal("Written by the Pod Manager."));

    const issue = new Issue(SUBJECT, store, DataFactory);
    expect(issue.description).toBe("Written by the Pod Manager.");
  });

  it("a solid-issues-authored Issue conforms to the SHARED task SHACL shape", async () => {
    // The shared shape is the single contract every suite app's wf:Task must satisfy.
    // Build with solid-issues' wrapper and validate against the package's shape — so
    // solid-issues' writes are guaranteed legible to every consumer of the model.
    const store = new Store();
    const issue = new Issue(SUBJECT, store, DataFactory);
    issue.title = "Conforms to the shared contract";
    issue.description = "Body.";
    issue.state = "open";
    issue.assignee = ME;
    issue.creator = ME;
    issue.dateDue = new Date("2026-09-01T00:00:00.000Z");
    issue.rank = 1;

    expect((await validateShared(store)).conforms).toBe(true);
  });

  it("a solid-issues-authored Issue also conforms to its OWN (dct:description-aware) shape", async () => {
    const store = new Store();
    const issue = new Issue(SUBJECT, store, DataFactory);
    issue.title = "Local-shape conformance";
    issue.description = "Body (co-written on wf: AND dct:).";
    issue.state = "open";
    issue.assignee = ME;
    issue.created = new Date("2026-09-01T00:00:00.000Z");

    expect((await validateLocal(store)).conforms).toBe(true);
  });

  it("a shared buildTask store conforms to the shared shape (sanity floor)", async () => {
    const store = buildTask(RESOURCE, {
      title: "Built by the shared model",
      description: "Body.",
      state: "closed",
      assignee: ME,
    });
    expect((await validateShared(store)).conforms).toBe(true);
  });
});
