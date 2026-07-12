// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for resolvePhotosRoot — the host's Type-Index discovery of the
// schema:Photograph gallery container, with the conventional ${podRoot}photos/
// fallback. Covers the discovery gap roborev flagged (Medium): a profile may
// advertise a PRIVATE index that lacks the registration while the PUBLIC index
// HAS it — discovery must consult BOTH advertised indexes (private then public)
// before falling back, not just `privateIndex ?? publicIndex`.
//
// freshRdf reads `response.text()` and dispatches on the content-type header, so
// the stub fetch returns Turtle Responses keyed by URL — no live server.

import { describe, expect, it } from "vitest";
import { resolvePhotosRoot } from "./photos-root";

const WEBID = "https://alice.example/profile/card#me";
const POD = "https://alice.example/";
const PRIVATE_INDEX = "https://alice.example/settings/privateTypeIndex.ttl";
const PUBLIC_INDEX = "https://alice.example/settings/publicTypeIndex.ttl";

const SOLID = "http://www.w3.org/ns/solid/terms#";
const SCHEMA = "https://schema.org/";

const FOAF = "http://xmlns.com/foaf/0.1/";

/**
 * A VALID WebID profile advertising the given type-index links (none ⇒ a
 * well-formed profile with zero solid:*TypeIndex links). The `a foaf:Person`
 * triple is always present so the no-link case is still parseable Turtle —
 * exercising "valid profile, no index advertised" rather than the
 * unparseable-profile catch path (which its own test covers).
 */
function profileTtl(opts: { privateIndex?: string; publicIndex?: string }): string {
  const triples = [`  a <${FOAF}Person>`];
  if (opts.privateIndex) triples.push(`  solid:privateTypeIndex <${opts.privateIndex}>`);
  if (opts.publicIndex) triples.push(`  solid:publicTypeIndex <${opts.publicIndex}>`);
  return `@prefix solid: <${SOLID}> .\n<${WEBID}>\n${triples.join(" ;\n")} .\n`;
}

/** A Type Index registering schema:Photograph at the given instanceContainer. */
function photographIndexTtl(container: string): string {
  return [
    `@prefix solid: <${SOLID}> .`,
    `@prefix schema: <${SCHEMA}> .`,
    `<#reg> a solid:TypeRegistration ;`,
    `  solid:forClass schema:Photograph ;`,
    `  solid:instanceContainer <${container}> .`,
  ].join("\n");
}

/** A Type Index with NO schema:Photograph registration (an unrelated class). */
function emptyIndexTtl(): string {
  return [
    `@prefix solid: <${SOLID}> .`,
    `@prefix schema: <${SCHEMA}> .`,
    `<#reg> a solid:TypeRegistration ;`,
    `  solid:forClass schema:TextDigitalDocument ;`,
    `  solid:instanceContainer <${POD}documents/> .`,
  ].join("\n");
}

function turtle(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
}

/** Build a stub fetch that serves Turtle bodies per URL; unknown URLs 404. */
function stubFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return turtle(body);
  }) as unknown as typeof fetch;
}

describe("resolvePhotosRoot", () => {
  it("discovers the schema:Photograph container from the private Type Index", async () => {
    const container = `${POD}my-photos/`;
    const fetchImpl = stubFetch({
      [WEBID]: profileTtl({ privateIndex: PRIVATE_INDEX }),
      [PRIVATE_INDEX]: photographIndexTtl(container),
    });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root).toEqual({ rootUrl: container, isFallback: false });
  });

  it("falls back to the public Type Index when the private one lacks the registration (roborev Medium)", async () => {
    const container = `${POD}public-photos/`;
    const fetchImpl = stubFetch({
      // Both indexes advertised; private one exists but has NO schema:Photograph.
      [WEBID]: profileTtl({ privateIndex: PRIVATE_INDEX, publicIndex: PUBLIC_INDEX }),
      [PRIVATE_INDEX]: emptyIndexTtl(),
      [PUBLIC_INDEX]: photographIndexTtl(container),
    });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    // Must NOT fall straight back to ${podRoot}photos/ — the public index wins.
    expect(root).toEqual({ rootUrl: container, isFallback: false });
  });

  it("consults the public index when the private index is unreadable", async () => {
    const container = `${POD}public-photos/`;
    const fetchImpl = stubFetch({
      [WEBID]: profileTtl({ privateIndex: PRIVATE_INDEX, publicIndex: PUBLIC_INDEX }),
      // PRIVATE_INDEX intentionally absent (404 → unreadable) — must not abort.
      [PUBLIC_INDEX]: photographIndexTtl(container),
    });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root).toEqual({ rootUrl: container, isFallback: false });
  });

  it("normalises a non-slash instanceContainer to a trailing slash", async () => {
    const fetchImpl = stubFetch({
      [WEBID]: profileTtl({ privateIndex: PRIVATE_INDEX }),
      [PRIVATE_INDEX]: photographIndexTtl(`${POD}gallery`), // no trailing slash
    });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root.rootUrl).toBe(`${POD}gallery/`);
    expect(root.isFallback).toBe(false);
  });

  it("falls back to the conventional <podRoot>photos/ when no index is advertised", async () => {
    const fetchImpl = stubFetch({ [WEBID]: profileTtl({}) });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root).toEqual({ rootUrl: `${POD}photos/`, isFallback: true });
  });

  it("falls back when neither advertised index registers schema:Photograph", async () => {
    const fetchImpl = stubFetch({
      [WEBID]: profileTtl({ privateIndex: PRIVATE_INDEX, publicIndex: PUBLIC_INDEX }),
      [PRIVATE_INDEX]: emptyIndexTtl(),
      [PUBLIC_INDEX]: emptyIndexTtl(),
    });
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root).toEqual({ rootUrl: `${POD}photos/`, isFallback: true });
  });

  it("falls back when the profile itself is unreadable", async () => {
    const fetchImpl = stubFetch({}); // WebID 404s
    const root = await resolvePhotosRoot({ webId: WEBID, podRoot: POD, fetchImpl });
    expect(root).toEqual({ rootUrl: `${POD}photos/`, isFallback: true });
  });
});
