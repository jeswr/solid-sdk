// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// GOLDEN-MASTER / CHARACTERIZATION SUITE — pins the exact observable outputs of
// the SECURITY-CRITICAL crypto path with a FIXED key and FIXED inputs, so any
// behaviour drift introduced by a refactor is caught byte-for-byte.
//
// These tests are deliberately stronger than the behavioural tests in the rest of
// the suite: they assert the LITERAL bytes the package produces, not just that a
// round-trip verifies. They exist to prove that a structural/cleanup refactor of
// this library changed STRUCTURE, never BEHAVIOUR. Do NOT loosen an assertion to
// make a red test green — an unexpected diff here is stop-the-line.
//
// Determinism notes:
//  - Ed25519 (eddsa-rdfc-2022) is a DETERMINISTIC signature scheme (RFC 8032), so
//    a fixed private JWK + fixed canonical pre-image + fixed `created` yields a
//    byte-stable `proofValue` (verified stable across runs). That lets us pin the
//    exact signed proof octets — the strongest possible guard on the sign path.
//  - ECDSA (P-256) is NON-deterministic (a fresh `k` per signature), so its proof
//    bytes are NOT pinned; instead we pin that a freshly signed P-256 credential
//    VERIFIES and that a verification result is structurally stable.
//  - RDFC-1.0 canonicalization is deterministic by construction, so the canonical
//    N-Quads and the Turtle / JSON-LD projections are pinned literally.

import { importJWK, type JWK } from "jose";
import { describe, expect, it } from "vitest";
import { canonicalNQuads, dataIntegrityHash } from "../src/canonicalize.js";
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
import { issue } from "../src/issue.js";
import { DataIntegritySuite, proofOptionsQuads } from "../src/proof.js";
import type { Credential, KeyPair } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";

// A FIXED Ed25519 keypair (generated once, then frozen as a fixture). Its
// verificationMethod is a fragment of the issuer WebID so the issuer-binding gate
// passes. Imported directly (not via importKeyPair) to keep this fixture free of
// the read-path code under refactor.
const ISSUER = "https://alice.example/profile#me";
const VM = `${ISSUER}#key-1`;
const FIXED_PRIVATE_JWK: JWK = {
  crv: "Ed25519",
  d: "wvFNPyd5stULjkUr5ugjl52fZccIVJ_e9YSRDe7r6r0",
  x: "sE8eJXZjjIdUrLGf3Mzb_S8KA8fQPsuvz4ABK8wJIZ4",
  kty: "OKP",
};

async function fixedKey(): Promise<KeyPair> {
  const privateKey = (await importJWK(FIXED_PRIVATE_JWK, "EdDSA", {
    extractable: true,
  })) as CryptoKey;
  const { d: _d, ...pub } = FIXED_PRIVATE_JWK;
  const publicKey = (await importJWK(pub, "EdDSA", { extractable: true })) as CryptoKey;
  return { verificationMethod: VM, privateKey, publicKey };
}

function resolveFixed(publicKey: CryptoKey): (vm: string) => CryptoKey | undefined {
  return (vm) => (vm === VM ? publicKey : undefined);
}

// The fixed credential the golden values were captured against.
const FIXED_CREDENTIAL: Credential = {
  id: "urn:uuid:fixed-1",
  type: ["AgentAuthorizationCredential"],
  issuer: ISSUER,
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  credentialSubject: {
    id: ISSUER,
    over18: true,
    age: 21,
    score: 3.5,
  },
};

const FIXED_CREATED = new Date("2026-01-01T00:00:00.000Z");

// The captured golden canonical N-Quads (RDFC-1.0). Sorted, deterministic.
const GOLDEN_CANON = `<https://alice.example/profile#me> <https://w3id.org/jeswr/solid-vc#age> "21"^^<http://www.w3.org/2001/XMLSchema#integer> .
<https://alice.example/profile#me> <https://w3id.org/jeswr/solid-vc#over18> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .
<https://alice.example/profile#me> <https://w3id.org/jeswr/solid-vc#score> "3.5"^^<http://www.w3.org/2001/XMLSchema#double> .
<urn:uuid:fixed-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/solid-vc#AgentAuthorizationCredential> .
<urn:uuid:fixed-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .
<urn:uuid:fixed-1> <https://www.w3.org/2018/credentials#credentialSubject> <https://alice.example/profile#me> .
<urn:uuid:fixed-1> <https://www.w3.org/2018/credentials#issuer> <https://alice.example/profile#me> .
<urn:uuid:fixed-1> <https://www.w3.org/2018/credentials#validFrom> "2026-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
<urn:uuid:fixed-1> <https://www.w3.org/2018/credentials#validUntil> "2027-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
`;

// The captured golden Ed25519 proofValue (deterministic for this exact pre-image).
const GOLDEN_PROOF_VALUE =
  "z2Vz6d7hC4kWW9mhXcpK1iJ6HJf4mPPEN4BBKMpsjmkhNviESnnudfpDesAdqQHN2F9ktUbN2DJs2CcKdUZm41pYo";

// The captured golden Data Integrity signing pre-image:
// SHA-256(canon(proofOptions)) || SHA-256(canon(document)), 64 bytes / 128 hex.
const GOLDEN_HASH_HEX =
  "b328c5d83bd327d3789e550288ef08516d4adf9c25b8c3d6e8abb965df79711146f61edbd0e72d3eae8b2b34d9e2020689704844cc957d6f353abd1d18cea0f6";

// The captured golden Turtle serialisation (byte-for-byte from @jeswr/rdf-serialize).
const GOLDEN_TTL = `@prefix cred: <https://www.w3.org/2018/credentials#>.
@prefix sec: <https://w3id.org/security#>.
@prefix svc: <https://w3id.org/jeswr/solid-vc#>.
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix odrl: <http://www.w3.org/ns/odrl/2/>.
@prefix schema: <https://schema.org/>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix dcterms: <http://purl.org/dc/terms/>.

<urn:uuid:fixed-1> a cred:VerifiableCredential, svc:AgentAuthorizationCredential;
    cred:issuer <https://alice.example/profile#me>;
    cred:validFrom "2026-01-01T00:00:00.000Z"^^xsd:dateTime;
    cred:validUntil "2027-01-01T00:00:00.000Z"^^xsd:dateTime;
    cred:credentialSubject <https://alice.example/profile#me>.
<https://alice.example/profile#me> svc:over18 true;
    svc:age 21;
    svc:score "3.5"^^xsd:double.
`;

describe("characterization — canonicalization (RDFC-1.0) is byte-stable", () => {
  it("lowers the fixed credential to the exact golden canonical N-Quads", async () => {
    const canon = await canonicalNQuads(credentialToRdf(FIXED_CREDENTIAL));
    expect(canon).toBe(GOLDEN_CANON);
  });

  it("dataIntegrityHash over the fixed pre-image is exactly the golden 64 bytes", async () => {
    const proofOpts = proofOptionsQuads({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: VM,
      proofPurpose: "assertionMethod",
      created: FIXED_CREATED.toISOString(),
    });
    const hash = await dataIntegrityHash(credentialToRdf(FIXED_CREDENTIAL), proofOpts);
    // captured golden: SHA-256(canon(proofOpts)) || SHA-256(canon(document)).
    expect(Buffer.from(hash).toString("hex")).toBe(GOLDEN_HASH_HEX);
  });
});

describe("characterization — Ed25519 signed proof bytes are pinned", () => {
  it("issues the EXACT golden proofValue for the fixed key + inputs + created", async () => {
    const key = await fixedKey();
    const vc = await issue({
      credential: FIXED_CREDENTIAL,
      key,
      options: { created: FIXED_CREATED },
    });
    const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
    expect(proof).toBeDefined();
    expect(proof?.proofValue).toBe(GOLDEN_PROOF_VALUE);
    expect(proof?.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(proof?.type).toBe("DataIntegrityProof");
    expect(proof?.proofPurpose).toBe("assertionMethod");
    expect(proof?.created).toBe("2026-01-01T00:00:00.000Z");
    expect(proof?.verificationMethod).toBe(VM);
  });

  it("the golden proof VERIFIES against the fixed public key", async () => {
    const key = await fixedKey();
    const vc = await issue({
      credential: FIXED_CREDENTIAL,
      key,
      options: { created: FIXED_CREATED },
    });
    const result = await verifyCredential(vc, {
      resolveKey: resolveFixed(key.publicKey),
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.issuer).toBe(ISSUER);
  });
});

describe("characterization — P-256 (non-deterministic sig) round-trip is stable", () => {
  it("a freshly signed ECDSA credential verifies (bytes not pinned — random k)", async () => {
    const { generateKeyPairForSuite } = await import("../src/keys.js");
    const key = await generateKeyPairForSuite(VM, "P-256");
    const vc = await issue({
      credential: FIXED_CREDENTIAL,
      key,
      suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
      options: { created: FIXED_CREATED },
    });
    const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
    expect(proof?.cryptosuite).toBe("ecdsa-rdfc-2019");
    const result = await verifyCredential(vc, { resolveKey: resolveFixed(key.publicKey) });
    expect(result.verified).toBe(true);
  });
});

describe("characterization — serialisation projections are byte-stable", () => {
  it("credentialToTurtle emits the exact golden Turtle", async () => {
    expect(await credentialToTurtle(FIXED_CREDENTIAL)).toBe(GOLDEN_TTL);
  });

  it("credentialToJsonLd emits the exact golden JSON-LD document", () => {
    expect(credentialToJsonLd(FIXED_CREDENTIAL)).toEqual({
      "@context": [
        "https://www.w3.org/ns/credentials/v2",
        {
          svc: "https://w3id.org/jeswr/solid-vc#",
          acl: "http://www.w3.org/ns/auth/acl#",
          odrl: "http://www.w3.org/ns/odrl/2/",
          schema: "https://schema.org/",
          AgentAuthorizationCredential:
            "https://w3id.org/jeswr/solid-vc#AgentAuthorizationCredential",
          authorizes: { "@id": "https://w3id.org/jeswr/solid-vc#authorizes", "@type": "@id" },
          action: { "@id": "https://w3id.org/jeswr/solid-vc#action", "@type": "@id" },
          target: { "@id": "https://w3id.org/jeswr/solid-vc#target", "@type": "@id" },
          policy: { "@id": "https://w3id.org/jeswr/solid-vc#policy", "@type": "@id" },
        },
      ],
      id: "urn:uuid:fixed-1",
      type: ["VerifiableCredential", "AgentAuthorizationCredential"],
      issuer: ISSUER,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      credentialSubject: { id: ISSUER, over18: true, age: 21, score: 3.5 },
    });
  });
});

describe("characterization — read-back (metadata + agent-authz) is stable", () => {
  it("credentialMetaFromNode recovers the exact metadata via Turtle round-trip", async () => {
    const ttl = await credentialToTurtle(FIXED_CREDENTIAL);
    const dataset = await parseCredentialRdf(ttl, "text/turtle");
    const node = credentialFromRdf(dataset);
    expect(node).toBeDefined();
    if (node === undefined) throw new Error("node undefined");
    const meta = credentialMetaFromNode(node);
    expect(meta.id).toBe("urn:uuid:fixed-1");
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.validFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.validUntil).toBe("2027-01-01T00:00:00.000Z");
    expect([...meta.types].sort()).toEqual([
      "https://w3id.org/jeswr/solid-vc#AgentAuthorizationCredential",
      "https://www.w3.org/2018/credentials#VerifiableCredential",
    ]);
  });

  it("agentAuthorizationFromRdf recovers the exact authz claims (multi-action)", async () => {
    const cred = buildAgentAuthorizationCredential({
      principal: "https://alice.example/profile#me",
      agent: "https://bob.example/agent#card",
      action: ["http://www.w3.org/ns/auth/acl#Read", "http://www.w3.org/ns/auth/acl#Write"],
      target: "https://alice.example/notes/",
      policy: "https://alice.example/p.ttl#policy",
    });
    const ttl = await credentialToTurtle(cred);
    const dataset = await parseCredentialRdf(ttl, "text/turtle");
    const node = credentialFromRdf(dataset);
    if (node === undefined) throw new Error("node undefined");
    const read = agentAuthorizationFromRdf(node);
    if (read === undefined) throw new Error("authz undefined");
    expect(read.principal).toBe("https://alice.example/profile#me");
    expect(read.agent).toBe("https://bob.example/agent#card");
    expect(read.target).toBe("https://alice.example/notes/");
    expect(read.policy).toBe("https://alice.example/p.ttl#policy");
    const actions = Array.isArray(read.action) ? read.action : [read.action];
    expect([...actions].sort()).toEqual([
      "http://www.w3.org/ns/auth/acl#Read",
      "http://www.w3.org/ns/auth/acl#Write",
    ]);
  });
});
