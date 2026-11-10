// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DataFactory as Factory } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { credentialToRdf } from "./credential.js";
import { digestQuads } from "./digest.js";
import { proofOptionsQuads } from "./proof.js";
import { readValidCredential } from "./read-valid.js";
import { serialize } from "./serialize.js";
import type { DataIntegrityProof, VerifiableCredential } from "./types.js";
import { DC_CREATED, RDF_TYPE, SEC, STATUS, VC, XSD } from "./vocab.js";

/** Strict term accessors keep ambiguous or lossy RDF out of the signed projection. */
class StatusNode extends TermWrapper {
  values(predicate: string): StatusNode[] {
    return [
      ...SetFrom.subjectPredicate(this, predicate, TermAs.instance(StatusNode), TermFrom.instance),
    ];
  }
  one(predicate: string): StatusNode {
    const values = this.values(predicate);
    if (values.length !== 1) throw new Error("Expected exactly one status-list value");
    return values[0] as StatusNode;
  }
  iri(predicate: string): string {
    const term = this.one(predicate);
    if (term.termType !== "NamedNode") throw new Error("Expected a status-list IRI");
    return term.value;
  }
  text(predicate: string, datatype = `${XSD}string`): string {
    const term = this.one(predicate);
    if (term.termType !== "Literal" || term.datatype.value !== datatype || term.language)
      throw new Error("Expected a typed status-list literal");
    return term.value;
  }
  add(predicate: string, value: StatusNode): void {
    SetFrom.subjectPredicate(this, predicate, TermAs.instance(StatusNode), TermFrom.instance).add(
      value,
    );
  }
}
const factory = DataFactory as unknown as Factory;
function named(store: Store, id: string): StatusNode {
  return new StatusNode(DataFactory.namedNode(id), store, factory);
}

/** Serialize one signed status list losslessly as application/trig, including its proof graph. */
export async function statusListCredentialToTurtle(vc: VerifiableCredential): Promise<string> {
  const proofs = Array.isArray(vc.proof) ? vc.proof : [vc.proof];
  if (!vc.id || proofs.length !== 1 || !proofs[0]?.created)
    throw new Error("Expected a named single-proof status list");
  const proof = proofs[0];
  const store = new Store(credentialToRdf(vc));
  const graph = DataFactory.blankNode();
  named(store, vc.id).add(`${SEC}proof`, new StatusNode(graph, store, factory));
  const dataset = new NamedGraphDataset(graph, store, factory);
  const p = new StatusNode(DataFactory.blankNode(), dataset, factory);
  for (const q of proofOptionsQuads(proof))
    p.add(q.predicate.value, new StatusNode(q.object, dataset, factory));
  p.add(
    `${SEC}proofValue`,
    new StatusNode(
      DataFactory.literal(proof.proofValue, DataFactory.namedNode(`${SEC}multibase`)),
      dataset,
      factory,
    ),
  );
  return serialize([...store], "application/trig");
}

/** Structural parser only: always verify its result before trusting a status bit. */
export async function parseStatusListCredential(
  document: string,
): Promise<VerifiableCredential | undefined> {
  try {
    const store = await parseRdf(document, "application/trig");
    const result = readValidCredential(store);
    if (
      !result.valid ||
      !result.credential.types.includes(`${STATUS}BitstringStatusListCredential`)
    )
      return undefined;
    const meta = result.credential;
    const root = named(store, meta.id);
    const graph = root.one(`${SEC}proof`);
    const graphTerm = TermAs.term(graph);
    if (graphTerm.termType !== "BlankNode" && graphTerm.termType !== "NamedNode") return undefined;
    const dataset = new NamedGraphDataset(graphTerm, store, factory);
    const subjects = [...dataset].map((q) => q.subject);
    const first = subjects[0];
    if (!first || subjects.some((s) => !s.equals(first))) return undefined;
    const p = new StatusNode(first, dataset, factory);
    if (
      p.iri(RDF_TYPE) !== `${SEC}DataIntegrityProof` ||
      p.iri(`${SEC}proofPurpose`) !== `${SEC}assertionMethod`
    )
      return undefined;
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: p.text(`${SEC}cryptosuite`, `${SEC}cryptosuiteString`),
      verificationMethod: p.iri(`${SEC}verificationMethod`),
      proofPurpose: "assertionMethod",
      created: p.text(DC_CREATED, `${XSD}dateTime`),
      proofValue: p.text(`${SEC}proofValue`, `${SEC}multibase`),
    };
    const config = [...dataset].filter((q) => q.predicate.value !== `${SEC}proofValue`);
    if ((await digestQuads(config)) !== (await digestQuads(proofOptionsQuads(proof))))
      return undefined;
    const claims = new Store(
      [...store].filter(
        (q) =>
          !graph.equals(q.graph) &&
          !(
            root.equals(q.subject) &&
            q.graph.termType === "DefaultGraph" &&
            q.predicate.value === `${SEC}proof`
          ),
      ),
    );
    const subject = named(claims, meta.id).one(`${VC}credentialSubject`);
    if (subject.iri(RDF_TYPE) !== `${STATUS}BitstringStatusList`) return undefined;
    const vc: VerifiableCredential = {
      id: meta.id,
      issuer: meta.issuer,
      type: ["BitstringStatusListCredential"],
      ...(meta.validFrom === undefined ? {} : { validFrom: meta.validFrom }),
      ...(meta.validUntil === undefined ? {} : { validUntil: meta.validUntil }),
      credentialSubject: {
        ...(subject.termType === "NamedNode" ? { id: subject.value } : {}),
        type: "BitstringStatusList",
        statusPurpose: subject.text(`${STATUS}statusPurpose`),
        encodedList: subject.text(`${STATUS}encodedList`, `${SEC}multibase`),
      },
      proof,
    };
    // Reject unknown claims, extra graphs, changed datatypes, and cardinalities instead of
    // discarding them before signature verification over the reconstructed data model.
    if ((await digestQuads([...claims])) !== (await digestQuads(credentialToRdf(vc))))
      return undefined;
    return vc;
  } catch {
    return undefined;
  }
}
