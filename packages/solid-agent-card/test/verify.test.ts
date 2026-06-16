// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import type { AgentDescriptor } from "../src/types.js";
import { verifyDataset, verifyDescriptor } from "../src/verify.js";

const ID = "https://alice.pod.example/agent";
const FULL: AgentDescriptor = {
  id: ID,
  name: "Alice's Agent",
  description: "Represents Alice.",
  owner: "https://alice.pod.example/profile/card#me",
  skills: [{ id: "schedule", name: "Scheduling" }],
  securitySchemes: [{ type: "solid-oidc", issuer: "https://idp.example/" }],
  protocolSources: ["https://alice.pod.example/protocols/exchange#v1"],
};

async function turtleOf(d: AgentDescriptor): Promise<string> {
  return describeAgent(d).agentDescription.toTurtle();
}

function codes(r: { issues: readonly { code: string }[] }): string[] {
  return r.issues.map((i) => i.code);
}

describe("verifyDescriptor — round-trip of describeAgent output", () => {
  it("verifies clean Turtle a well-formed descriptor produces", async () => {
    const ttl = await turtleOf(FULL);
    const r = await verifyDescriptor(ID, {
      body: ttl,
      bodyContentType: "text/turtle",
      expectedId: ID,
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.descriptor).toMatchObject({
      id: ID,
      name: "Alice's Agent",
      owner: "https://alice.pod.example/profile/card#me",
      protocolSources: ["https://alice.pod.example/protocols/exchange#v1"],
    });
    expect(r.descriptor?.skills?.[0]).toMatchObject({ id: "schedule", name: "Scheduling" });
    expect(r.descriptor?.securitySchemes?.[0]).toMatchObject({
      type: "solid-oidc",
      issuer: "https://idp.example/",
    });
  });

  it("verifies clean JSON-LD a well-formed descriptor produces", async () => {
    const json = JSON.stringify(await describeAgent(FULL).agentDescription.toJsonLd());
    const r = await verifyDescriptor(ID, {
      body: json,
      bodyContentType: "application/ld+json",
      expectedId: ID,
    });
    expect(r.valid).toBe(true);
    expect(r.descriptor?.name).toBe("Alice's Agent");
  });
});

describe("verifyDescriptor — structural issues", () => {
  it("flags no-agent-description on an empty graph", async () => {
    const r = await verifyDescriptor(ID, { body: "", bodyContentType: "text/turtle" });
    expect(r.valid).toBe(false);
    expect(codes(r)).toContain("no-agent-description");
  });

  it("flags multiple-agent-descriptions", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/1> a ad:AgentDescription ; ad:name "1" ; ad:url <https://a/1>.
<https://a/2> a ad:AgentDescription ; ad:name "2" ; ad:url <https://a/2>.`;
    const r = await verifyDescriptor(ID, { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("multiple-agent-descriptions");
  });

  it("flags missing-name and missing-url", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription.`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(r.valid).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(["missing-name", "missing-url"]));
  });

  it("flags invalid-url when ad:url is not http(s)", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <ftp://a/x>.`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("invalid-url");
  });

  it("flags invalid-url when ad:url is a literal, not an IRI", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url "https://a/agent".`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("invalid-url");
  });

  it("flags invalid-owner when ad:owner is a literal", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ; ad:owner "alice".`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("invalid-owner");
  });

  it("flags invalid-protocol-source for a non-http protocol source", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ; ad:protocolSource <urn:x>.`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("invalid-protocol-source");
  });
});

describe("verifyDescriptor — skill + scheme issues", () => {
  it("flags skill-missing-id and skill-missing-name", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:skill [ a ad:Skill ] ;
  ad:skill [ a ad:Skill ; ad:skillId "x" ] .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toEqual(expect.arrayContaining(["skill-missing-id", "skill-missing-name"]));
  });

  it("flags duplicate-skill-id", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:skill [ a ad:Skill ; ad:skillId "dup" ; ad:name "One" ] ;
  ad:skill [ a ad:Skill ; ad:skillId "dup" ; ad:name "Two" ] .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("duplicate-skill-id");
  });

  it("flags invalid-security-scheme for an unknown schemeType", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "magic" ] .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(codes(r)).toContain("invalid-security-scheme");
  });

  it("accepts all known scheme types", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://a/agent> a ad:AgentDescription ; ad:name "A" ; ad:url <https://a/agent> ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "public" ] ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "bearer" ] ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "oauth2" ] ;
  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "solid-oidc" ] .`;
    const r = await verifyDescriptor("https://a/agent", { body, bodyContentType: "text/turtle" });
    expect(r.valid).toBe(true);
    expect(r.descriptor?.securitySchemes).toHaveLength(4);
  });
});

describe("verifyDescriptor — subject-binding spoofing guard", () => {
  const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://evil/agent> a ad:AgentDescription ; ad:name "Evil" ; ad:url <https://evil/agent>.`;

  it("rejects a description whose subject ≠ the expected agent IRI (subject-match on)", async () => {
    const r = await verifyDescriptor("https://victim/agent", {
      body,
      bodyContentType: "text/turtle",
      expectedId: "https://victim/agent",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("subject-mismatch");
  });

  it("does not bind subject for a body with no expectedId (off by default)", async () => {
    const r = await verifyDescriptor("https://victim/agent", {
      body,
      bodyContentType: "text/turtle",
    });
    expect(r.issues.map((i) => i.code)).not.toContain("subject-mismatch");
    expect(r.valid).toBe(true);
  });

  it("requireSubjectMatch can be forced off even with an expectedId", async () => {
    const r = await verifyDescriptor("https://victim/agent", {
      body,
      bodyContentType: "text/turtle",
      expectedId: "https://victim/agent",
      requireSubjectMatch: false,
    });
    expect(r.issues.map((i) => i.code)).not.toContain("subject-mismatch");
  });
});

describe("verifyDescriptor — fetch path", () => {
  it("returns fetch-failed on an HTTP error (no throw)", async () => {
    const fetch = async () => new Response("nope", { status: 404 });
    const r = await verifyDescriptor("https://a/agent", { fetch });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.code).toBe("fetch-failed");
  });

  it("binds subject for a FETCHED document by default", async () => {
    const body = `@prefix ad: <https://w3id.org/agent-description#>.
<https://other/agent> a ad:AgentDescription ; ad:name "Other" ; ad:url <https://other/agent>.`;
    const fetch = async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
    const r = await verifyDescriptor("https://a/agent", { fetch });
    expect(r.issues.map((i) => i.code)).toContain("subject-mismatch");
  });

  it("binds a FETCHED document to expectedId — the well-known serving pattern (URL ≠ subject)", async () => {
    // ANP descriptions are commonly served at a well-known URL while the RDF
    // subject is the actual agent IRI. Supplying expectedId binds to the agent
    // IRI, not the fetch URL, so the documented serving pattern verifies cleanly.
    const ttl = await turtleOf(FULL); // subject is FULL.id, not the fetch URL below
    const fetch = async () =>
      new Response(ttl, { status: 200, headers: { "content-type": "text/turtle" } });
    const r = await verifyDescriptor("https://alice.pod.example/.well-known/agent-descriptions", {
      fetch,
      expectedId: ID,
    });
    expect(r.valid).toBe(true);
    expect(r.issues.map((i) => i.code)).not.toContain("subject-mismatch");
    expect(r.descriptor?.id).toBe(ID);
  });

  it("returns parse-failed on a non-RDF body (server answered, parse failed)", async () => {
    const fetch = async () =>
      new Response("<<not rdf>>", { status: 200, headers: { "content-type": "text/html" } });
    const r = await verifyDescriptor("https://a/agent", { fetch });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.code).toBe("parse-failed");
  });

  it("classifies a transport/network failure as fetch-failed, not parse-failed", async () => {
    // A fetch that rejects (DNS / connection refused) → no status, no parsed
    // content-type → the transport failed, so the code is fetch-failed.
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const r = await verifyDescriptor("https://a/agent", { fetch });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.code).toBe("fetch-failed");
    // The human-readable message must mirror the code (not mislabel as "parse").
    expect(r.issues[0]?.message).toMatch(/fetch/i);
    expect(r.issues[0]?.message).not.toMatch(/parse/i);
  });
});

describe("verifyDataset", () => {
  it("verifies a dataset directly without a second fetch", async () => {
    // Build a dataset via parse, then verify it.
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const ttl = await turtleOf(FULL);
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: ID });
    const r = verifyDataset(ds, ID, { requireSubjectMatch: true });
    expect(r.valid).toBe(true);
    expect(r.descriptor?.id).toBe(ID);
  });
});
