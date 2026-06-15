import { describe, it, expect, vi } from "vitest";
import { resolveTrackerFromTypeIndex, registerTracker, resolveTaskContainersFromTypeIndex } from "./type-index";

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
