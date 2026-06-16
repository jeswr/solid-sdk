// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { agentCardUrl, agentDescriptionsUrl, discoverAgent } from "../src/discover.js";
import { buildAgentPointer } from "../src/pointer.js";
import type { AgentDescriptor } from "../src/types.js";
import { HAS_AUTHORIZATION_AGENT } from "../src/vocab.js";

const WEBID = "https://alice.pod.example/profile/card#me";
const AGENT = "https://alice.pod.example/agent";
const DESCRIPTOR: AgentDescriptor = {
  id: AGENT,
  name: "Alice's Agent",
  owner: WEBID,
  skills: [{ id: "schedule", name: "Scheduling" }],
  securitySchemes: [{ type: "solid-oidc", issuer: "https://idp.example/" }],
};

/** Build a fetch that serves a profile (pointer) at WEBID and the descriptor at AGENT. */
async function buildFetch(
  opts: { pointer?: string; descriptor?: string; descriptorStatus?: number } = {},
): Promise<typeof globalThis.fetch> {
  const pointer = opts.pointer ?? (await buildAgentPointer(WEBID, AGENT).toString());
  const descriptor =
    opts.descriptor ?? (await describeAgent(DESCRIPTOR).agentDescription.toTurtle());
  return (async (url: string | URL) => {
    const u = String(url);
    if (u === WEBID) {
      return new Response(pointer, { status: 200, headers: { "content-type": "text/turtle" } });
    }
    if (u === AGENT) {
      return new Response(descriptor, {
        status: opts.descriptorStatus ?? 200,
        headers: { "content-type": "text/turtle" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("discoverAgent — validation", () => {
  it("throws without a webId", async () => {
    await expect(discoverAgent("")).rejects.toThrow(/webId is required/);
  });
});

describe("discoverAgent — pointer reading", () => {
  it("reads the interop:hasAuthorizationAgent pointer and resolves the descriptor", async () => {
    const fetch = await buildFetch();
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toHaveLength(1);
    expect(r.pointers[0]).toMatchObject({
      webId: WEBID,
      agent: AGENT,
      predicate: HAS_AUTHORIZATION_AGENT,
    });
    expect(r.descriptor?.name).toBe("Alice's Agent");
    expect(r.verification?.valid).toBe(true);
  });

  it("reads multiple pointers and prefers interop over schema (priority order)", async () => {
    const pointer = await buildAgentPointer(WEBID, AGENT, [
      "schema:agent",
      "interop:hasAuthorizationAgent",
    ]).toString();
    const fetch = await buildFetch({ pointer });
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toHaveLength(2);
    // The FIRST (resolved) pointer is the interop one regardless of doc order.
    expect(r.pointers[0]?.predicate).toBe(HAS_AUTHORIZATION_AGENT);
  });

  it("can return pointers only (resolveDescriptor=false, single fetch)", async () => {
    let calls = 0;
    const inner = await buildFetch();
    const fetch = (async (url: string | URL) => {
      calls++;
      return inner(url as string);
    }) as unknown as typeof globalThis.fetch;
    const r = await discoverAgent(WEBID, { fetch, resolveDescriptor: false });
    expect(r.pointers).toHaveLength(1);
    expect(r.descriptor).toBeUndefined();
    expect(calls).toBe(1); // profile only — no descriptor fetch
  });

  it("returns no pointers (and no throw) when the profile does not resolve", async () => {
    const fetch = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof globalThis.fetch;
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toEqual([]);
    expect(r.descriptor).toBeUndefined();
  });

  it("returns no pointers when the profile has none", async () => {
    const fetch = (async () =>
      new Response(
        '@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n<https://alice.pod.example/profile/card#me> foaf:name "Alice".',
        {
          status: 200,
          headers: { "content-type": "text/turtle" },
        },
      )) as unknown as typeof globalThis.fetch;
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toEqual([]);
  });

  it("skips a non-IRI (literal) pointer object", async () => {
    const pointer = `@prefix interop: <http://www.w3.org/ns/solid/interop#>.
<${WEBID}> interop:hasAuthorizationAgent "not-an-iri".`;
    const fetch = await buildFetch({ pointer });
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toEqual([]);
  });
});

describe("discoverAgent — descriptor resolution failures", () => {
  it("surfaces fetch-failed when the descriptor 404s, keeping the pointer", async () => {
    const fetch = await buildFetch({ descriptorStatus: 404 });
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.pointers).toHaveLength(1);
    expect(r.descriptor).toBeUndefined();
    expect(r.verification?.valid).toBe(false);
    expect(r.verification?.issues[0]?.code).toBe("fetch-failed");
  });

  it("surfaces a subject-mismatch when the resolved descriptor describes another agent", async () => {
    const descriptor = `@prefix ad: <https://w3id.org/agent-description#>.
<https://evil/agent> a ad:AgentDescription ; ad:name "Evil" ; ad:url <https://evil/agent>.`;
    const fetch = await buildFetch({ descriptor });
    const r = await discoverAgent(WEBID, { fetch });
    expect(r.verification?.valid).toBe(false);
    expect(r.verification?.issues.map((i) => i.code)).toContain("subject-mismatch");
  });
});

describe("well-known URL helpers", () => {
  it("agentDescriptionsUrl uses the ANP path on the origin (drops path/fragment)", () => {
    expect(agentDescriptionsUrl(WEBID)).toBe(
      "https://alice.pod.example/.well-known/agent-descriptions",
    );
    expect(agentDescriptionsUrl("https://host.example/deep/path?q=1")).toBe(
      "https://host.example/.well-known/agent-descriptions",
    );
  });

  it("agentCardUrl uses the A2A path on the origin", () => {
    expect(agentCardUrl(WEBID)).toBe("https://alice.pod.example/.well-known/agent-card.json");
  });

  it("preserves a non-default port in the origin", () => {
    expect(agentDescriptionsUrl("http://localhost:3000/profile#me")).toBe(
      "http://localhost:3000/.well-known/agent-descriptions",
    );
  });
});
