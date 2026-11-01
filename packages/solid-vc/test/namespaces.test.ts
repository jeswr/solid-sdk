// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  agentAuthorizationFromRdf,
  buildAgentAuthorizationCredential,
  credentialFromRdf,
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  parseCredentialRdf,
} from "../src/credential.js";
import { issue, issueAgentAuthorization } from "../src/issue.js";
import { verifyCredential } from "../src/verify.js";
import { SVC } from "../src/vocab.js";
import { ACL_READ, AGENT, expectDefined, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const LEGACY = "https://w3id.org/jeswr/solid-vc#";
const auth = {
  principal: ISSUER,
  agent: AGENT,
  action: ACL_READ,
  target: "https://example.org/data",
};

describe("authorization namespace migration", () => {
  it("verifies legacy signed terms verbatim and rejects rebasing a signed payload", async () => {
    const key = await issuerKey();
    const legacy = await issue({
      credential: {
        type: ["AgentAuthorizationCredential"],
        issuer: ISSUER,
        credentialSubject: {
          id: ISSUER,
          [`${LEGACY}authorizes`]: AGENT,
          [`${LEGACY}action`]: ACL_READ,
        },
      },
      key,
    });
    const original = JSON.stringify(legacy);
    expect((await verifyCredential(legacy, { resolveKey: keyResolver(key) })).verified).toBe(true);
    expect(JSON.stringify(legacy)).toBe(original);
    const rebased = {
      ...legacy,
      type: [`${SVC}AgentAuthorizationCredential`],
      credentialSubject: {
        id: ISSUER,
        [`${SVC}authorizes`]: AGENT,
        [`${SVC}action`]: ACL_READ,
      },
    };
    expect((await verifyCredential(rebased, { resolveKey: keyResolver(key) })).verified).toBe(
      false,
    );
  });

  it("builds and signs the legacy wire format required by pinned verifiers", async () => {
    const key = await issuerKey();
    const signed = await issueAgentAuthorization(auth, key);
    expect((await verifyCredential(signed, { resolveKey: keyResolver(key) })).verified).toBe(true);
    for (const body of [
      await credentialToTurtle(signed),
      JSON.stringify(credentialToJsonLd(signed)),
    ]) {
      expect(body).toContain(LEGACY);
      expect(body).not.toContain(SVC);
    }
    const credential = buildAgentAuthorizationCredential(auth);
    expect(credential.type).toEqual(["AgentAuthorizationCredential"]);
    expect(credential.credentialSubject).toEqual({
      id: ISSUER,
      [`${LEGACY}authorizes`]: AGENT,
      [`${LEGACY}action`]: ACL_READ,
      [`${LEGACY}target`]: auth.target,
    });
    expect(credentialToJsonLd(credential).credentialSubject).toEqual(credential.credentialSubject);
    expect(
      credentialToRdf(credential).some(
        (q) => q.object.value === `${LEGACY}AgentAuthorizationCredential`,
      ),
    ).toBe(true);
  });

  it.each([
    LEGACY,
    SVC,
  ])("reads %s authorization types with mixed claims and duplicate aliases", async (typeNs) => {
    const data = await parseCredentialRdf(`
      @prefix vc: <https://www.w3.org/2018/credentials#> .
      <urn:test:credential> a vc:VerifiableCredential, <${typeNs}AgentAuthorizationCredential> ;
        vc:issuer <${ISSUER}> ; vc:credentialSubject <${ISSUER}> .
      <${ISSUER}> <${LEGACY}authorizes> <${AGENT}> ; <${SVC}authorizes> <${AGENT}> ;
        <${LEGACY}action> <${ACL_READ}> ; <${SVC}action> <${ACL_READ}> ;
        <${SVC}target> <${auth.target}> .
    `);
    const before = [...data];
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toEqual(auth);
    expect([...data]).toEqual(before);
  });

  it("reads an entirely legacy credential", async () => {
    const data = await parseCredentialRdf(`
      @prefix vc: <https://www.w3.org/2018/credentials#> .
      @prefix svc: <${LEGACY}> .
      <urn:test:credential> a vc:VerifiableCredential, svc:AgentAuthorizationCredential ;
        vc:issuer <${ISSUER}> ; vc:credentialSubject <${ISSUER}> .
      <${ISSUER}> svc:authorizes <${AGENT}> ; svc:action <${ACL_READ}> ; svc:target <${auth.target}> .
    `);
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toEqual(auth);
  });

  it.each([
    [LEGACY, LEGACY],
    [LEGACY, SVC],
    [SVC, LEGACY],
    [SVC, SVC],
  ])("accepts explicit JSON-LD type %s and claims %s", async (typeNs, propertyNs) => {
    const document = {
      "@context": { vc: "https://www.w3.org/2018/credentials#" },
      "@id": "urn:test:jsonld",
      "@type": ["vc:VerifiableCredential", `${typeNs}AgentAuthorizationCredential`],
      "vc:issuer": { "@id": ISSUER },
      "vc:credentialSubject": {
        "@id": ISSUER,
        [`${propertyNs}authorizes`]: { "@id": AGENT },
        [`${propertyNs}action`]: [{ "@id": ACL_READ }],
        [`${propertyNs}target`]: { "@id": auth.target },
      },
    };
    const data = await parseCredentialRdf(JSON.stringify(document), "application/ld+json");
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toEqual(auth);
  });

  it("preserves IRI-valued canonical input in the JSON-LD projection", async () => {
    const document = credentialToJsonLd({
      id: "urn:test:canonical-jsonld",
      type: [`${SVC}AgentAuthorizationCredential`],
      issuer: ISSUER,
      credentialSubject: {
        id: ISSUER,
        [`${SVC}authorizes`]: AGENT,
        [`${SVC}action`]: [ACL_READ],
        [`${SVC}target`]: auth.target,
      },
    });
    const data = await parseCredentialRdf(JSON.stringify(document), "application/ld+json");
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toEqual(auth);
  });

  it.each(["authorizes", "target", "policy"])("rejects conflicting %s aliases", async (claim) => {
    const ttl = await credentialToTurtle(
      buildAgentAuthorizationCredential({ ...auth, policy: "https://example.org/policy" }),
    );
    const data = await parseCredentialRdf(
      `${ttl}\n<${ISSUER}> <${SVC}${claim}> <https://example.org/conflict> .`,
    );
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toBeUndefined();
  });

  it.each([LEGACY, SVC])("rejects differing RDF action sets in %s", async (namespace) => {
    const other = namespace === SVC ? LEGACY : SVC;
    const data = await parseCredentialRdf(
      await credentialToTurtle({
        ...buildAgentAuthorizationCredential(auth),
        credentialSubject: {
          id: ISSUER,
          [`${LEGACY}authorizes`]: AGENT,
          [`${namespace}action`]: [ACL_READ],
          [`${other}action`]: [ACL_READ, "http://www.w3.org/ns/auth/acl#Write"],
        },
      }),
    );
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toBeUndefined();
  });

  it.each([
    "https://other.example/principal",
    undefined,
  ])("rejects additional RDF subjects, including %s", async (id) => {
    const credential = buildAgentAuthorizationCredential(auth);
    const data = await parseCredentialRdf(
      await credentialToTurtle({
        ...credential,
        credentialSubject: [
          credential.credentialSubject as { id: string },
          { id, authorizes: AGENT },
        ],
      }),
    );
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toBeUndefined();
  });

  it.each([
    "authorizes",
    "action",
    "target",
    "policy",
  ])("rejects non-IRI RDF %s aliases instead of hiding them", async (claim) => {
    const ttl = await credentialToTurtle(buildAgentAuthorizationCredential(auth));
    const data = await parseCredentialRdf(`${ttl}\n<${ISSUER}> <${SVC}${claim}> "invalid" .`);
    expect(agentAuthorizationFromRdf(expectDefined(credentialFromRdf(data)))).toBeUndefined();
  });
});
