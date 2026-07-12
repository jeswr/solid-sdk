// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The typed read-path wrappers (the Presentation / Proof readers) + the empty-
// graph serialiser short-circuit. The presentation reader is a public surface, so
// it is exercised here rather than shipped untested.

import { describe, expect, it } from "vitest";
import { parseCredentialRdf } from "../src/credential.js";
import { serialize } from "../src/serialize.js";
import { wrapVc } from "../src/wrappers.js";

const PRESENTATION_TTL = `
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
<urn:vp:1> a cred:VerifiablePresentation ;
  cred:holder <https://alice.example/#me> ;
  cred:verifiableCredential <urn:vc:1> .
<urn:vc:1> a cred:VerifiableCredential ;
  cred:issuer <https://issuer.example/#me> ;
  sec:proof [ a sec:DataIntegrityProof ;
    sec:cryptosuite "eddsa-rdfc-2022" ;
    sec:verificationMethod <https://issuer.example/#k> ;
    sec:proofPurpose <https://w3id.org/security#assertionMethod> ;
    sec:proofValue "zStubProofValue" ] .
`;

describe("VcDataset typed read wrappers", () => {
  it("reads a presentation, its holder, and the embedded credential + proof", async () => {
    const dataset = await parseCredentialRdf(PRESENTATION_TTL, "text/turtle");
    const wrapped = wrapVc(dataset);

    const presentations = wrapped.presentations();
    expect(presentations.length).toBe(1);
    const vp = presentations[0];
    expect(vp).toBeDefined();

    const holders = [...(vp?.holders ?? [])].map((t) => t.value);
    expect(holders).toContain("https://alice.example/#me");

    const creds = [...(vp?.credentials ?? [])];
    expect(creds.length).toBe(1);
    const issuer = [...(creds[0]?.issuers ?? [])].map((t) => t.value);
    expect(issuer).toContain("https://issuer.example/#me");

    const proofs = [...(creds[0]?.proofs ?? [])];
    expect(proofs.length).toBe(1);
    const cs = [...(proofs[0]?.cryptosuites ?? [])].map((t) => t.value);
    expect(cs).toContain("eddsa-rdfc-2022");
  });

  it("finds the top-level credential too", async () => {
    const dataset = await parseCredentialRdf(PRESENTATION_TTL, "text/turtle");
    expect(wrapVc(dataset).credentials().length).toBe(1);
  });
});

describe("serialize", () => {
  it("returns an empty string for an empty graph (no content-free preamble)", async () => {
    expect(await serialize([])).toBe("");
  });
});
