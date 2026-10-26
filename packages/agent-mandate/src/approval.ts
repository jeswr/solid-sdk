// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  type DataIntegrityProof,
  DataIntegritySuite,
  type KeyPair,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";
import { Store } from "n3";
import { matchesProofConfiguration, node, RDF_TYPE, SEC, turtle, writeProof } from "./rdf.js";
import { AGENT } from "./types.js";

/** Exact terms an owner signs in the browser. */
export interface Approval {
  readonly id: string;
  readonly approves: string;
  readonly termsDigest: string;
  readonly expires: string;
  readonly decision: "approve" | "deny";
}
/** Approval verification failures are ordered as required by the daemon contract. */
export type ApprovalResult =
  | { readonly valid: true; readonly approval: Approval }
  | {
      readonly valid: false;
      readonly reason:
        | "proof-type"
        | "key"
        | "signature"
        | "proposal"
        | "terms-digest"
        | "expired"
        | "decision"
        | "malformed";
    };

/** Constant-work comparison after hashing both arbitrary-length strings to fixed-size digests. */
async function sameDigest(a: string, b: string): Promise<boolean> {
  const bytes = new TextEncoder();
  const [left, right] = await Promise.all(
    [a, b].map((x) => crypto.subtle.digest("SHA-256", bytes.encode(x))),
  );
  let difference = 0;
  for (let i = 0; i < 32; i++)
    difference |=
      (new Uint8Array(left as ArrayBuffer)[i] as number) ^
      (new Uint8Array(right as ArrayBuffer)[i] as number);
  return difference === 0;
}
/** Issue a Turtle RDF approval with an ecdsa-rdfc-2019 proof; accepts a non-extractable P-256 private key. */
export async function issueApproval(approval: Approval, key: KeyPair, now: Date): Promise<string> {
  if (
    key.privateKey.algorithm.name !== "ECDSA" ||
    (key.privateKey.algorithm as { name: string; namedCurve: string }).namedCurve !== "P-256"
  )
    throw new Error("Expected P-256 approval key");
  const store = new Store();
  const a = node(store, approval.id);
  a.setIri(RDF_TYPE, `${AGENT}Approval`);
  a.setIri(`${AGENT}approves`, approval.approves);
  a.setText(`${AGENT}termsDigest`, approval.termsDigest);
  a.setText(`${AGENT}expires`, approval.expires);
  a.setText(`${AGENT}decision`, approval.decision);
  const proof = await new DataIntegritySuite("ecdsa-rdfc-2019").sign([...store], {
    key,
    proofPurpose: "assertionMethod",
    created: now,
  });
  writeProof(store, approval.id, proof);
  return turtle(store);
}
/** Verify an approval against an owner's authoritative WebID assertionMethod and exact proposal terms. */
export async function verifyApproval(
  document: string,
  options: {
    id: string;
    ownerWebId: string;
    proposal: string;
    termsDigest: string;
    webIdKeyResolver: WebIdKeyResolver;
    now: () => Date;
  },
): Promise<ApprovalResult> {
  const fail = (reason: Extract<ApprovalResult, { valid: false }>["reason"]): ApprovalResult => ({
    valid: false,
    reason,
  });
  try {
    const store = await parseRdf(document, "text/turtle");
    const a = node(store, options.id);
    const p = a.one(`${SEC}proof`);
    if (
      p.iri(RDF_TYPE) !== `${SEC}DataIntegrityProof` ||
      p.text(`${SEC}cryptosuite`) !== "ecdsa-rdfc-2019" ||
      p.iri(`${SEC}proofPurpose`) !== `${SEC}assertionMethod`
    )
      return fail("proof-type");
    const method = p.iri(`${SEC}verificationMethod`);
    const resolver = options.webIdKeyResolver;
    if (!(await resolver.isControlledBy(method, options.ownerWebId))) return fail("key");
    const key = await resolver.resolveKey(method);
    if (
      key?.algorithm.name !== "ECDSA" ||
      (key.algorithm as { name: string; namedCurve: string }).namedCurve !== "P-256"
    )
      return fail("key");
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-rdfc-2019",
      verificationMethod: method,
      proofPurpose: "assertionMethod",
      created: p.text("http://purl.org/dc/terms/created"),
      proofValue: p.text(`${SEC}proofValue`),
    };
    const claims = [...store].filter(
      (q) => !p.equals(q.subject) && !(a.equals(q.subject) && q.predicate.value === `${SEC}proof`),
    );
    if (
      !(await matchesProofConfiguration(store, p, proof)) ||
      !(await new DataIntegritySuite("ecdsa-rdfc-2019").verify(claims, proof, {
        resolveKey: () => key,
      }))
    )
      return fail("signature");
    if (a.iri(RDF_TYPE) !== `${AGENT}Approval` || a.iri(`${AGENT}approves`) !== options.proposal)
      return fail("proposal");
    if (!(await sameDigest(a.text(`${AGENT}termsDigest`), options.termsDigest)))
      return fail("terms-digest");
    const expires = a.text(`${AGENT}expires`);
    if (!(Date.parse(expires) > options.now().getTime())) return fail("expired");
    const decision = a.text(`${AGENT}decision`);
    if (decision !== "approve" && decision !== "deny") return fail("decision");
    return {
      valid: true,
      approval: {
        id: options.id,
        approves: options.proposal,
        termsDigest: options.termsDigest,
        expires,
        decision,
      },
    };
  } catch {
    return fail("malformed");
  }
}
