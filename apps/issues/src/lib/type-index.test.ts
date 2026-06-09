import { describe, it, expect, vi } from "vitest";
import { resolveTrackerFromTypeIndex, registerTracker } from "./type-index";

const WEBID = "http://localhost:3000/alice/profile/card#me";
const PROFILE = "http://localhost:3000/alice/profile/card";
const POD = "http://localhost:3000/alice/";
const INDEX = "http://localhost:3000/alice/settings/publicTypeIndex.ttl";
const ISSUES = "http://localhost:3000/alice/issue-tracker/issues.ttl";

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
    const ok = await registerTracker(WEBID, POD, ISSUES, impl);
    expect(ok).toBe(true);

    const puts = calls.filter((c) => c.method === "PUT");
    const profilePut = puts.find((c) => c.url === PROFILE);
    const indexPut = puts.find((c) => c.url === INDEX);

    expect(profilePut?.headers["if-match"]).toBe('"p1"');
    expect(profilePut?.body).toContain("publicTypeIndex");
    expect(indexPut?.body).toContain("TypeRegistration");
    expect(indexPut?.body).toContain("flow#Tracker");
    expect(indexPut?.body).toContain(ISSUES);
    expect(indexPut?.headers["if-none-match"]).toBeUndefined(); // created via plain PUT (no prior etag)
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
<#tracker> a solid:TypeRegistration; solid:forClass wf:Tracker; solid:instance <${ISSUES}>.`,
        etag: '"i1"',
      },
    });
    await registerTracker(WEBID, POD, ISSUES, impl);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.find((c) => c.url === PROFILE)).toBeUndefined(); // link already present
  });
});
