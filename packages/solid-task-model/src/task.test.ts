// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildTask,
  isAssignedTo,
  isHttpIri,
  PRIORITIES,
  parseTask,
  parseTaskTtl,
  serializeTask,
  sortTasks,
  storeToTurtle,
  Task,
  type TaskData,
  taskSubject,
} from "./task.js";
import { dct, schema, TASK_CLASS, WF_CLOSED, WF_OPEN, wf } from "./vocab.js";

const URL_ = "http://localhost:3000/alice/issues/x";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";
const TRACKER = "http://localhost:3000/alice/issues/tracker.ttl#this";

function parseStore(ttl: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI: URL_ }).parse(ttl));
  return store;
}

describe("Task typed accessor", () => {
  it("marks the subject as wf:Task and reads it back", () => {
    const store = new Store();
    const t = new Task(taskSubject(URL_), store, DataFactory).mark();
    expect(t.isTask).toBe(true);
    expect(t.types.has(TASK_CLASS)).toBe(true);
  });

  it("state setter manages wf:Open/wf:Closed and prov:endedAtTime", () => {
    const store = new Store();
    const t = new Task(taskSubject(URL_), store, DataFactory).mark();

    t.state = "open";
    expect(t.types.has(WF_OPEN)).toBe(true);
    expect(t.types.has(WF_CLOSED)).toBe(false);
    expect(t.endedAt).toBeUndefined();

    t.state = "closed";
    expect(t.types.has(WF_CLOSED)).toBe(true);
    expect(t.types.has(WF_OPEN)).toBe(false);
    expect(t.endedAt).toBeInstanceOf(Date);

    // Re-closing preserves the original completion time.
    const first = t.endedAt;
    t.state = "closed";
    expect(t.endedAt?.getTime()).toBe(first?.getTime());

    // Reopening clears it.
    t.state = "open";
    expect(t.endedAt).toBeUndefined();
  });
});

describe("round-trip parse/serialise", () => {
  it("a fully-populated task round-trips through serialize → parse unchanged", async () => {
    const original: TaskData = {
      title: "Login button overflows on mobile",
      description: "Repro steps included.",
      state: "open",
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-09T11:00:00.000Z"),
      creator: ME,
      assignee: BOB,
      project: TRACKER,
      dueDate: new Date("2026-07-01T00:00:00.000Z"),
      priority: "high",
      rank: 12.5,
      parent: `${URL_}-parent`,
      blockedBy: [`${URL_}-a`, `${URL_}-b`],
      relatesTo: [`${URL_}-c`],
      duplicateOf: `${URL_}-dup`,
    };

    const ttl = await serializeTask(URL_, original);
    const reparsed = parseTask(URL_, parseStore(ttl));
    expect(reparsed).toBeDefined();
    // Compare with set-fields normalised to sorted arrays for stable equality.
    expect({ ...reparsed, blockedBy: reparsed?.blockedBy?.sort() }).toEqual({
      ...original,
      blockedBy: original.blockedBy?.sort(),
    });
  });

  it("a minimal task (title + state only) round-trips and stamps created", async () => {
    const ttl = await serializeTask(URL_, { title: "Minimal", state: "open" });
    const reparsed = parseTask(URL_, parseStore(ttl));
    expect(reparsed?.title).toBe("Minimal");
    expect(reparsed?.state).toBe("open");
    expect(reparsed?.created).toBeInstanceOf(Date); // defaulted
    expect(reparsed?.assignee).toBeUndefined();
  });

  it("closing a task writes prov:endedAtTime in the serialised output", async () => {
    const ttl = await serializeTask(URL_, { title: "Done thing", state: "closed" });
    const store = parseStore(ttl);
    const doc = new Task(taskSubject(URL_), store, DataFactory);
    expect(doc.state).toBe("closed");
    expect(doc.endedAt).toBeInstanceOf(Date);
    // n3.Writer emits prefixed Turtle, so assert the prefixed term form.
    expect(ttl).toContain("prov:endedAtTime");
  });

  it("parseTask returns undefined for a non-task document", () => {
    const store = parseStore(`<#it> <${dct("title")}> "Not a task" .`);
    expect(parseTask(URL_, store)).toBeUndefined();
  });
});

describe("untrusted-input hardening on build", () => {
  it("drops object-property fields that are not http(s) IRIs", async () => {
    const ttl = await serializeTask(URL_, {
      title: "X",
      state: "open",
      assignee: "javascript:alert(1)",
      creator: "mailto:bob@example.com",
      project: "not a url",
      parent: "urn:isbn:123",
      blockedBy: ["http://ok/1", "ftp://bad/2"],
    });
    const reparsed = parseTask(URL_, parseStore(ttl));
    expect(reparsed?.assignee).toBeUndefined();
    expect(reparsed?.creator).toBeUndefined();
    expect(reparsed?.project).toBeUndefined();
    expect(reparsed?.parent).toBeUndefined();
    expect(reparsed?.blockedBy).toEqual(["http://ok/1"]);
  });
});

describe("parseTaskTtl (fetch-rdf dispatch)", () => {
  it("parses a Turtle body", async () => {
    const ttl = await serializeTask(URL_, { title: "Via TTL", state: "open", assignee: ME });
    const data = await parseTaskTtl(URL_, ttl, "text/turtle");
    expect(data?.title).toBe("Via TTL");
    expect(data?.assignee).toBe(ME);
  });

  it("defaults a null Content-Type to text/turtle", async () => {
    const ttl = await serializeTask(URL_, { title: "Default CT", state: "closed" });
    const data = await parseTaskTtl(URL_, ttl, null);
    expect(data?.title).toBe("Default CT");
    expect(data?.state).toBe("closed");
  });
});

describe("helpers", () => {
  it("isHttpIri accepts http(s), rejects everything else", () => {
    expect(isHttpIri("http://x/y")).toBe(true);
    expect(isHttpIri("https://x/y#me")).toBe(true);
    expect(isHttpIri("urn:x")).toBe(false);
    expect(isHttpIri("javascript:1")).toBe(false);
    expect(isHttpIri(undefined)).toBe(false);
    expect(isHttpIri("")).toBe(false);
  });

  it("isAssignedTo is an exact (trimmed) IRI match", () => {
    expect(isAssignedTo(ME, ME)).toBe(true);
    expect(isAssignedTo(` ${ME} `, ME)).toBe(true);
    expect(isAssignedTo(BOB, ME)).toBe(false);
    expect(isAssignedTo(undefined, ME)).toBe(false);
  });

  it("sortTasks puts open before closed, newest first within a band", () => {
    const sorted = sortTasks([
      { title: "old open", state: "open", created: new Date("2026-01-01") },
      { title: "closed", state: "closed", created: new Date("2026-06-01") },
      { title: "new open", state: "open", created: new Date("2026-05-01") },
    ]);
    expect(sorted.map((t) => t.title)).toEqual(["new open", "old open", "closed"]);
  });

  it("PRIORITIES is coarsest-first and round-trips through the accessor", async () => {
    expect(PRIORITIES).toEqual(["high", "medium", "low"]);
    for (const p of PRIORITIES) {
      const ttl = await serializeTask(URL_, { title: "p", state: "open", priority: p });
      expect(parseTask(URL_, parseStore(ttl))?.priority).toBe(p);
    }
  });

  it("storeToTurtle emits the model prefixes", async () => {
    const out = await storeToTurtle(buildTask(URL_, { title: "T", state: "open" }));
    expect(out).toContain("@prefix wf:");
    expect(out).toContain("@prefix dct:");
  });
});

describe("vocabulary IRIs are the converged standard terms", () => {
  it("uses wf:Task / wf:Open / wf:assignee / dct:title / schema:position (full IRIs)", async () => {
    // n3.Writer emits PREFIXED Turtle, so assert the full IRIs by re-parsing into a
    // store and querying the exact predicate/object IRIs — the semantic guarantee.
    const ttl = await serializeTask(URL_, { title: "T", state: "open", assignee: ME, rank: 1 });
    const store = parseStore(ttl);
    const subject = taskSubject(URL_);
    const typeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    expect(store.getQuads(subject, typeIri, wf("Task"), null).length).toBe(1);
    expect(store.getQuads(subject, typeIri, wf("Open"), null).length).toBe(1);
    expect(store.getQuads(subject, wf("assignee"), ME, null).length).toBe(1);
    expect(store.getQuads(subject, dct("title"), null, null).length).toBe(1);
    expect(store.getQuads(subject, schema("position"), null, null).length).toBe(1);
  });
});
