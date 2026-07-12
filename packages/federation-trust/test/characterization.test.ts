// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CHARACTERIZATION / GOLDEN-MASTER tests for the TLA reviewability refactor pass.
//
// These pin the OBSERVABLE BEHAVIOUR of the public surface BEFORE any structural
// refactor, so a later commit that only moves code around can be PROVEN not to have
// changed behaviour: the snapshots below must stay byte-identical across the
// refactor. They cover the two things a consumer relies on and the task flags as
// ESSENTIAL to preserve:
//
//   1. The EMITTED RDF / credential shape from issue + delegation — every term IRI,
//      the subject graph, and the proof envelope (cryptosuite / verificationMethod /
//      proofPurpose). Non-deterministic fields (`id` urn:uuid, `proofValue`
//      signature, default `validFrom` timestamp) are normalised so the snapshot is
//      stable; the canonical sorted N-Quads of the CLAIM GRAPH are pinned exactly so
//      a single changed/added/removed triple would show as a snapshot diff.
//
//   2. The fail-closed VERIFY outcome matrix — `verified` plus the sorted set of
//      emitted `TrustErrorCode`s for the happy path and every rejection path
//      (tamper / wrong-key / untrusted / expiry / status / mismatch / malformed /
//      broken-chain). A trust decision that broadened (a reject becoming an accept,
//      or an error code disappearing) is exactly what these snapshots catch.
//
// Determinism: keys are generated fresh per run (signatures differ), so we never
// snapshot a signature; we snapshot STRUCTURE + verdicts, which a correct refactor
// leaves identical regardless of the random key/uuid.

import { canonize } from "rdf-canonize";
import { beforeAll, describe, expect, it } from "vitest";
import {
  generateKeyPairForSuite,
  issueDelegation,
  issueMembershipCredential,
  type KeyPair,
  type MembershipClaim,
  type TrustAnchor,
  verifyMembershipCredential,
} from "../src/index.js";
import type { DelegationLink, VerifiableCredential } from "../src/types.js";

const AUTHORITY = "https://registry.example/profile/card#me";
const FEDERATION = "https://registry.example/federation";
const APP = "https://music.example/clientid.jsonld";
const SUB = "https://sub.example/card#me";
const CREATED = new Date("2025-01-01T00:00:00Z");

let authorityKey: KeyPair;
let subKey: KeyPair;
let anchor: TrustAnchor;

beforeAll(async () => {
  authorityKey = await generateKeyPairForSuite(AUTHORITY, "Ed25519");
  subKey = await generateKeyPairForSuite(SUB, "Ed25519");
  anchor = {
    authority: AUTHORITY,
    verificationMethod: AUTHORITY,
    publicKey: authorityKey.publicKey,
  };
});

function activeClaim(overrides: Partial<MembershipClaim> = {}): MembershipClaim {
  return {
    federation: FEDERATION,
    app: APP,
    status: "Active",
    assertedBy: AUTHORITY,
    ...overrides,
  };
}

/** Replace the non-deterministic fields of an emitted credential with stable placeholders. */
function normalizeCredential(vc: VerifiableCredential): unknown {
  const clone = JSON.parse(JSON.stringify(vc)) as Record<string, unknown>;
  if (typeof clone.id === "string" && clone.id.startsWith("urn:uuid:")) {
    clone.id = "urn:uuid:<normalized>";
  }
  // validFrom defaults to issue-time-now when the caller omits it.
  if (typeof clone.validFrom === "string") clone.validFrom = "<validFrom>";
  const proof = (Array.isArray(clone.proof) ? clone.proof[0] : clone.proof) as
    | Record<string, unknown>
    | undefined;
  if (proof !== undefined && proof !== null) {
    if (typeof proof.proofValue === "string") proof.proofValue = "z<signature>";
    if (typeof proof.created === "string") proof.created = "<created>";
  }
  // Also normalize the embedded delegateKey JWK (its `x` is key-pair specific).
  const subj = (
    Array.isArray(clone.credentialSubject) ? clone.credentialSubject[0] : clone.credentialSubject
  ) as Record<string, unknown> | undefined;
  const dk = subj?.["https://w3id.org/jeswr/fedtrust#delegateKey"];
  if (subj !== undefined && typeof dk === "string") {
    try {
      const jwk = JSON.parse(dk) as Record<string, unknown>;
      if ("x" in jwk) jwk.x = "<x>";
      subj["https://w3id.org/jeswr/fedtrust#delegateKey"] = JSON.stringify(jwk);
    } catch {
      /* leave as-is */
    }
  }
  return clone;
}

/** Canonical, sorted N-Quads of a credential's CLAIM-GRAPH subject (term-IRI fidelity). */
async function subjectNQuads(vc: VerifiableCredential): Promise<string> {
  const subj = (
    Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
  ) as Record<string, unknown>;
  const id = String(subj.id);
  const quads = Object.entries(subj)
    .filter(([k]) => k !== "id")
    .map(([predicate, value]) => ({
      subject: { termType: "NamedNode", value: id },
      predicate: { termType: "NamedNode", value: predicate },
      // delegateKey is a plain string literal; the rest are IRIs.
      object:
        predicate === "https://w3id.org/jeswr/fedtrust#delegateKey"
          ? {
              termType: "Literal",
              value: "<delegateKey-jwk>",
              datatype: { termType: "NamedNode", value: "http://www.w3.org/2001/XMLSchema#string" },
            }
          : { termType: "NamedNode", value: String(value) },
      graph: { termType: "DefaultGraph", value: "" },
    }));
  // biome-ignore lint/suspicious/noExplicitAny: rdf-canonize takes a quad-array dataset.
  return canonize(quads as any, { algorithm: "RDFC-1.0" });
}

/** Verify and reduce to the observable verdict: verified flag + sorted error codes. */
async function verdict(
  vc: VerifiableCredential,
  options: Parameters<typeof verifyMembershipCredential>[1],
): Promise<{ verified: boolean; codes: string[] }> {
  const res = await verifyMembershipCredential(vc, options);
  return { verified: res.verified, codes: [...res.errors.map((e) => e.code)].sort() };
}

describe("characterization — emitted credential shape (every IRI pinned)", () => {
  it("membership credential structure is stable", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim(),
      key: authorityKey,
      created: CREATED,
    });
    expect(normalizeCredential(vc)).toMatchInlineSnapshot(`
      {
        "credentialSubject": {
          "https://w3id.org/jeswr/fedreg#app": "https://music.example/clientid.jsonld",
          "https://w3id.org/jeswr/fedreg#assertedBy": "https://registry.example/profile/card#me",
          "https://w3id.org/jeswr/fedreg#status": "https://w3id.org/jeswr/fedreg#Active",
          "https://w3id.org/jeswr/fedtrust#federation": "https://registry.example/federation",
          "id": "https://music.example/clientid.jsonld",
        },
        "id": "urn:uuid:<normalized>",
        "issuer": "https://registry.example/profile/card#me",
        "proof": {
          "created": "<created>",
          "cryptosuite": "eddsa-rdfc-2022",
          "proofPurpose": "assertionMethod",
          "proofValue": "z<signature>",
          "type": "DataIntegrityProof",
          "verificationMethod": "https://registry.example/profile/card#me",
        },
        "type": [
          "https://w3id.org/jeswr/fedtrust#MembershipCredential",
        ],
        "validFrom": "<validFrom>",
      }
    `);
  });

  it("membership claim-graph canonical N-Quads are stable", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim(),
      key: authorityKey,
      created: CREATED,
    });
    expect(await subjectNQuads(vc)).toMatchInlineSnapshot(`
      "<https://music.example/clientid.jsonld> <https://w3id.org/jeswr/fedreg#app> <https://music.example/clientid.jsonld> .
      <https://music.example/clientid.jsonld> <https://w3id.org/jeswr/fedreg#assertedBy> <https://registry.example/profile/card#me> .
      <https://music.example/clientid.jsonld> <https://w3id.org/jeswr/fedreg#status> <https://w3id.org/jeswr/fedreg#Active> .
      <https://music.example/clientid.jsonld> <https://w3id.org/jeswr/fedtrust#federation> <https://registry.example/federation> .
      "
    `);
  });

  it("delegation credential structure is stable", async () => {
    const del = await issueDelegation({
      delegator: AUTHORITY,
      authority: SUB,
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: authorityKey,
      created: CREATED,
    });
    expect(normalizeCredential(del)).toMatchInlineSnapshot(`
      {
        "credentialSubject": {
          "https://w3id.org/jeswr/fedtrust#delegate": "https://sub.example/card#me",
          "https://w3id.org/jeswr/fedtrust#delegateKey": "{"crv":"Ed25519","x":"<x>","kty":"OKP"}",
          "https://w3id.org/jeswr/fedtrust#federation": "https://registry.example/federation",
          "id": "https://sub.example/card#me",
        },
        "id": "urn:uuid:<normalized>",
        "issuer": "https://registry.example/profile/card#me",
        "proof": {
          "created": "<created>",
          "cryptosuite": "eddsa-rdfc-2022",
          "proofPurpose": "assertionMethod",
          "proofValue": "z<signature>",
          "type": "DataIntegrityProof",
          "verificationMethod": "https://registry.example/profile/card#me",
        },
        "type": [
          "https://w3id.org/jeswr/fedtrust#DelegationCredential",
        ],
        "validFrom": "<validFrom>",
      }
    `);
  });
});

describe("characterization — fail-closed verify outcome matrix", () => {
  const baseOpts = () => ({
    trustAnchors: [anchor],
    expectedFederation: FEDERATION,
    expectedApp: APP,
  });

  it("happy path verifies with no errors", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    expect(await verdict(vc, baseOpts())).toEqual({ verified: true, codes: [] });
  });

  it("no trust anchors → NO_TRUST_ANCHOR", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    expect(await verdict(vc, { trustAnchors: [], expectedFederation: FEDERATION })).toEqual({
      verified: false,
      codes: ["NO_TRUST_ANCHOR"],
    });
  });

  it("untrusted issuer → UNTRUSTED_AUTHORITY (no double signature error)", async () => {
    const rogueKey = await generateKeyPairForSuite("https://rogue.example/card#me", "Ed25519");
    const vc = await issueMembershipCredential({
      claim: activeClaim({ assertedBy: "https://rogue.example/card#me" }),
      key: rogueKey,
    });
    expect(await verdict(vc, baseOpts())).toEqual({
      verified: false,
      codes: ["UNTRUSTED_AUTHORITY"],
    });
  });

  it("wrong anchor key → INVALID_SIGNATURE", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const otherKey = await generateKeyPairForSuite(AUTHORITY, "Ed25519");
    const wrongAnchor: TrustAnchor = {
      authority: AUTHORITY,
      verificationMethod: AUTHORITY,
      publicKey: otherKey.publicKey,
    };
    expect(await verdict(vc, { ...baseOpts(), trustAnchors: [wrongAnchor] })).toEqual({
      verified: false,
      codes: ["INVALID_SIGNATURE"],
    });
  });

  it("tampered app (no expectedApp) → INVALID_SIGNATURE", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedreg#app": "https://evil.example/clientid.jsonld",
        id: "https://evil.example/clientid.jsonld",
      },
    } as VerifiableCredential;
    expect(
      await verdict(tampered, { trustAnchors: [anchor], expectedFederation: FEDERATION }),
    ).toEqual({
      verified: false,
      codes: ["INVALID_SIGNATURE"],
    });
  });

  it("expired → EXPIRED", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-12-31T00:00:00Z" }),
      key: authorityKey,
      created: new Date("2020-06-01T00:00:00Z"),
    });
    expect(await verdict(vc, { ...baseOpts(), now: new Date("2026-01-01T00:00:00Z") })).toEqual({
      verified: false,
      codes: ["EXPIRED"],
    });
  });

  it("not-yet-valid → NOT_YET_VALID", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ validFrom: "2030-01-01T00:00:00Z" }),
      key: authorityKey,
      created: new Date("2030-01-01T00:00:00Z"),
    });
    expect(await verdict(vc, { ...baseOpts(), now: new Date("2026-01-01T00:00:00Z") })).toEqual({
      verified: false,
      codes: ["NOT_YET_VALID"],
    });
  });

  it("revoked status → STATUS_NOT_TRUSTED", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ status: "Revoked" }),
      key: authorityKey,
    });
    expect(await verdict(vc, baseOpts())).toEqual({
      verified: false,
      codes: ["STATUS_NOT_TRUSTED"],
    });
  });

  it("federation mismatch → FEDERATION_MISMATCH", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ federation: "https://other.example/federation" }),
      key: authorityKey,
    });
    expect(await verdict(vc, baseOpts())).toEqual({
      verified: false,
      codes: ["FEDERATION_MISMATCH"],
    });
  });

  it("app mismatch → APP_MISMATCH", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ app: "https://other.example/clientid.jsonld" }),
      key: authorityKey,
    });
    expect(await verdict(vc, baseOpts())).toEqual({
      verified: false,
      codes: ["APP_MISMATCH"],
    });
  });

  it("assertedBy tampered != issuer → ASSERTED_BY_MISMATCH + INVALID_SIGNATURE", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedreg#assertedBy": "https://someone-else.example/card#me",
      },
    } as VerifiableCredential;
    expect(await verdict(tampered, baseOpts())).toEqual({
      verified: false,
      codes: ["ASSERTED_BY_MISMATCH", "INVALID_SIGNATURE"],
    });
  });

  it("wrong VC type → INVALID_SIGNATURE + MALFORMED", async () => {
    // Re-typing the VC after signing both flags MALFORMED (not a
    // fedtrust:MembershipCredential) AND breaks the signature (the type is signed
    // over), so the canonical bytes no longer match the proof.
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const notMembership = {
      ...vc,
      type: ["https://example.org/SomethingElse"],
    } as VerifiableCredential;
    expect(await verdict(notMembership, baseOpts())).toEqual({
      verified: false,
      codes: ["INVALID_SIGNATURE", "MALFORMED"],
    });
  });

  it("null credential → MALFORMED (no throw)", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberate garbage input.
    expect(await verdict(null as any, baseOpts())).toEqual({
      verified: false,
      codes: ["MALFORMED"],
    });
  });
});

describe("characterization — delegation chain verdict matrix", () => {
  const Root = "https://root.example/card#me";
  const Regional = "https://regional.example/card#me";
  const ChainFed = "https://root.example/federation";
  let rootKey: KeyPair;
  let regionalKey: KeyPair;
  let rootAnchor: TrustAnchor;

  beforeAll(async () => {
    rootKey = await generateKeyPairForSuite(Root, "Ed25519");
    regionalKey = await generateKeyPairForSuite(Regional, "Ed25519");
    rootAnchor = { authority: Root, verificationMethod: Root, publicKey: rootKey.publicKey };
  });

  async function validChain(federation = ChainFed): Promise<DelegationLink[]> {
    const delegation = await issueDelegation({
      delegator: Root,
      authority: Regional,
      delegateKey: regionalKey.publicKey,
      federation,
      key: rootKey,
    });
    return [{ credential: delegation }];
  }

  async function regionalMembership(): Promise<VerifiableCredential> {
    return issueMembershipCredential({
      claim: { federation: ChainFed, app: APP, status: "Active", assertedBy: Regional },
      key: regionalKey,
    });
  }

  it("valid one-hop chain → verified", async () => {
    const vc = await regionalMembership();
    expect(
      await verdict(vc, {
        trustAnchors: [rootAnchor],
        expectedFederation: ChainFed,
        expectedApp: APP,
        chain: await validChain(),
      }),
    ).toEqual({ verified: true, codes: [] });
  });

  it("forged from-anchor link → BROKEN_CHAIN + UNTRUSTED_AUTHORITY", async () => {
    const attackerKey = await generateKeyPairForSuite(Root, "Ed25519");
    const vc = await regionalMembership();
    const forged = await issueDelegation({
      delegator: Root,
      authority: Regional,
      delegateKey: regionalKey.publicKey,
      federation: ChainFed,
      key: attackerKey,
    });
    expect(
      await verdict(vc, {
        trustAnchors: [rootAnchor],
        expectedFederation: ChainFed,
        chain: [{ credential: forged }],
      }),
    ).toEqual({ verified: false, codes: ["BROKEN_CHAIN", "UNTRUSTED_AUTHORITY"] });
  });

  it("chain scoped to a different federation → BROKEN_CHAIN + UNTRUSTED_AUTHORITY", async () => {
    const vc = await regionalMembership();
    expect(
      await verdict(vc, {
        trustAnchors: [rootAnchor],
        expectedFederation: ChainFed,
        chain: await validChain("https://other.example/federation"),
      }),
    ).toEqual({ verified: false, codes: ["BROKEN_CHAIN", "UNTRUSTED_AUTHORITY"] });
  });

  it("empty chain, non-anchor issuer → BROKEN_CHAIN + UNTRUSTED_AUTHORITY", async () => {
    // An explicitly-supplied empty chain is walked (chain !== undefined), and an
    // empty chain fails as BROKEN_CHAIN; trust is then not established, so
    // UNTRUSTED_AUTHORITY is also emitted.
    const vc = await regionalMembership();
    expect(
      await verdict(vc, { trustAnchors: [rootAnchor], expectedFederation: ChainFed, chain: [] }),
    ).toEqual({ verified: false, codes: ["BROKEN_CHAIN", "UNTRUSTED_AUTHORITY"] });
  });
});
