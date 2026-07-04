// AUTHORED-BY Claude Fable 5
//
// End-to-end WebID → Agent Card discovery, modelled on the REAL target profile
// (https://jeswr.org/ — the maintainer's homepage IS the WebID document, served
// as Turtle by content negotiation). These tests prove the exact recipe in
// docs/WEBID-DISCOVERY.md: add the pointer triples to the WebID doc, host the
// emitted Agent Description on the pod, and `discoverAgent(webid)` finds +
// verifies it — including the owner back-link (`ad:owner` → the WebID).
//
// The fixture deliberately keeps the real profile's quirks:
//   - a busy graph (foaf/schema/solid/space/ldp triples the reader must skip),
//   - TWO person subjects (`https://jeswr.org/#me` and the www variant) — the
//     pointer must be read subject-exactly from the WebID asked about,
//   - the pod on a DIFFERENT origin (solid-test.jeswr.org) than the WebID
//     (jeswr.org) — the common Solid deployment shape.

import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { discoverAgent } from "../src/discover.js";
import { buildAgentPointer } from "../src/pointer.js";
import type { AgentDescriptor } from "../src/types.js";
import { HAS_AUTHORIZATION_AGENT, SCHEMA_AGENT } from "../src/vocab.js";

const WEBID = "https://jeswr.org/#me";
const WWW_WEBID = "https://www.jeswr.org/#me";
const AGENT = "https://solid-test.jeswr.org/jeswr/public/agent";
const IDP = "https://idp.solid-test.jeswr.org";

/** The maintainer's agent, as the recipe would emit it. */
const JESWR_AGENT: AgentDescriptor = {
  id: AGENT,
  name: "Jesse's Agent",
  description: "The agent that represents Jesse Wright's WebID on the Solid suite.",
  owner: WEBID,
  skills: [{ id: "negotiate-data-sharing", name: "Negotiate data sharing", tags: ["odrl"] }],
  securitySchemes: [{ type: "solid-oidc", issuer: IDP }],
};

/**
 * A jeswr.org-shaped WebID profile: the real document's busy graph + both
 * person subjects, with the recipe's pointer triples appended for `#me`.
 */
async function jeswrProfile(opts: { pointer?: boolean; wwwOnly?: boolean } = {}): Promise<string> {
  const base = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix schema: <http://schema.org/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix space: <http://www.w3.org/ns/pim/space#> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .

<${WWW_WEBID}> a foaf:Person, schema:Person ;
  foaf:name "Jesse Wright"@en ;
  solid:oidcIssuer <${IDP}> ;
  space:storage <https://solid-test.jeswr.org/jeswr/> ;
  ldp:inbox <https://solid-test.jeswr.org/jeswr/inbox/> .

<${WEBID}> a schema:Person ;
  schema:name "Jesse Wright" ;
  schema:jobTitle "Solid Project Lead" .
`;
  if (opts.pointer === false) {
    return base;
  }
  // The recipe's pointer block: both predicates, attached to the subject the
  // caller will actually ask about (the www variant when wwwOnly — the
  // negative case proving subject-exact reads).
  const subject = opts.wwwOnly ? WWW_WEBID : WEBID;
  const pointer = await buildAgentPointer(subject, AGENT, [
    "interop:hasAuthorizationAgent",
    "schema:agent",
  ]).toString();
  return `${base}\n${pointer}`;
}

/** Serve the profile at both WebID spellings and the descriptor at the agent IRI. */
function podFetch(profile: string, descriptorTurtle: string): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u === WEBID || u === "https://jeswr.org/" || u === WWW_WEBID) {
      return new Response(profile, { status: 200, headers: { "content-type": "text/turtle" } });
    }
    if (u === AGENT) {
      return new Response(descriptorTurtle, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("WebID → Agent Card end-to-end (the jeswr.org recipe)", () => {
  it("discovers + verifies the agent from a jeswr.org-shaped profile, owner back-link confirmed", async () => {
    const descriptor = await describeAgent(JESWR_AGENT).agentDescription.toTurtle();
    const fetch = podFetch(await jeswrProfile(), descriptor);

    const r = await discoverAgent(WEBID, { fetch, requireOwnerMatch: true });

    // Both recipe predicates were read; interop wins the priority order.
    expect(r.pointers.map((p) => p.predicate).sort()).toEqual(
      [HAS_AUTHORIZATION_AGENT, SCHEMA_AGENT].sort(),
    );
    expect(r.pointers[0]?.predicate).toBe(HAS_AUTHORIZATION_AGENT);
    expect(r.pointers[0]?.agent).toBe(AGENT);
    // The descriptor resolved from the pod (a different origin) and verified.
    expect(r.verification?.valid).toBe(true);
    expect(r.descriptor?.name).toBe("Jesse's Agent");
    expect(r.descriptor?.securitySchemes?.[0]).toMatchObject({ type: "solid-oidc", issuer: IDP });
    // The owner back-link: the description names the WebID we started from.
    expect(r.ownerMatchesWebId).toBe(true);
  });

  it("reads the pointer subject-exactly: a pointer on the www subject is NOT the apex WebID's", async () => {
    const descriptor = await describeAgent(JESWR_AGENT).agentDescription.toTurtle();
    const fetch = podFetch(await jeswrProfile({ wwwOnly: true }), descriptor);

    const r = await discoverAgent(WEBID, { fetch });
    // https://jeswr.org/#me has no pointer — the triple sits on the www variant.
    expect(r.pointers).toEqual([]);
    expect(r.descriptor).toBeUndefined();
  });

  it("a profile without the recipe's pointer block yields no pointers", async () => {
    const descriptor = await describeAgent(JESWR_AGENT).agentDescription.toTurtle();
    const fetch = podFetch(await jeswrProfile({ pointer: false }), descriptor);
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toEqual([]);
  });
});

describe("the owner back-link (ownerMatchesWebId / requireOwnerMatch)", () => {
  /** Discover against a descriptor whose owner is `owner` (null ⇒ NO ad:owner emitted). */
  async function discoverWith(owner: string | null, requireOwnerMatch: boolean) {
    const { owner: _drop, ...ownerless } = JESWR_AGENT;
    const agent: AgentDescriptor = owner === null ? ownerless : { ...ownerless, owner };
    const descriptor = await describeAgent(agent).agentDescription.toTurtle();
    const fetch = podFetch(await jeswrProfile(), descriptor);
    return discoverAgent(WEBID, { fetch, requireOwnerMatch });
  }

  it("surfaces ownerMatchesWebId=false (without failing) when the owner is a THIRD PARTY and requireOwnerMatch is off", async () => {
    const r = await discoverWith("https://someone-else.example/profile#me", false);
    expect(r.verification?.valid).toBe(true); // well-formed — but…
    expect(r.ownerMatchesWebId).toBe(false); // …it never claimed to represent this WebID
  });

  it("fails verification with owner-mismatch when the owner is a third party and requireOwnerMatch is on", async () => {
    const r = await discoverWith("https://someone-else.example/profile#me", true);
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
    const issue = r.verification?.issues.find((i) => i.code === "owner-mismatch");
    expect(issue?.message).toContain("someone-else.example");
    expect(issue?.value).toBe("https://someone-else.example/profile#me");
  });

  it("fail-closed: a descriptor with NO ad:owner fails requireOwnerMatch (no claim ≠ a confirmed back-link)", async () => {
    const r = await discoverWith(null, true);
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
    const issue = r.verification?.issues.find((i) => i.code === "owner-mismatch");
    expect(issue?.message).toMatch(/no ad:owner/);
  });

  it("exact IRI equality: an owner of the www variant does NOT match the apex WebID", async () => {
    const r = await discoverWith(WWW_WEBID, true);
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
  });

  it("leaves ownerMatchesWebId undefined when no descriptor was resolved", async () => {
    const fetch = podFetch(await jeswrProfile({ pointer: false }), "");
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.ownerMatchesWebId).toBeUndefined();
  });
});

describe("the owner back-link is order-independent (multi-owner ambiguity, fail-closed)", () => {
  const Third = "https://someone-else.example/profile#me";

  /**
   * Serve a descriptor with TWO ad:owner triples in the given order (the
   * projected descriptor would keep only the first — so a passes-by-order bug
   * would flip with the order). The raw-term check must reject BOTH ways.
   */
  async function discoverWithTwoOwners(first: string, second: string, requireOwnerMatch: boolean) {
    const descriptor = `@prefix ad: <https://w3id.org/agent-description#>.
<${AGENT}> a ad:AgentDescription ;
  ad:name "Jesse's Agent" ;
  ad:url <${AGENT}> ;
  ad:owner <${first}> ;
  ad:owner <${second}> .`;
    const fetch = podFetch(await jeswrProfile(), descriptor);
    return discoverAgent(WEBID, { fetch, requireOwnerMatch });
  }

  it("matching-then-mismatching: fails closed (multiple), not passed by first-owner order", async () => {
    const r = await discoverWithTwoOwners(WEBID, Third, true);
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
    const issue = r.verification?.issues.find((i) => i.code === "owner-mismatch");
    expect(issue?.message).toMatch(/2 ad:owner|ambiguous/);
  });

  it("mismatching-then-matching: fails closed the SAME way (order-independent)", async () => {
    const r = await discoverWithTwoOwners(Third, WEBID, true);
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
    const issue = r.verification?.issues.find((i) => i.code === "owner-mismatch");
    expect(issue?.message).toMatch(/2 ad:owner|ambiguous/);
  });

  it("two IDENTICAL matching owner triples are ONE triple in RDF (set semantics) → still a match", async () => {
    // An RDF graph is a SET: `<a> ad:owner <b> . <a> ad:owner <b> .` is a single
    // quad, not two. So a duplicate matching owner is genuinely one distinct
    // owner and the exactly-one back-link holds. (Only DISTINCT owner values
    // create the ambiguity the fail-closed guard rejects.)
    const r = await discoverWithTwoOwners(WEBID, WEBID, true);
    expect(r.ownerMatchesWebId).toBe(true);
    expect(r.verification?.valid).toBe(true);
  });

  it("reports ownerMatchesWebId=false for multiple owners even without requireOwnerMatch", async () => {
    const r = await discoverWithTwoOwners(WEBID, Third, false);
    expect(r.ownerMatchesWebId).toBe(false);
    // Not required → the descriptor is still well-formed (multiple ad:owner is
    // not a verifyDescriptor error); only the back-link flag reflects it.
    expect(r.verification?.valid).toBe(true);
  });

  it("a non-IRI ad:owner (literal) fails closed under requireOwnerMatch", async () => {
    const descriptor = `@prefix ad: <https://w3id.org/agent-description#>.
<${AGENT}> a ad:AgentDescription ; ad:name "X" ; ad:url <${AGENT}> ; ad:owner "${WEBID}" .`;
    const fetch = podFetch(await jeswrProfile(), descriptor);
    const r = await discoverAgent(WEBID, { fetch, requireOwnerMatch: true });
    expect(r.ownerMatchesWebId).toBe(false);
    expect(r.verification?.valid).toBe(false);
    const issue = r.verification?.issues.find((i) => i.code === "owner-mismatch");
    expect(issue?.message).toMatch(/not an IRI/);
  });
});
