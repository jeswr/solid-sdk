// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// The owner-only, fail-closed ACL helper. The positive test PARSES the generated
// Turtle (never asserts on raw string shape) and proves it grants ONLY the owner
// Read/Write/Control over the container + descendants, with NO public grant.

import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it, vi } from "vitest";
import { aclUrlFor, buildOwnerOnlyAcl, writeOwnerOnlyAcl } from "./acl.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const CONTAINER = "https://alice.pod.example/health/diary/";
const OWNER = "https://alice.pod.example/profile/card#me";

describe("buildOwnerOnlyAcl — owner-only, fail-closed", () => {
  it("grants ONLY the owner Read/Write/Control over the container AND descendants", async () => {
    const turtle = await buildOwnerOnlyAcl(CONTAINER, OWNER);
    const ds = await parseRdf(turtle, "text/turtle", { baseIRI: aclUrlFor(CONTAINER) });
    const has = (p: string, o: string) =>
      ds.match(
        null,
        { termType: "NamedNode", value: p } as never,
        { termType: "NamedNode", value: o } as never,
      ).size > 0;

    expect(has(`${ACL}agent`, OWNER)).toBe(true);
    expect(has(`${ACL}accessTo`, CONTAINER)).toBe(true);
    expect(has(`${ACL}default`, CONTAINER)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Read`)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Write`)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Control`)).toBe(true);
  });

  it("PROVES NO PUBLIC ACCESS: no acl:agentClass / foaf:Agent / acl:agentGroup grant", async () => {
    const turtle = await buildOwnerOnlyAcl(CONTAINER, OWNER);
    const ds = await parseRdf(turtle, "text/turtle", { baseIRI: aclUrlFor(CONTAINER) });
    const anyObjectFor = (p: string) =>
      ds.match(null, { termType: "NamedNode", value: p } as never).size;
    expect(anyObjectFor(`${ACL}agentClass`)).toBe(0);
    expect(anyObjectFor(`${ACL}agentGroup`)).toBe(0);
    // No foaf:Agent anywhere (the public class).
    expect(turtle).not.toContain("foaf:Agent");
    expect(turtle).not.toContain("http://xmlns.com/foaf/0.1/Agent");
    // The ONLY agent is the owner.
    const agents = [
      ...ds.match(null, { termType: "NamedNode", value: `${ACL}agent` } as never),
    ].map((q) => (q.object as { value: string }).value);
    expect(agents).toEqual([OWNER]);
  });

  it("FAIL-CLOSED: throws on a non-http(s) / empty owner WebID rather than write an open ACL", async () => {
    await expect(buildOwnerOnlyAcl(CONTAINER, "")).rejects.toThrow(/fail-closed/);
    await expect(buildOwnerOnlyAcl(CONTAINER, "urn:not-a-webid")).rejects.toThrow(/fail-closed/);
    await expect(buildOwnerOnlyAcl(CONTAINER, "javascript:alert(1)")).rejects.toThrow(
      /fail-closed/,
    );
  });

  it("FAIL-CLOSED: refuses a FRAGMENT-bearing resourceUrl (would target the data resource)", async () => {
    // `.../x.ttl#it` + `.acl` = `.../x.ttl#it.acl`; fetch strips the fragment → the
    // ACL body would be PUT to `.../x.ttl` itself. Must throw.
    const subjectIri = "https://alice.pod.example/health/diary/meals/x.ttl#it";
    expect(() => aclUrlFor(subjectIri)).toThrow(/fragment/);
    await expect(buildOwnerOnlyAcl(subjectIri, OWNER)).rejects.toThrow(/fragment/);
  });

  it("FAIL-CLOSED: refuses a non-http(s) resourceUrl", () => {
    expect(() => aclUrlFor("file:///etc/passwd")).toThrow(/http/);
    expect(() => aclUrlFor("not-a-url")).toThrow(/absolute http/);
  });

  it("FAIL-CLOSED: refuses a resourceUrl carrying a QUERY string (would mis-target the .acl)", async () => {
    // `…/health/?v=1` + `.acl` = `…/health/?v=1.acl` → the ACL would protect a
    // DIFFERENT resource, leaving the real one open. Must throw.
    const withQuery = "https://alice.pod.example/health/diary/?v=1";
    expect(() => aclUrlFor(withQuery)).toThrow(/query/);
    await expect(buildOwnerOnlyAcl(withQuery, OWNER)).rejects.toThrow(/query/);
  });

  it("a plain resource URL yields resource+.acl and scopes accessTo to the resource", async () => {
    const resource = "https://alice.pod.example/health/diary/meals/x.ttl";
    expect(aclUrlFor(resource)).toBe(`${resource}.acl`);
    const ds = await parseRdf(await buildOwnerOnlyAcl(resource, OWNER), "text/turtle", {
      baseIRI: aclUrlFor(resource),
    });
    const accessTo = [
      ...ds.match(null, { termType: "NamedNode", value: `${ACL}accessTo` } as never),
    ].map((q) => (q.object as { value: string }).value);
    expect(accessTo).toEqual([resource]); // the resource itself, never the .acl doc or a fragment
  });
});

describe("writeOwnerOnlyAcl — injectable fetch seam (no server in unit tests)", () => {
  it("PUTs the ACL to the container's .acl resource with the owner-only body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    await writeOwnerOnlyAcl(CONTAINER, OWNER, fetchMock as unknown as typeof globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CONTAINER}.acl`);
    expect(init.method).toBe("PUT");
    expect(String(init.body)).toContain("acl:Read");
    expect(String(init.body)).toContain(OWNER);
  });

  it("FAIL-CLOSED: throws on a non-2xx ACL write (resource must not be treated as protected)", async () => {
    const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(
      writeOwnerOnlyAcl(CONTAINER, OWNER, fetchMock as unknown as typeof globalThis.fetch),
    ).rejects.toThrow(/ACL write failed/);
  });
});
