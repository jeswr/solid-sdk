// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { credentialToRdf } from "../src/credential.js";
import { digestQuads } from "../src/digest.js";
import { issue } from "../src/issue.js";
import { DataIntegritySuite } from "../src/proof.js";
import {
  buildBitstringStatusListCredential,
  createBitstringStatusResolver,
  withStatusBit,
} from "../src/status.js";
import { parseStatusListCredential, statusListCredentialToTurtle } from "../src/status-rdf.js";
import type { Credential, VerifiableCredential } from "../src/types.js";
import { ISSUER, keyResolver } from "./helpers.js";

const URL = "https://alice.example/agent/mandates/status.ttl";
const NOW = new Date("2026-11-01T12:00:00Z");
async function fixture() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const key = { ...pair, verificationMethod: "https://alice.example/profile#approval" };
  const unsigned = await buildBitstringStatusListCredential({
    id: URL,
    issuer: ISSUER,
    statusPurpose: "revocation",
    validFrom: NOW.toISOString(),
    validUntil: "2027-01-01T00:00:00Z",
  });
  const sign = (credential: Credential) =>
    issue({
      credential,
      key,
      suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
      options: { created: NOW },
    });
  const signed = await sign(unsigned);
  return { key, signed, sign, document: await statusListCredentialToTurtle(signed) };
}

it("round-trips one P-256 status-list proof with the complete signed graph", async () => {
  const { signed, document } = await fixture();
  const parsed = await parseStatusListCredential(document);
  expect(parsed).toEqual(signed);
  expect(await digestQuads(credentialToRdf(parsed as VerifiableCredential))).toBe(
    await digestQuads(credentialToRdf(signed)),
  );
  for (const changes of [
    { validFrom: undefined, validUntil: undefined },
    {
      credentialSubject: {
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList: (signed.credentialSubject as Record<string, string>).encodedList,
      },
    },
  ]) {
    const vc = { ...signed, ...changes };
    expect(await parseStatusListCredential(await statusListCredentialToTurtle(vc))).toEqual(vc);
  }
});
it("resolves an ECDSA-signed RDF status list, including a revoked bit, and checks its key control", async () => {
  const { key, signed, sign } = await fixture();
  const credential = {
    issuer: ISSUER,
    credentialStatus: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "0",
      statusListCredential: URL,
    },
  } as VerifiableCredential;
  for (const revoked of [false, true]) {
    const list = revoked ? await sign(await withStatusBit(signed, 0, true)) : signed;
    const document = await statusListCredentialToTurtle(list);
    for (const controlled of [true, false]) {
      const resolver = createBitstringStatusResolver({
        now: NOW,
        resolveKey: keyResolver(key),
        isControlledBy: () => controlled,
        fetch: async (_url, init) => {
          // Prefer stored RDF over generic expanded JSON-LD conversions by pod servers.
          expect(new Headers(init?.headers).get("accept")?.split(",")[0]).toBe("application/trig");
          return new Response(document, { headers: { "content-type": "application/trig" } });
        },
      });
      expect((await resolver(credential)).status).toBe(
        !controlled ? "unreachable" : revoked ? "revoked" : "valid",
      );
    }
  }
});
it("rejects missing identities and absent, multiple or undated proofs during serialization", async () => {
  const { signed } = await fixture();
  const proof = Array.isArray(signed.proof) ? signed.proof[0] : signed.proof;
  for (const changes of [
    { id: undefined },
    { proof: [] },
    { proof: [proof, proof] },
    { proof: { ...proof, created: undefined } },
  ])
    await expect(
      statusListCredentialToTurtle({ ...signed, ...changes } as VerifiableCredential),
    ).rejects.toThrow("single-proof");
});
it("rejects malformed, ambiguous and lossy RDF instead of laundering fields before verification", async () => {
  const { document } = await fixture();
  const variants = [
    "unparseable <",
    document.replace("BitstringStatusListCredential>", "ForeignCredential>"),
    document.replace(/sec:proof _:[^.]+\./, 'sec:proof "literal".'),
    document.replace(/(_:[^ ]+) \{\n/, '$1 {\n<urn:extra> <urn:predicate> "extra".\n'),
    document.replace(/(_:[^ ]+) \{[^}]+\}/s, "$1 {}"),
    document.replace("a sec:DataIntegrityProof", "a sec:OtherProof"),
    document.replace("sec:proofPurpose sec:assertionMethod", "sec:proofPurpose sec:authentication"),
    document.replace(/sec:verificationMethod <[^>]+>/, 'sec:verificationMethod "literal"'),
    document.replace(/sec:verificationMethod <[^>]+>/, "$&, <urn:another>"),
    document.replace('"ecdsa-rdfc-2019"^^sec:cryptosuiteString', '"ecdsa-rdfc-2019"'),
    document.replace('"ecdsa-rdfc-2019"^^sec:cryptosuiteString', '"ecdsa-rdfc-2019"@en'),
    document.replace("dcterms:created", "sec:unexpected"),
    document.replace("sec:proofValue", 'sec:extra "unsigned"; sec:proofValue'),
    document.replace("#BitstringStatusList>", "#AnotherList>"),
    document.replace(/\^\^sec:multibase\./, "."),
    `${document}\n<urn:extra> <urn:restriction> "extra".`,
  ];
  for (const variant of variants)
    expect(await parseStatusListCredential(variant), variant).toBeUndefined();
});
it("rejects even correctly signed unknown claims in RDF transport", async () => {
  const { signed, sign } = await fixture();
  const extra = await sign({
    ...signed,
    credentialSubject: { ...signed.credentialSubject, "urn:restriction": "cannot erase" },
  });
  expect(
    await parseStatusListCredential(await statusListCredentialToTurtle(extra)),
  ).toBeUndefined();
});
