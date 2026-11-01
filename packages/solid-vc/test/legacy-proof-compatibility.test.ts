// AUTHORED-BY Codex GPT-6
// Fixed signatures issued AND verified by the unmodified origin/main sources at
// the revision recorded in the fixture. Never regenerate using the current signer.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { dataIntegrityHash } from "../src/canonicalize.js";
import { countersign } from "../src/countersign.js";
import { credentialToRdf } from "../src/credential.js";
import { generateKeyPairForSuite } from "../src/keys.js";
import { base58btcDecode } from "../src/multibase.js";
import { DataIntegritySuite } from "../src/proof.js";
import type { DataIntegrityProof, VerifiableCredential } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import retained from "./fixtures/origin-main-credentials.json" with { type: "json" };

const now = new Date("2026-08-01T00:00:00.000Z");

describe.each(retained.fixtures)("origin/main $keyType credential compatibility", (fixture) => {
  const vc = fixture.credential as VerifiableCredential;
  const proof = vc.proof as DataIntegrityProof;
  const algorithm =
    fixture.keyType === "Ed25519"
      ? "Ed25519"
      : { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  const publicKey = crypto.subtle.importKey("jwk", fixture.publicKeyJwk, algorithm, true, [
    "verify",
  ]);
  const resolveKey = async (method: string) =>
    method === proof.verificationMethod ? await publicKey : undefined;
  const suite = new DataIntegritySuite(proof.cryptosuite as "eddsa-rdfc-2022" | "ecdsa-rdfc-2019");

  it("retains an independently verifiable legacy preimage and signature", async () => {
    const config = await parseRdf(fixture.canonicalProofOptions, "application/n-quads");
    const input = await dataIntegrityHash(credentialToRdf(vc), [...config]);
    expect(
      await crypto.subtle.verify(
        algorithm,
        await publicKey,
        base58btcDecode(proof.proofValue) as Uint8Array<ArrayBuffer>,
        input as Uint8Array<ArrayBuffer>,
      ),
    ).toBe(true);
  });

  it("verifies the unchanged main-issued credential through the suite and pipeline", async () => {
    const before = structuredClone(vc);
    expect(await suite.verify(credentialToRdf(vc), proof, { resolveKey })).toBe(true);
    expect(await verifyCredential(vc, { now, resolveKey })).toMatchObject({ verified: true });
    expect(vc).toEqual(before);
  });

  it.each([
    ["created", "2026-01-02T00:00:00.000Z"],
    ["proofPurpose", "authentication"],
    ["verificationMethod", `${proof.verificationMethod}-changed`],
    ["cryptosuite", fixture.keyType === "Ed25519" ? "ecdsa-rdfc-2019" : "eddsa-rdfc-2022"],
    ["type", "OtherProof"],
    ["proofValue", "invalid-base58"],
  ])("still rejects tampering with signed proof option %s", async (field, value) => {
    // Resolve the SAME key even for a changed method, so key lookup cannot mask
    // an unbound proof option in the compatibility verification path.
    const altered = { ...proof, [field]: value };
    expect(await suite.verify(credentialToRdf(vc), altered, { resolveKey: () => publicKey })).toBe(
      false,
    );
    expect(
      (
        await verifyCredential(
          { ...vc, proof: altered },
          {
            now,
            resolveKey: () => publicKey,
          },
        )
      ).verified,
    ).toBe(false);
  });

  it("rejects changed claims, missing keys and invalid keys", async () => {
    const changed = {
      ...vc,
      credentialSubject: { id: vc.issuer, authorizes: "https://attacker.example/id" },
    };
    expect((await verifyCredential(changed, { now, resolveKey })).verified).toBe(false);
    expect(await suite.verify(credentialToRdf(vc), proof, { resolveKey: () => undefined })).toBe(
      false,
    );
    const wrongKey = await generateKeyPairForSuite(
      proof.verificationMethod,
      fixture.keyType as "Ed25519" | "P-256",
    );
    expect(
      await suite.verify(credentialToRdf(vc), proof, { resolveKey: () => wrongKey.publicKey }),
    ).toBe(false);
  });

  it("retains issuer, validity and revocation gates", async () => {
    expect(
      (await verifyCredential(vc, { now, resolveKey, isControlledBy: () => false })).errors,
    ).toContainEqual(expect.objectContaining({ code: "ISSUER_MISMATCH" }));
    expect(
      (await verifyCredential(vc, { now: new Date("2031-01-01"), resolveKey })).errors,
    ).toContainEqual(expect.objectContaining({ code: "EXPIRED" }));
    expect(
      (
        await verifyCredential(vc, {
          now,
          resolveKey,
          resolveStatus: () => ({ status: "revoked", reason: "regression test" }),
        })
      ).errors,
    ).toContainEqual(expect.objectContaining({ code: "STATUS_REVOKED" }));
  });

  it("verifies a retained legacy proof together with a new countersignature", async () => {
    const key = await generateKeyPairForSuite(`${vc.issuer}#counter`, "Ed25519");
    const signed = await countersign(vc, key, { options: { created: now } });
    expect(
      await verifyCredential(signed, {
        now,
        resolveKey: (method) =>
          method === key.verificationMethod ? key.publicKey : resolveKey(method),
      }),
    ).toMatchObject({ verified: true });
  });
});
