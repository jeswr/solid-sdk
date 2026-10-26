// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  credentialToRdf,
  digestQuads,
  readValidCredential,
  STATUS,
  SVC,
  VC,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { Store } from "n3";
import { decodeLimit, decodePolicy, decodeProhibitions } from "./codec.js";
import { mandateCredential } from "./mandate.js";
import { node, RDF_TYPE, SEC, turtle } from "./rdf.js";
import { AGENT, ODRL } from "./types.js";

/** Serialize a single-proof mandate credential as Turtle for agent/mandates/<id>.ttl. */
export async function mandateToTurtle(vc: VerifiableCredential): Promise<string> {
  const proofs = Array.isArray(vc.proof) ? vc.proof : [vc.proof];
  if (!vc.id || proofs.length !== 1 || !proofs[0]?.created)
    throw new Error("Expected a named single-proof mandate");
  const proof = proofs[0];
  const store = new Store(credentialToRdf(vc));
  const a = node(store, vc.id);
  const p = node(store, `${vc.id}/proof`);
  a.setIri(`${SEC}proof`, p.value);
  p.setIri(RDF_TYPE, `${SEC}DataIntegrityProof`);
  p.setText(`${SEC}cryptosuite`, proof.cryptosuite);
  p.setIri(`${SEC}verificationMethod`, proof.verificationMethod);
  p.setIri(`${SEC}proofPurpose`, `${SEC}${proof.proofPurpose}`);
  p.setText(`${SEC}proofValue`, proof.proofValue);
  p.setText("http://purl.org/dc/terms/created", proof.created);
  return turtle(store);
}
/** Parse this package's mandate Turtle. This is structural parsing; always pass its result to the verifier. */
export async function parseMandateCredential(
  document: string,
): Promise<VerifiableCredential | undefined> {
  try {
    const store = await parseRdf(document, "text/turtle");
    const result = readValidCredential(store);
    if (
      !result.valid ||
      !result.credential.validFrom ||
      !result.credential.validUntil ||
      !result.credential.types.includes(`${SVC}AgentAuthorizationCredential`)
    )
      return undefined;
    const meta = result.credential;
    const credential = node(store, meta.id);
    const p = credential.one(`${SEC}proof`);
    if (
      p.iri(RDF_TYPE) !== `${SEC}DataIntegrityProof` ||
      p.iri(`${SEC}proofPurpose`) !== `${SEC}assertionMethod`
    )
      return undefined;
    const status = credential.one(`${VC}credentialStatus`);
    if (
      status.iri(RDF_TYPE) !== `${STATUS}BitstringStatusListEntry` ||
      status.text(`${STATUS}statusPurpose`) !== "revocation"
    )
      return undefined;
    const root = node(store, meta.issuer).one(`${AGENT}agreement`);
    const m = {
      id: meta.id,
      issuer: root.iri(`${ODRL}assigner`),
      subject: root.iri(`${ODRL}assignee`),
      validFrom: meta.validFrom as string,
      validUntil: meta.validUntil as string,
      autonomous: decodePolicy(root.one(`${AGENT}autonomous`)),
      withApproval: decodePolicy(root.one(`${AGENT}withApproval`)),
      prohibitions: decodeProhibitions(root),
      limits: root.values(`${ODRL}constraint`).map(decodeLimit),
    };
    // Reconstruction preserves the complete package-issued signed graph. Foreign/extra claims
    // cannot be laundered: the verifier checks the signature over this reconstructed graph.
    const parsed: VerifiableCredential = {
      ...mandateCredential(m, {
        statusListCredential: status.iri(`${STATUS}statusListCredential`),
        statusListIndex: status.text(`${STATUS}statusListIndex`),
        ...(status.termType === "NamedNode" ? { id: status.value } : {}),
      }),
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: p.text(`${SEC}cryptosuite`),
        verificationMethod: p.iri(`${SEC}verificationMethod`),
        proofPurpose: "assertionMethod",
        created: p.text("http://purl.org/dc/terms/created"),
        proofValue: p.text(`${SEC}proofValue`),
      },
    };
    const raw = [...store].filter(
      (q) =>
        !p.equals(q.subject) &&
        !(credential.equals(q.subject) && q.predicate.value === `${SEC}proof`),
    );
    if ((await digestQuads(raw)) !== (await digestQuads(credentialToRdf(parsed)))) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
