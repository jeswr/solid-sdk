// AUTHORED-BY Codex GPT-6.2 Sol
import { DataFactory, Writer } from "n3";
import { z } from "zod";
import { derivedUrn, digestOf, isIri } from "../core/canonical.js";
import { finishCredentialGraph, writeCredentialClaims } from "./sparq-result.js";

const { blankNode, literal, namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const VC = "https://www.w3.org/2018/credentials#";
const SECURITY = "https://w3id.org/security#";
const issuanceClaims = z.object({
  statements: z.array(z.object({ issuer: z.string().refine(isIri) })).min(1),
});
export function queryVerificationMethod(issuer: string): string {
  // Both catalogue profiles used by the suite cap verification-method IRIs at 32 bytes.
  const digest = Buffer.from(digestOf(issuer).slice("sha-256:".length), "hex");
  return `urn:zkq:${digest.toString("base64url").slice(0, 24)}`;
}

export async function queryCredentialGraphs(subject: string, claims: unknown) {
  const { statements } = issuanceClaims.parse(claims);
  const issuer = statements[0]?.issuer;
  if (!issuer || statements.some((statement) => statement.issuer !== issuer))
    throw new Error("Query credential must have a single issuer");
  const credential = namedNode(derivedUrn("zkq-vc", { subject, issuer }));
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuad(credential, RDF_TYPE, namedNode(`${VC}VerifiableCredential`));
  writer.addQuad(credential, namedNode(`${VC}issuer`), namedNode(issuer));
  writer.addQuad(credential, namedNode(`${VC}credentialSubject`), namedNode(subject));
  writeCredentialClaims(writer, subject, claims, (kind) =>
    isIri(kind) ? kind : `urn:claim:${encodeURIComponent(kind)}`,
  );

  const proof = new Writer({ format: "N-Quads" });
  const root = blankNode("proof");
  proof.addQuad(
    root,
    namedNode(`${SECURITY}cryptosuite`),
    literal("schnorr-poseidon2-merkle-2026"),
  );
  proof.addQuad(
    root,
    namedNode(`${SECURITY}verificationMethod`),
    namedNode(queryVerificationMethod(issuer)),
  );
  return {
    graphNQuads: await finishCredentialGraph(writer),
    proofConfigNQuads: await finishCredentialGraph(proof),
  };
}
