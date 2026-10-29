// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { type DataIntegrityProof, digestQuads, proofOptionsQuads } from "@jeswr/solid-vc";
import type { DataFactory as Factory } from "@rdfjs/types";
import {
  NamedGraphDataset,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

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
/** Attach a Data Integrity proof in its own graph, as defined by the standard context. */
export function writeProof(store: Store, id: string, proof: DataIntegrityProof): void {
  const factory = DataFactory as unknown as Factory;
  const graph = DataFactory.blankNode();
  node(store, id).setValue(`${SEC}proof`, new Node(graph, store, factory));
  const dataset = new NamedGraphDataset(graph, store, factory);
  const p = new Node(DataFactory.blankNode(), dataset, factory);
  for (const q of proofOptionsQuads(proof))
    p.setValue(q.predicate.value, new Node(q.object, dataset, factory));
  p.setValue(
    `${SEC}proofValue`,
    new Node(
      DataFactory.literal(proof.proofValue, DataFactory.namedNode(`${SEC}multibase`)),
      dataset,
      factory,
    ),
  );
}
/** Extract one proof graph as a default-graph view for cryptosuite canonicalization. */
export function readProof(store: Store, id: string): { p: Node; claims: Store } {
  const subject = node(store, id);
  const graph = TermAs.term(subject.one(`${SEC}proof`));
  if (graph.termType !== "BlankNode" && graph.termType !== "NamedNode")
    throw new Error("Expected a proof graph");
  const factory = DataFactory as unknown as Factory;
  const dataset = new NamedGraphDataset(graph, store, factory);
  const subjects = [...dataset].map((q) => q.subject);
  const first = subjects[0];
  if (!first || subjects.some((s) => !first.equals(s)))
    throw new Error("Expected one proof node in its graph");
  const p = new Node(first, dataset, factory);
  const value = p.one(`${SEC}proofValue`);
  if (value.termType !== "Literal" || value.datatype.value !== `${SEC}multibase`)
    throw new Error("Expected a multibase proof value");
  const claims = new Store(
    [...store].filter(
      (q) =>
        !graph.equals(q.graph) &&
        !(
          q.graph.termType === "DefaultGraph" &&
          subject.equals(q.subject) &&
          q.predicate.value === `${SEC}proof`
        ),
    ),
  );
  return { p, claims };
}
/** Reject proof options that reconstruction would otherwise silently change or discard. */
export async function matchesProofConfiguration(
  p: Node,
  proof: DataIntegrityProof,
): Promise<boolean> {
  const config = [...p.dataset].filter((q) => q.predicate.value !== `${SEC}proofValue`);
  return (await digestQuads(config)) === (await digestQuads(proofOptionsQuads(proof)));
}
/** Serialize through n3.Writer, never by concatenating triples. */
export function turtle(store: Store): Promise<string> {
  return serialize(store, "Turtle");
}
/** TriG preserves the named graphs required by Data Integrity proofs. */
export function trig(store: Store): Promise<string> {
  return serialize(store, "TriG");
}
function serialize(store: Store, format: "Turtle" | "TriG"): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format });
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
