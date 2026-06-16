// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Targeted edge-case coverage for the validation + serialisation branches the
// happy-path round-trips don't reach.
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { discoverAgent } from "../src/discover.js";
import { serialize } from "../src/serialize.js";
import { verifyDescriptor } from "../src/verify.js";

describe("verify — optional-field branches", () => {
  it("projects a skill + scheme that carry descriptions, and ones that don't", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:skill [ a ad:Skill ; ad:skillId "with" ; ad:name "With" ; ad:description "has desc" ] ;
  ad:skill [ a ad:Skill ; ad:skillId "without" ; ad:name "Without" ] ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "bearer" ; ad:description "d" ] ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "public" ] .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(r.valid).toBe(true);
    const withDesc = r.descriptor?.skills?.find((s) => s.id === "with");
    const withoutDesc = r.descriptor?.skills?.find((s) => s.id === "without");
    expect(withDesc?.description).toBe("has desc");
    expect(withoutDesc?.description).toBeUndefined();
    expect(r.descriptor?.securitySchemes?.find((s) => s.type === "bearer")?.description).toBe("d");
    expect(
      r.descriptor?.securitySchemes?.find((s) => s.type === "public")?.description,
    ).toBeUndefined();
  });

  it("flags a non-http protocol source (e.g. a did:) as invalid-protocol-source", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:protocolSource <did:web:example> .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(r.issues.map((i) => i.code)).toContain("invalid-protocol-source");
  });
});

describe("discover — descriptor parse failure (non-HTTP error)", () => {
  it("reports parse-failed when the resolved descriptor body is not RDF", async () => {
    const Webid = "https://alice.pod.example/profile/card#me";
    const Agent = "https://alice.pod.example/agent";
    const pointer = `@prefix interop: <http://www.w3.org/ns/solid/interop#>.
<${Webid}> interop:hasAuthorizationAgent <${Agent}>.`;
    const fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u === Webid) {
        return new Response(pointer, { status: 200, headers: { "content-type": "text/turtle" } });
      }
      // 200 OK but a body that is not RDF and an unsupported content type → parse-failed.
      return new Response("<<<not rdf>>>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof globalThis.fetch;
    const r = await discoverAgent(Webid, { fetch });
    expect(r.pointers).toHaveLength(1);
    expect(r.verification?.valid).toBe(false);
    expect(["parse-failed", "fetch-failed"]).toContain(r.verification?.issues[0]?.code);
  });
});

describe("serialize", () => {
  it("serialises an empty quad array to an empty string", async () => {
    await expect(serialize([])).resolves.toBe("");
  });

  it("falls back to Turtle for an unrecognised format (n3.Writer's behaviour)", async () => {
    const { quads } = describeAgent({ id: "https://a/agent", name: "A" }).agentDescription;
    const out = await serialize(quads, "application/totally-bogus");
    expect(out).toContain("ad:AgentDescription");
  });
});
