// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import type { AgentDescriptor } from "../src/types.js";
import { A2A_PROTOCOL_VERSION, ANP_AD } from "../src/vocab.js";

const FULL: AgentDescriptor = {
  id: "https://alice.pod.example/agent",
  name: "Alice's Agent",
  description: "Represents Alice.",
  owner: "https://alice.pod.example/profile/card#me",
  did: "did:web:alice.pod.example",
  url: "https://alice.pod.example/agent/endpoint",
  skills: [
    {
      id: "schedule",
      name: "Scheduling",
      description: "Negotiate meetings",
      tags: ["calendar", "time"],
    },
    { id: "contacts", name: "Contacts" },
  ],
  securitySchemes: [
    { type: "solid-oidc", issuer: "https://idp.example/", description: "Solid-OIDC + DPoP" },
    { type: "public" },
  ],
  protocolSources: ["https://alice.pod.example/protocols/exchange#v1"],
};

describe("describeAgent — input validation", () => {
  it("throws without an id", () => {
    expect(() => describeAgent({ id: "", name: "x" })).toThrow(/id .*required/);
  });
  it("throws without a name", () => {
    expect(() => describeAgent({ id: "https://a/agent", name: "" })).toThrow(/name is required/);
  });
});

describe("describeAgent — A2A Agent Card", () => {
  it("emits the pinned protocol version + core fields", () => {
    const { agentCard } = describeAgent(FULL);
    expect(agentCard.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(agentCard.name).toBe("Alice's Agent");
    expect(agentCard.description).toBe("Represents Alice.");
    expect(agentCard.url).toBe("https://alice.pod.example/agent/endpoint");
    expect(agentCard.preferredTransport).toBe("JSONRPC");
  });

  it("defaults url to the agent id when url is omitted", () => {
    const { agentCard } = describeAgent({ id: "https://a/agent", name: "A" });
    expect(agentCard.url).toBe("https://a/agent");
  });

  it("projects skills with tags", () => {
    const { agentCard } = describeAgent(FULL);
    expect(agentCard.skills).toHaveLength(2);
    expect(agentCard.skills?.[0]).toMatchObject({
      id: "schedule",
      name: "Scheduling",
      description: "Negotiate meetings",
      tags: ["calendar", "time"],
    });
    // A skill without optional fields carries none of them.
    expect(agentCard.skills?.[1]).toEqual({ id: "contacts", name: "Contacts" });
  });

  it("keys security schemes by type and maps issuer→openIdConnectUrl", () => {
    const { agentCard } = describeAgent(FULL);
    expect(agentCard.securitySchemes?.["solid-oidc"]).toEqual({
      type: "solid-oidc",
      description: "Solid-OIDC + DPoP",
      openIdConnectUrl: "https://idp.example/",
    });
    expect(agentCard.securitySchemes?.public).toEqual({ type: "public" });
  });

  it("carries the x-solid extension (owner, RDF description fragment, protocol sources)", () => {
    const { agentCard } = describeAgent(FULL);
    expect(agentCard["x-solid"]).toEqual({
      owner: "https://alice.pod.example/profile/card#me",
      agentDescription: "https://alice.pod.example/agent#ad",
      protocolSources: ["https://alice.pod.example/protocols/exchange#v1"],
    });
  });

  it("omits empty skills / securitySchemes blocks", () => {
    const { agentCard } = describeAgent({ id: "https://a/agent", name: "A" });
    expect(agentCard.skills).toBeUndefined();
    expect(agentCard.securitySchemes).toBeUndefined();
  });
});

describe("describeAgent — ANP Agent Description (Turtle)", () => {
  it("types the subject ad:AgentDescription and emits the core triples", async () => {
    const ttl = await describeAgent(FULL).agentDescription.toTurtle();
    expect(ttl).toContain("a ad:AgentDescription");
    expect(ttl).toContain('ad:name "Alice\'s Agent"');
    expect(ttl).toContain("<https://alice.pod.example/agent/endpoint>"); // ad:url IRI
    expect(ttl).toContain("ad:owner <https://alice.pod.example/profile/card#me>");
    expect(ttl).toContain('ad:did "did:web:alice.pod.example"');
    expect(ttl).toContain("ad:protocolSource <https://alice.pod.example/protocols/exchange#v1>");
    expect(ttl).toContain(`@prefix ad: <${ANP_AD}>`);
  });

  it("emits skills + security schemes as linked typed blank nodes", async () => {
    const ttl = await describeAgent(FULL).agentDescription.toTurtle();
    expect(ttl).toContain("a ad:Skill");
    expect(ttl).toContain('ad:skillId "schedule"');
    expect(ttl).toContain("a ad:SecurityScheme");
    expect(ttl).toContain('ad:schemeType "solid-oidc"');
    expect(ttl).toContain("ad:url <https://idp.example/>"); // scheme issuer as IRI
  });

  it("produces N-Triples (one fully-expanded statement per line)", async () => {
    const nt = await describeAgent(FULL).agentDescription.toTurtle("application/n-triples");
    // N-Triples uses absolute IRIs (no prefixes) and one `.`-terminated statement
    // per line.
    expect(nt).toContain(`<${ANP_AD}name>`);
    expect(nt).not.toContain("@prefix");
    const statements = nt.split("\n").filter((l) => l.trim().endsWith(" ."));
    expect(statements.length).toBeGreaterThan(5);
  });

  it("quads array is non-empty and stable", () => {
    const { quads } = describeAgent(FULL).agentDescription;
    expect(quads.length).toBeGreaterThan(8);
  });
});

describe("describeAgent — ANP Agent Description (JSON-LD)", () => {
  it("embeds an INLINE @context (not a bare remote URL) for offline parsing", async () => {
    const json = await describeAgent(FULL).agentDescription.toJsonLd();
    expect(typeof json["@context"]).toBe("object");
    expect((json["@context"] as Record<string, unknown>).AgentDescription).toBe(
      `${ANP_AD}AgentDescription`,
    );
  });

  it("projects the same descriptor fields as JSON-LD", async () => {
    const json = await describeAgent(FULL).agentDescription.toJsonLd();
    expect(json["@id"]).toBe("https://alice.pod.example/agent");
    expect(json["@type"]).toBe("AgentDescription");
    expect(json.name).toBe("Alice's Agent");
    expect(json.owner).toEqual({ "@id": "https://alice.pod.example/profile/card#me" });
    expect(json.skill as unknown[]).toHaveLength(2);
    expect(json.securityScheme as unknown[]).toHaveLength(2);
  });

  it("omits absent optional fields", async () => {
    const json = await describeAgent({
      id: "https://a/agent",
      name: "A",
    }).agentDescription.toJsonLd();
    expect(json.owner).toBeUndefined();
    expect(json.did).toBeUndefined();
    expect(json.skill).toBeUndefined();
    expect(json.securityScheme).toBeUndefined();
    expect(json.protocolSource).toBeUndefined();
  });
});
