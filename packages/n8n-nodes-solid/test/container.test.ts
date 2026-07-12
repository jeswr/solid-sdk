// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { parseContainerListing } from "../src/container.js";

const BASE = "https://alice.pod.example/data/";
const CONTAINER = "https://alice.pod.example/data/notes/";

const TURTLE = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}>
  a ldp:Container, ldp:BasicContainer ;
  ldp:contains <${CONTAINER}a.ttl>, <${CONTAINER}b.ttl>, <${CONTAINER}sub/> .
`;

describe("parseContainerListing — Turtle", () => {
  it("parses ldp:contains members with absolute URLs and container flags", async () => {
    const members = await parseContainerListing(TURTLE, "text/turtle", CONTAINER, BASE);
    const byUrl = Object.fromEntries(members.map((m) => [m.url, m.container]));
    expect(byUrl).toEqual({
      [`${CONTAINER}a.ttl`]: false,
      [`${CONTAINER}b.ttl`]: false,
      [`${CONTAINER}sub/`]: true,
    });
  });

  it("resolves RELATIVE ldp:contains IRIs against the container baseIRI", async () => {
    // Members written as relative IRIs (a.ttl, b.ttl) must come back absolute.
    const relative = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<> a ldp:Container ; ldp:contains <a.ttl>, <b.ttl> .
`;
    const members = await parseContainerListing(relative, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url).sort()).toEqual([`${CONTAINER}a.ttl`, `${CONTAINER}b.ttl`]);
  });

  it("excludes the container's self-member", async () => {
    const selfListing = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ; ldp:contains <${CONTAINER}>, <${CONTAINER}a.ttl> .
`;
    const members = await parseContainerListing(selfListing, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url)).toEqual([`${CONTAINER}a.ttl`]);
  });

  it("excludes a SLASHLESS self-alias of the container (roborev Low finding, 13311df)", async () => {
    // `podScopedUrl(..., { allowRoot: true })` treats the container's
    // slash-terminated and slashless spellings as the SAME root, so a
    // hostile/buggy server listing `<.../notes>` (no trailing slash) instead of
    // `<.../notes/>` came back canonicalised to that slashless string — which
    // did not string-equal `containerUrl` and so slipped past the (pre-fix)
    // self-member check as a bogus non-container "member" duplicating the
    // container itself.
    const slashlessSelf = CONTAINER.slice(0, -1); // "https://.../data/notes"
    const selfListing = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ; ldp:contains <${slashlessSelf}>, <${CONTAINER}a.ttl> .
`;
    const members = await parseContainerListing(selfListing, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url)).toEqual([`${CONTAINER}a.ttl`]);
  });

  it("returns [] for a valid but empty container", async () => {
    const empty = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${CONTAINER}> a ldp:Container .\n`;
    const members = await parseContainerListing(empty, "text/turtle", CONTAINER, BASE);
    expect(members).toEqual([]);
  });
});

describe("parseContainerListing — JSON-LD", () => {
  it("parses ldp:contains from a JSON-LD container document", async () => {
    const jsonld = JSON.stringify({
      "@id": CONTAINER,
      "@type": "http://www.w3.org/ns/ldp#Container",
      "http://www.w3.org/ns/ldp#contains": [
        { "@id": `${CONTAINER}a.ttl` },
        { "@id": `${CONTAINER}b.ttl` },
      ],
    });
    const members = await parseContainerListing(jsonld, "application/ld+json", CONTAINER, BASE);
    expect(members.map((m) => m.url).sort()).toEqual([`${CONTAINER}a.ttl`, `${CONTAINER}b.ttl`]);
  });
});

describe("parseContainerListing — scope guard (defence in depth)", () => {
  it("drops a member injected from a foreign origin", async () => {
    const hostile = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ;
  ldp:contains <${CONTAINER}ok.ttl>, <https://evil.example/stolen.ttl> .
`;
    const members = await parseContainerListing(hostile, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url)).toEqual([`${CONTAINER}ok.ttl`]);
  });

  it("drops a member that escapes the pod base path", async () => {
    const hostile = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ;
  ldp:contains <${CONTAINER}ok.ttl>, <https://alice.pod.example/other/x.ttl> .
`;
    const members = await parseContainerListing(hostile, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url)).toEqual([`${CONTAINER}ok.ttl`]);
  });

  it("drops a member carrying an encoded path delimiter (..%2f smuggling)", async () => {
    // A hostile listing could inject a member whose ENCODED slash passes the
    // textual prefix check but aliases above the base on a server that decodes
    // before normalising — the encoded-delimiter guard drops it.
    const hostile = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ;
  ldp:contains <${CONTAINER}ok.ttl>, <${CONTAINER}..%2f..%2fsecret.ttl> .
`;
    const members = await parseContainerListing(hostile, "text/turtle", CONTAINER, BASE);
    expect(members.map((m) => m.url)).toEqual([`${CONTAINER}ok.ttl`]);
  });
});
