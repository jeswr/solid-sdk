// AUTHORED-BY Codex GPT-6.1-Sol
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
    SetFrom.subjectPredicate(this, predicate, TermAs.instance(Node), TermFrom.instance).add(
      new Node(DataFactory.namedNode(value), this.dataset, this.factory),
    );
  }
  setText(predicate: string, value: string): void {
    SetFrom.subjectPredicate(this, predicate, TermAs.instance(Node), TermFrom.instance).add(
      new Node(DataFactory.literal(value), this.dataset, this.factory),
    );
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
/** Serialize through n3.Writer, never by concatenating triples. */
export function turtle(store: Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
