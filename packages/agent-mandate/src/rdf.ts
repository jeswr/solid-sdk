// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { type DataIntegrityProof, digestQuads, proofOptionsQuads } from "@jeswr/solid-vc";
import type { DataFactory as Factory } from "@rdfjs/types";
import { NamedNodeFrom, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, type Store, Writer } from "n3";

/** RDF vocabulary used by the typed document wrappers. */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** Security proof vocabulary. */
export const SEC = "https://w3id.org/security#";
/** A strict RDF view. Cardinality and term-kind errors abort verification. */
export class Node extends TermWrapper {
  values(predicate: string): Node[] {
    return [...SetFrom.subjectPredicate(this, predicate, TermAs.instance(Node), TermFrom.instance)];
  }
  one(predicate: string): Node {
    const values = this.values(predicate);
    if (values.length !== 1) throw new Error("Expected exactly one RDF value");
    return values[0] as Node;
  }
  iri(predicate: string): string {
    const value = this.one(predicate);
    if (value.termType !== "NamedNode") throw new Error("Expected an IRI");
    return value.value;
  }
  text(predicate: string): string {
    const value = this.one(predicate);
    if (value.termType !== "Literal") throw new Error("Expected a literal");
    return value.value;
  }
  setIri(predicate: string, value: string): void {
    this.setValue(predicate, new Node(DataFactory.namedNode(value), this.dataset, this.factory));
  }
  setText(predicate: string, value: string): void {
    this.setValue(predicate, new Node(DataFactory.literal(value), this.dataset, this.factory));
  }
  setValue(predicate: string, value: Node): void {
    SetFrom.subjectPredicate(this, predicate, TermAs.instance(Node), TermFrom.instance).add(value);
  }
}
/** Wrap a named subject using the shared RDF factory. */
export function node(store: Store, id: string): Node {
  return new Node(
    NamedNodeFrom.string(id, DataFactory as unknown as Factory),
    store,
    DataFactory as unknown as Factory,
  );
}
/** Attach the exact signed proof options, with a fresh blank node and the library's datatypes. */
export function writeProof(store: Store, id: string, proof: DataIntegrityProof): void {
  const factory = DataFactory as unknown as Factory;
  const p = new Node(DataFactory.blankNode(), store, factory);
  node(store, id).setValue(`${SEC}proof`, p);
  for (const q of proofOptionsQuads(proof))
    p.setValue(q.predicate.value, new Node(q.object, store, factory));
  p.setText(`${SEC}proofValue`, proof.proofValue);
}
/** Reject proof options that reconstruction would otherwise silently change or discard. */
export async function matchesProofConfiguration(
  store: Store,
  p: Node,
  proof: DataIntegrityProof,
): Promise<boolean> {
  const config = [...store].filter(
    (q) => p.equals(q.subject) && q.predicate.value !== `${SEC}proofValue`,
  );
  return (await digestQuads(config)) === (await digestQuads(proofOptionsQuads(proof)));
}
/** Serialize through n3.Writer, never by concatenating triples. */
export function turtle(store: Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
