import { describe, it, expect, vi } from "vitest";
import { Store, Parser, DataFactory } from "n3";
import { resolveTrackerFromTypeIndex, registerTracker, resolveTaskContainersFromTypeIndex } from "./type-index";

const { namedNode } = DataFactory;

/** Solid type-index vocabulary IRIs (parse-side mirror of the writer's). */
const SOLID = "http://www.w3.org/ns/solid/terms#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/**
 * The federation discovery contract IRI: the `solid:forClass` value solid-issues
 * WRITES for its `wf:Task` instanceContainer registration. This MUST stay
 * byte-identical to the Pod Manager's `ISSUE_CLASS` constant
 * (`solid-pod-manager/src/lib/issues.ts` → `ISSUE_CLASS = "${WF}Task"` with
 * `WF = "http://www.w3.org/2005/01/wf/flow#"`), because PM's federated task
 * reader (`solid-pod-manager/src/lib/federation-tasks.ts` → `taskLocations()`)
 * filters cross-app registrations on `l.forClass === ISSUE_CLASS`. If either side
 * changes this IRI or the predicate/visibility form, cross-app task discovery
 * silently breaks — this test is the trip-wire. Do NOT import from the PM repo
 * (separate package); the contract is pinned here as a literal with this citation.
 */
const PM_ISSUE_CLASS_CONTRACT = "http://www.w3.org/2005/01/wf/flow#Task";

const WEBID = "http://localhost:3000/alice/profile/card#me";
const PROFILE = "http://localhost:3000/alice/profile/card";
const POD = "http://localhost:3000/alice/";
const INDEX = "http://localhost:3000/alice/settings/publicTypeIndex.ttl";
/** Tracker config document (the default project). */
const TRACKER = "http://localhost:3000/alice/issue-tracker/tracker.ttl";
/** Legacy constant kept for the wf:Tracker registration tests. */
const ISSUES = TRACKER;
/** The `issues/` container that solid-issues registers for `wf:Task` discovery. */
const ISSUES_CONTAINER = "http://localhost:3000/alice/issue-tracker/issues/";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A tiny router over fixed GET bodies; records PUTs. */
function router(get: Record<string, { body: string; etag?: string } | undefined>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: u, method, headers, body: init?.body as string | undefined });
    if (method === "GET") {
      const hit = get[u];
      if (!hit) return new Response("Not found", { status: 404 });
      return new Response(hit.body, {
        status: 200,
        headers: { "content-type": "text/turtle", ...(hit.etag ? { etag: hit.etag } : {}) },
      });
    }
    return new Response(null, { status: 205 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("type index", () => {
  it("resolves a tracker registered in the public type index", async () => {
    const { impl } = router({
      [WEBID]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<${WEBID}> solid:publicTypeIndex <${INDEX}>.`,
      },
      [INDEX]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
<#tracker> a solid:TypeRegistration; solid:forClass wf:Tracker; solid:instance <${ISSUES}>.`,
      },
    });
    expect(await resolveTrackerFromTypeIndex(WEBID, impl)).toBe(ISSUES);
  });

  it("returns undefined when the profile has no type index", async () => {
    const { impl } = router({
      [WEBID]: { body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.` },
    });
    expect(await resolveTrackerFromTypeIndex(WEBID, impl)).toBeUndefined();
  });

  it("creates and links the index, registering the tracker, when absent", async () => {
    const { impl, calls } = router({
      // profile exists but has no publicTypeIndex; index 404s.
      [WEBID]: { body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, etag: '"p1"' },
    });
    const ok = await registerTracker(WEBID, POD, TRACKER, impl);
    expect(ok).toBe(true);

    const puts = calls.filter((c) => c.method === "PUT");
    const profilePut = puts.find((c) => c.url === PROFILE);
    const indexPut = puts.find((c) => c.url === INDEX);

    expect(profilePut?.headers["if-match"]).toBe('"p1"');
    expect(profilePut?.body).toContain("publicTypeIndex");
    expect(indexPut?.body).toContain("TypeRegistration");
    expect(indexPut?.body).toContain("flow#Tracker");
    expect(indexPut?.body).toContain(TRACKER);
    expect(indexPut?.headers["if-none-match"]).toBeUndefined(); // created via plain PUT (no prior etag)
  });

  it("registers wf:Task instanceContainer pointing at issues/ alongside the wf:Tracker registration", async () => {
    const { impl, calls } = router({
      // profile exists but has no publicTypeIndex; index 404s.
      [WEBID]: { body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, etag: '"p1"' },
    });
    const ok = await registerTracker(WEBID, POD, TRACKER, impl);
    expect(ok).toBe(true);

    const indexPut = calls.filter((c) => c.method === "PUT").find((c) => c.url === INDEX);
    // Must carry solid:instanceContainer pointing at the issues/ container
    // (D6, FEDERATION-DESIGN.staged.md §2.1 — cross-app wf:Task discovery seam).
    expect(indexPut?.body).toContain("flow#Task");
    expect(indexPut?.body).toContain("instanceContainer");
    expect(indexPut?.body).toContain(ISSUES_CONTAINER);
  });

  it("resolveTaskContainersFromTypeIndex returns the issues container registered for wf:Task", async () => {
    const { impl } = router({
      [WEBID]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<${WEBID}> solid:publicTypeIndex <${INDEX}>.`,
      },
      [INDEX]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
<#reg-tracker> a solid:TypeRegistration; solid:forClass wf:Tracker; solid:instance <${TRACKER}>.
<#reg-task> a solid:TypeRegistration; solid:forClass wf:Task; solid:instanceContainer <${ISSUES_CONTAINER}>.`,
      },
    });
    const containers = await resolveTaskContainersFromTypeIndex(WEBID, impl);
    expect(containers).toContain(ISSUES_CONTAINER);
  });

  it("does not re-register wf:Task instanceContainer when already present", async () => {
    const { impl, calls } = router({
      [WEBID]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<${WEBID}> solid:publicTypeIndex <${INDEX}>.`,
        etag: '"p1"',
      },
      [INDEX]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
<#reg-tracker> a solid:TypeRegistration; solid:forClass wf:Tracker; solid:instance <${TRACKER}>.
<#reg-task> a solid:TypeRegistration; solid:forClass wf:Task; solid:instanceContainer <${ISSUES_CONTAINER}>.`,
        etag: '"i1"',
      },
    });
    await registerTracker(WEBID, POD, TRACKER, impl);
    const indexPut = calls.filter((c) => c.method === "PUT").find((c) => c.url === INDEX);
    // index is updated (Tracker + Task already present, but index PUT is still
    // issued to keep the idempotency contract and refresh the ACL grant).
    // The body must NOT contain a duplicate wf:Task registration fragment.
    const body = indexPut?.body ?? "";
    const taskMatches = [...body.matchAll(/flow#Task/g)];
    expect(taskMatches.length).toBe(1); // exactly one registration
  });

  // P0-3 (#75 federation linchpin): the END-TO-END cross-app discovery contract.
  // The other tests assert the PARTS via string-contains on the serialised Turtle;
  // this one PARSES the public type-index PUT body into a graph and pins, in a
  // single assertion, the exact (forClass IRI + instanceContainer predicate +
  // public/listed document type) tuple that the Pod Manager's federated task
  // reader filters on. A change on EITHER side that breaks discovery fails here.
  it("pins the wf:Task federation discovery contract the Pod Manager reads (P0-3, #75)", async () => {
    const { impl, calls } = router({
      // profile exists but has no publicTypeIndex; index 404s → created fresh.
      [WEBID]: { body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, etag: '"p1"' },
    });
    const ok = await registerTracker(WEBID, POD, TRACKER, impl);
    expect(ok).toBe(true);

    const indexPut = calls.filter((c) => c.method === "PUT").find((c) => c.url === INDEX);
    expect(indexPut?.body, "the public type index must be PUT").toBeTruthy();

    // Parse the PUT body into a graph — never regex/string-assert the Turtle
    // (house rule: query the parsed RDF, do not hand-match serialised triples).
    const store = new Store();
    store.addQuads(new Parser({ baseIRI: INDEX }).parse(indexPut!.body as string));

    // (1) The document subject is a PUBLIC, LISTED type index — so an assignee's
    //     Pod Manager can read it (CSS makes new resources owner-only; the writer
    //     also grants public read). Proves it is the PUBLIC index PM discovers.
    const docTypes = store
      .getQuads(namedNode(INDEX), namedNode(RDF_TYPE), null, null)
      .map((q) => q.object.value);
    expect(docTypes).toContain(`${SOLID}TypeIndex`);
    expect(docTypes).toContain(`${SOLID}ListedDocument`);

    // (2) There is a solid:TypeRegistration whose solid:forClass is EXACTLY PM's
    //     ISSUE_CLASS contract IRI AND whose solid:instanceContainer is the
    //     issues/ container. Resolve it by querying the parsed graph.
    const taskRegistration = store
      .getQuads(null, namedNode(`${SOLID}forClass`), namedNode(PM_ISSUE_CLASS_CONTRACT), null)
      .map((q) => q.subject)
      // keep only subjects actually typed as a TypeRegistration
      .filter(
        (subj) =>
          store.getQuads(subj, namedNode(RDF_TYPE), namedNode(`${SOLID}TypeRegistration`), null)
            .length > 0,
      );
    expect(
      taskRegistration.length,
      "expected one solid:TypeRegistration for wf:Task",
    ).toBe(1);
    const taskSubject = taskRegistration[0];

    // forClass object string EQUALS PM's ISSUE_CLASS literal (the hard contract).
    const forClassObjects = store
      .getQuads(taskSubject, namedNode(`${SOLID}forClass`), null, null)
      .map((q) => q.object.value);
    expect(forClassObjects).toEqual([PM_ISSUE_CLASS_CONTRACT]);

    // The instanceContainer predicate (NOT solid:instance) points at issues/.
    const containers = store
      .getQuads(taskSubject, namedNode(`${SOLID}instanceContainer`), null, null)
      .map((q) => q.object.value);
    expect(containers).toEqual([ISSUES_CONTAINER]);
  });

  it("does not rewrite the profile link when already registered", async () => {
    const { impl, calls } = router({
      [WEBID]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<${WEBID}> solid:publicTypeIndex <${INDEX}>.`,
        etag: '"p1"',
      },
      [INDEX]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
<#tracker> a solid:TypeRegistration; solid:forClass wf:Tracker; solid:instance <${TRACKER}>.`,
        etag: '"i1"',
      },
    });
    await registerTracker(WEBID, POD, TRACKER, impl);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.find((c) => c.url === PROFILE)).toBeUndefined(); // link already present
  });
});
