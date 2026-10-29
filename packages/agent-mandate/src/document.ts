// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  credentialToRdf,
  type DataIntegrityProof,
  digestQuads,
  readValidCredential,
  STATUS,
  SVC,
  VC,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { Store } from "n3";
import { decodeLimit, decodePolicy, decodeProhibitions } from "./codec.js";
import { validInstant } from "./instant.js";
import { mandateCredential } from "./mandate.js";
import {
  matchesProofConfiguration,
  node,
  RDF_TYPE,
  readProof,
  SEC,
  trig,
  writeProof,
} from "./rdf.js";
import { AGENT, ODRL } from "./types.js";

/** Serialize a single-proof mandate as application/trig; the historical export name is retained. */
export async function mandateToTurtle(vc: VerifiableCredential): Promise<string> {
  const proofs = Array.isArray(vc.proof) ? vc.proof : [vc.proof];
  if (!vc.id || proofs.length !== 1 || !proofs[0]?.created)
    throw new Error("Expected a named single-proof mandate");
  const proof = proofs[0];
  const store = new Store(credentialToRdf(vc));
  writeProof(store, vc.id, proof);
  return trig(store);
}
/** Parse this package's mandate TriG. This is structural parsing; always pass its result to the verifier. */
export async function parseMandateCredential(
  document: string,
): Promise<VerifiableCredential | undefined> {
  try {
    const store = await parseRdf(document, "application/trig");
    const result = readValidCredential(store);
    if (
      !result.valid ||
      !validInstant(result.credential.validFrom) ||
      !validInstant(result.credential.validUntil) ||
      !result.credential.types.includes(`${SVC}AgentAuthorizationCredential`)
    )
      return undefined;
    const meta = result.credential;
    const { p, claims } = readProof(store, meta.id);
    const credential = node(claims, meta.id);
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
    const root = node(claims, meta.issuer).one(`${AGENT}agreement`);
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
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: p.text(`${SEC}cryptosuite`),
      verificationMethod: p.iri(`${SEC}verificationMethod`),
      proofPurpose: "assertionMethod",
      created: p.text("http://purl.org/dc/terms/created"),
      proofValue: p.text(`${SEC}proofValue`),
    };
    if (!(await matchesProofConfiguration(p, proof))) return undefined;
    const parsed: VerifiableCredential = {
      ...mandateCredential(m, {
        statusListCredential: status.iri(`${STATUS}statusListCredential`),
        statusListIndex: status.text(`${STATUS}statusListIndex`),
        ...(status.termType === "NamedNode" ? { id: status.value } : {}),
      }),
      proof,
    };
    if ((await digestQuads([...claims])) !== (await digestQuads(credentialToRdf(parsed))))
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
