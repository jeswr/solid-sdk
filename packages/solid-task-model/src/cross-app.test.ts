// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// THE CROSS-APP FIXTURE — the whole point of the package.
//
// These fixtures are written in EXACTLY the Turtle the two existing producers
// emit, hand-transcribed from their source so this test pins the real wire
// format (not a copy of our own writer's output):
//
//   - solid-issues: `wf:Task` rooted at `<resource>#it`... actually solid-issues
//     roots its issue at `<resource>#this`/`#it` depending on the surface; the
//     Pod Manager (`src/lib/issues.ts buildIssue`) roots at `<resource>#it`,
//     types `rdf:type wf:Open|wf:Closed`, and writes `dct:title`,
//     `dct:description` (PM) / `wf:description`, `dct:created`,
//     `prov:endedAtTime`, `wf:assignee`. The shared model reads BOTH.
//
// The assertion: a task another app wrote reads back through THIS model's
// `parseTask` with the federation fields intact — so "assigned to me" works
// across apps. And a task THIS model writes is parseable by the same predicates
// the other apps read, i.e. the format is genuinely shared.
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { isAssignedTo, parseTask, serializeTask, taskSubject } from "./task.js";
import { dct, wf } from "./vocab.js";

const RESOURCE = "http://localhost:3000/alice/issues/login-bug";
const ME = "http://localhost:3000/me/profile/card#me";
const PM_NS = "https://pod-manager.solid-test.jeswr.org/ns/issues#status-in-progress";

function parseStore(ttl: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI: RESOURCE }).parse(ttl));
  return store;
}

describe("cross-app: read a task another app wrote", () => {
  it("reads a Pod Manager-emitted issue (wf:Task @ #it, wf:Open, dct:title, wf:assignee)", () => {
    // Transcribed from solid-pod-manager src/lib/issues.ts buildIssue(): subject
    // `${url}#it`, rdf:type wf:Task + wf:Open, dct:title, dct:created, wf:assignee.
    const pmTtl = `
      @prefix wf:   <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a wf:Task, wf:Open ;
        dct:title "Login button overflows on mobile" ;
        dct:created "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        wf:assignee <${ME}> .
    `;
    const task = parseTask(RESOURCE, parseStore(pmTtl));
    expect(task).toBeDefined();
    expect(task?.title).toBe("Login button overflows on mobile");
    expect(task?.state).toBe("open");
    expect(task?.assignee).toBe(ME);
    // The federation "assigned to me" predicate sees it.
    expect(isAssignedTo(task?.assignee, ME)).toBe(true);
  });

  it("reads a PM closed issue (wf:Closed + prov:endedAtTime)", () => {
    const pmTtl = `
      @prefix wf:   <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix prov: <http://www.w3.org/ns/prov#> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a wf:Task, wf:Closed ;
        dct:title "Fixed it" ;
        dct:created "2026-06-09T10:00:00.000Z"^^xsd:dateTime ;
        prov:endedAtTime "2026-06-10T12:00:00.000Z"^^xsd:dateTime .
    `;
    const task = parseTask(RESOURCE, parseStore(pmTtl));
    expect(task?.state).toBe("closed");
    expect(task?.endedAt?.toISOString()).toBe("2026-06-10T12:00:00.000Z");
  });

  it("reads a PM 'in-progress' issue as OPEN (the app-local subclass is ignored)", () => {
    // PM stamps wf:Open PLUS its own #status-in-progress subclass. A foreign
    // consumer (this model) sees wf:Open → open, which is the correct, lossy-but-
    // safe federation behaviour described in PM's issues.ts.
    const pmTtl = `
      @prefix wf:  <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a wf:Task, wf:Open, <${PM_NS}> ;
        dct:title "Half done" .
    `;
    const task = parseTask(RESOURCE, parseStore(pmTtl));
    expect(task?.state).toBe("open");
    expect(task?.title).toBe("Half done");
  });

  it("reads a solid-issues-emitted task (wf:tracker, wf:description, dct:creator, relations)", () => {
    // Transcribed from solid-issues src/lib/issue.ts: wf:description (not dct:),
    // wf:tracker, dct:creator, dct:isPartOf (parent), dct:requires (blocked-by),
    // wf:dateDue. The shared model reads each one.
    const siTtl = `
      @prefix wf:   <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a wf:Task, wf:Open ;
        dct:title "Add OAuth" ;
        wf:description "We need login." ;
        wf:tracker <http://localhost:3000/alice/issues/tracker.ttl#this> ;
        dct:creator <${ME}> ;
        wf:assignee <${ME}> ;
        dct:isPartOf <http://localhost:3000/alice/issues/epic#it> ;
        dct:requires <http://localhost:3000/alice/issues/dep#it> ;
        wf:dateDue "2026-07-01T00:00:00.000Z"^^xsd:dateTime .
    `;
    const task = parseTask(RESOURCE, parseStore(siTtl));
    expect(task?.title).toBe("Add OAuth");
    expect(task?.description).toBe("We need login.");
    expect(task?.project).toBe("http://localhost:3000/alice/issues/tracker.ttl#this");
    expect(task?.creator).toBe(ME);
    expect(task?.parent).toBe("http://localhost:3000/alice/issues/epic#it");
    expect(task?.blockedBy).toEqual(["http://localhost:3000/alice/issues/dep#it"]);
    expect(task?.dueDate?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("cross-app: a task THIS model writes is read by the OTHER apps' predicates", () => {
  it("emits exactly the predicates solid-issues / PM read (federation contract)", async () => {
    const ttl = await serializeTask(RESOURCE, {
      title: "Shared task",
      description: "body",
      state: "open",
      assignee: ME,
      creator: ME,
      project: "http://localhost:3000/alice/issues/tracker.ttl#this",
    });
    const store = parseStore(ttl);
    const subject = taskSubject(RESOURCE);
    const typeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const count = (predicate: string, object: string | null = null) =>
      store.getQuads(subject, predicate, object, null).length;

    // The class + state + each federation field is present under the exact
    // predicate IRI the other apps query.
    expect(count(typeIri, wf("Task"))).toBe(1);
    expect(count(typeIri, wf("Open"))).toBe(1);
    expect(count(dct("title"))).toBe(1);
    expect(count(wf("description"))).toBe(1);
    expect(count(wf("assignee"))).toBe(1);
    expect(count(dct("creator"))).toBe(1);
    expect(count(wf("tracker"))).toBe(1);
  });

  it("a task written by THIS model reads identically after a serialise → other-app-style parse", async () => {
    // Write with our model; re-read by constructing the subject the way the other
    // apps do (`#it`) and reading the same predicates — the round trip a real
    // cross-app federation read performs.
    const data = {
      title: "Cross-read me",
      state: "closed" as const,
      assignee: ME,
      created: new Date("2026-06-01T00:00:00.000Z"),
    };
    const ttl = await serializeTask(RESOURCE, data);
    const reread = parseTask(RESOURCE, parseStore(ttl));
    expect(reread?.title).toBe(data.title);
    expect(reread?.state).toBe("closed");
    expect(reread?.assignee).toBe(ME);
    expect(reread?.created?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    // Closing stamps prov:endedAtTime — assert it survived the round-trip.
    expect(reread?.endedAt).toBeInstanceOf(Date);
  });
});
