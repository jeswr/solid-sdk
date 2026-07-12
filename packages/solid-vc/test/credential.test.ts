// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The VC 2.0 data model: build → RDF/JSON-LD, and the agent-authorization build +
// round-trip. The credential graph must round-trip losslessly on its load-bearing
// fields (issuer, validity, types, the agent-authz claims).

import { describe, expect, it } from "vitest";
import {
  agentAuthorizationFromRdf,
  buildAgentAuthorizationCredential,
  credentialFromRdf,
  credentialMetaFromNode,
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  parseCredentialRdf,
} from "../src/credential.js";
import type { Credential } from "../src/types.js";
import {
  SVC_ACTION,
  SVC_AGENT_AUTHORIZATION,
  SVC_AUTHORIZES,
  VC_CREDENTIAL,
  VC_ISSUER,
  VC_VALID_FROM,
} from "../src/vocab.js";
import { expectDefined } from "./helpers.js";

const ACL_READ = "http://www.w3.org/ns/auth/acl#Read";
const ACL_WRITE = "http://www.w3.org/ns/auth/acl#Write";

describe("credentialToRdf", () => {
  it("lowers a credential to its claim quads with issuer + types + validity", () => {
    const cred: Credential = {
      id: "urn:uuid:test-1",
      type: ["AgentAuthorizationCredential"],
      issuer: "https://alice.example/profile#me",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      credentialSubject: {
        id: "https://alice.example/profile#me",
        [SVC_AUTHORIZES]: "https://bob.example/agent#a",
      },
    };
    const quads = credentialToRdf(cred);
    const preds = quads.map((q) => q.predicate.value);
    expect(preds).toContain(VC_ISSUER);
    expect(preds).toContain(VC_VALID_FROM);
    // typed as both VerifiableCredential and AgentAuthorizationCredential
    const types = quads
      .filter((q) => q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
      .map((q) => q.object.value);
    expect(types).toContain(VC_CREDENTIAL);
    expect(types).toContain(SVC_AGENT_AUTHORIZATION);
  });

  it("mints a urn:uuid: id when none is given", () => {
    const quads = credentialToRdf({
      issuer: "https://alice.example/#me",
      credentialSubject: { foo: "bar" },
    });
    const subj = quads.find((q) => q.predicate.value === VC_ISSUER)?.subject.value ?? "";
    expect(subj.startsWith("urn:uuid:")).toBe(true);
  });

  it("writes typed literals for boolean / number claims (so they round-trip)", () => {
    const quads = credentialToRdf({
      issuer: "https://alice.example/#me",
      credentialSubject: { id: "https://x.example/#s", over18: true, age: 21, score: 3.5 },
    });
    const lits = quads.filter((q) => q.object.termType === "Literal");
    const byDt = new Map(
      lits.map((q) => [
        q.object.value,
        (q.object as unknown as { datatype: { value: string } }).datatype.value,
      ]),
    );
    expect(byDt.get("true")).toContain("boolean");
    expect(byDt.get("21")).toContain("integer");
    expect(byDt.get("3.5")).toContain("double");
  });

  it("writes nested-object + array claims as blank nodes / repeated triples", () => {
    const quads = credentialToRdf({
      issuer: "https://alice.example/#me",
      credentialSubject: {
        id: "https://x.example/#s",
        roles: ["admin", "editor"],
        address: { city: "Oxford", country: "GB" },
      },
    });
    // the array produces two literal objects for the same predicate
    const roleLits = quads.filter(
      (q) => q.predicate.value.endsWith("roles") && q.object.termType === "Literal",
    );
    expect(roleLits.map((q) => q.object.value).sort()).toEqual(["admin", "editor"]);
    // the nested object hangs off a fresh blank node
    const addressLink = quads.find((q) => q.predicate.value.endsWith("address"));
    expect(addressLink?.object.termType).toBe("BlankNode");
    const cityLit = quads.find((q) => q.predicate.value.endsWith("city"));
    expect(cityLit?.object.value).toBe("Oxford");
  });

  it("omits null claims (RDF has no null)", () => {
    const quads = credentialToRdf({
      issuer: "https://alice.example/#me",
      credentialSubject: { id: "https://x.example/#s", note: null, kept: "yes" },
    });
    expect(quads.some((q) => q.predicate.value.endsWith("note"))).toBe(false);
    expect(quads.some((q) => q.predicate.value.endsWith("kept"))).toBe(true);
  });
});

describe("credential RDF round-trip via @jeswr/fetch-rdf", () => {
  it("Turtle serialise → parse recovers the metadata", async () => {
    const cred: Credential = {
      id: "urn:uuid:rt-1",
      type: ["AgentAuthorizationCredential"],
      issuer: "https://alice.example/profile#me",
      validFrom: "2026-01-01T00:00:00.000Z",
      credentialSubject: {
        id: "https://alice.example/profile#me",
        [SVC_AUTHORIZES]: "https://bob.example/agent#a",
      },
    };
    const ttl = await credentialToTurtle(cred);
    expect(ttl).toContain("cred:");
    const dataset = await parseCredentialRdf(ttl, "text/turtle");
    const node = expectDefined(credentialFromRdf(dataset), "credential node");
    const meta = credentialMetaFromNode(node);
    expect(meta.id).toBe("urn:uuid:rt-1");
    expect(meta.issuer).toBe("https://alice.example/profile#me");
    expect(meta.validFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.types).toContain(SVC_AGENT_AUTHORIZATION);
  });

  it("JSON-LD projection parses back to the same credential subject", async () => {
    const cred: Credential = {
      id: "urn:uuid:jsonld-1",
      issuer: "https://alice.example/#me",
      credentialSubject: { id: "https://x.example/#s", [SVC_ACTION]: ACL_READ },
    };
    const doc = credentialToJsonLd(cred);
    expect(doc["@context"]).toBeDefined();
    expect(doc.type).toContain("VerifiableCredential");
    const dataset = await parseCredentialRdf(JSON.stringify(doc), "application/ld+json");
    const node = expectDefined(credentialFromRdf(dataset), "credential node");
    expect(credentialMetaFromNode(node).issuer).toBe("https://alice.example/#me");
  });
});

describe("buildAgentAuthorizationCredential + agentAuthorizationFromRdf", () => {
  it("the principal is the issuer AND the subject id", () => {
    const cred = buildAgentAuthorizationCredential({
      principal: "https://alice.example/profile#me",
      agent: "https://bob.example/agent#card",
      action: ACL_READ,
      target: "https://alice.example/notes/",
      policy: "https://alice.example/p.ttl#policy",
    });
    expect(cred.issuer).toBe("https://alice.example/profile#me");
    const subject = Array.isArray(cred.credentialSubject)
      ? cred.credentialSubject[0]
      : cred.credentialSubject;
    expect(subject?.id).toBe("https://alice.example/profile#me");
    expect(cred.type).toContain("AgentAuthorizationCredential");
  });

  it("round-trips the agent / action / target / policy through RDF", async () => {
    const cred = buildAgentAuthorizationCredential({
      principal: "https://alice.example/profile#me",
      agent: "https://bob.example/agent#card",
      action: [ACL_READ, ACL_WRITE],
      target: "https://alice.example/notes/",
      policy: "https://alice.example/p.ttl#policy",
    });
    const ttl = await credentialToTurtle(cred);
    const dataset = await parseCredentialRdf(ttl, "text/turtle");
    const node = expectDefined(credentialFromRdf(dataset), "credential node");
    const read = expectDefined(agentAuthorizationFromRdf(node), "agent authorization");
    expect(read.agent).toBe("https://bob.example/agent#card");
    expect(read.target).toBe("https://alice.example/notes/");
    expect(read.policy).toBe("https://alice.example/p.ttl#policy");
    const actions = Array.isArray(read.action) ? read.action : [read.action];
    expect([...actions].sort()).toEqual([ACL_READ, ACL_WRITE].sort());
  });

  it("returns undefined for a non-agent-authz credential", async () => {
    const cred: Credential = {
      issuer: "https://alice.example/#me",
      credentialSubject: { id: "https://x.example/#s", name: "X" },
    };
    const ttl = await credentialToTurtle(cred);
    const node = expectDefined(credentialFromRdf(await parseCredentialRdf(ttl)), "credential node");
    expect(agentAuthorizationFromRdf(node)).toBeUndefined();
  });
});
