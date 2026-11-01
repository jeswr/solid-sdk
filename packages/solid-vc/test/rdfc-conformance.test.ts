// AUTHORED-BY Codex GPT-6.1-Sol
// Published W3C test vectors (public keys only), copied under the W3C document license:
// https://www.w3.org/copyright/document-license/
// EdDSA B.1, examples 7–17:
// https://www.w3.org/TR/2025/REC-vc-di-eddsa-20250515/#representation-eddsa-rdfc-2022
// ECDSA A.1, examples 5–15:
// https://www.w3.org/TR/2025/REC-vc-di-ecdsa-20250515/#representation-ecdsa-rdfc-2019-with-curve-p-256

import { parseRdf } from "@jeswr/fetch-rdf";
import { expect, it } from "vitest";
import { canonicalNQuads, dataIntegrityHash } from "../src/canonicalize.js";
import { generateKeyPairForSuite } from "../src/keys.js";
import { base58btcDecode } from "../src/multibase.js";
import { DataIntegritySuite, proofOptionsQuads } from "../src/proof.js";
import { decodeMultikey } from "../src/webid.js";

// The same canonical AlumniCredential is published in both recommendations.
const document = `<did:example:abcdefgh> <https://www.w3.org/ns/credentials/examples#alumniOf> "The School of Examples" .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/ns/credentials/examples#AlumniCredential> .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <https://schema.org/description> "A minimum viable example of an Alumni Credential." .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <https://schema.org/name> "Alumni Credential" .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <https://www.w3.org/2018/credentials#credentialSubject> <did:example:abcdefgh> .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <https://www.w3.org/2018/credentials#issuer> <https://vc.example/issuers/5678> .
<urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33> <https://www.w3.org/2018/credentials#validFrom> "2023-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
`;
const created = "2023-02-24T23:36:38Z";
const documentHash = "517744132ae165a5349155bef0bb0cf2258fff99dfe1dbd914b938d775a36017";
const vectors = [
  {
    cryptosuite: "eddsa-rdfc-2022",
    keyType: "Ed25519",
    publicKeyMultibase: "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
    configHash: "bea7b7acfbad0126b135104024a5f1733e705108f42d59668b05c0c50004c6b0",
    proofValue:
      "z2YwC8z3ap7yx1nZYCg4L3j3ApHsF8kgPdSb5xoS1VR7vPG3F561B52hYnQF9iseabecm3ijx4K1FBTQsCZahKZme",
  },
  {
    cryptosuite: "ecdsa-rdfc-2019",
    keyType: "P-256",
    publicKeyMultibase: "zDnaepBuvsQ8cpsWrVKw8fbpGpvPeNSjVPTWoq6cRqaYzBKVP",
    configHash: "3a8a522f689025727fb9d1f0fa99a618da023e8494ac74f51015d009d35abc2e",
    proofValue:
      "zaHXrr7AQdydBk3ahpCDpWbxfLokDqmCToYm2dyWvpcFVyWooC2he63w1f7UNQoAMKdhaRtcnaE2KTo5o5vTCcfw",
  },
] as const;

it.each(
  vectors,
)("matches the published $cryptosuite proof configuration, hash and signature", async (vector) => {
  const verificationMethod = `did:key:${vector.publicKeyMultibase}#${vector.publicKeyMultibase}`;
  const proof = {
    type: "DataIntegrityProof" as const,
    cryptosuite: vector.cryptosuite,
    created,
    verificationMethod,
    proofPurpose: "assertionMethod",
    proofValue: vector.proofValue,
  };
  // Published canonical proof configuration; independent of proofOptionsQuads.
  const configuration = `_:c14n0 <http://purl.org/dc/terms/created> "${created}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
_:c14n0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/security#DataIntegrityProof> .
_:c14n0 <https://w3id.org/security#cryptosuite> "${vector.cryptosuite}"^^<https://w3id.org/security#cryptosuiteString> .
_:c14n0 <https://w3id.org/security#proofPurpose> <https://w3id.org/security#assertionMethod> .
_:c14n0 <https://w3id.org/security#verificationMethod> <${verificationMethod}> .
`;
  const quads = [...(await parseRdf(document, "application/n-quads"))];
  expect(await canonicalNQuads(proofOptionsQuads(proof))).toBe(configuration);
  expect(
    Buffer.from(await dataIntegrityHash(quads, proofOptionsQuads(proof))).toString("hex"),
  ).toBe(vector.configHash + documentHash);
  const decoded = await decodeMultikey(vector.publicKeyMultibase);
  if (!decoded) throw new Error("Invalid published public key");
  const suite = new DataIntegritySuite(vector.cryptosuite);
  expect(await suite.verify(quads, proof, { resolveKey: () => decoded.publicKey })).toBe(true);
  expect(await suite.verify([], proof, { resolveKey: () => decoded.publicKey })).toBe(false);
  expect(
    await suite.verify(
      quads,
      { ...proof, proofPurpose: "authentication" },
      {
        resolveKey: () => decoded.publicKey,
      },
    ),
  ).toBe(false);

  // Verify newly issued proofs against the independently encoded standard configuration.
  const key = await generateKeyPairForSuite(verificationMethod, vector.keyType);
  const signed = await suite.sign(quads, {
    key,
    proofPurpose: "assertionMethod",
    created: new Date(created),
  });
  const expectedConfig = await parseRdf(
    configuration.replace(created, signed.created as string),
    "application/n-quads",
  );
  const input = await dataIntegrityHash(quads, [...expectedConfig]);
  expect(
    await crypto.subtle.verify(
      vector.keyType === "Ed25519" ? "Ed25519" : { name: "ECDSA", hash: "SHA-256" },
      key.publicKey,
      base58btcDecode(signed.proofValue) as Uint8Array<ArrayBuffer>,
      input as Uint8Array<ArrayBuffer>,
    ),
  ).toBe(true);
});
