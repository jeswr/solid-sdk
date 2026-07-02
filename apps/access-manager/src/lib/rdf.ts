// AUTHORED-BY Claude Fable 5
//
// RDF plumbing shared by the data layer: n3.Writer serialisation (the sanctioned
// serialiser — never string-concatenated triples), tryRead guards for UNTRUSTED
// foreign RDF (a malformed literal drops the field, never aborts the parse), and
// small dataset read helpers used by the typed wrappers.

import type { DatasetCore, Quad, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory, Writer } from "n3";
import { isHttpUrl } from "./http.js";
import { XSD } from "./vocab.js";

const { namedNode, literal, quad } = DataFactory;

/** Serialise a dataset to Turtle via n3.Writer (async wrapped). */
export function toTurtle(dataset: DatasetCore, baseIRI?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = baseIRI ? new Writer({ baseIRI }) : new Writer();
    for (const q of dataset) writer.addQuad(q as Quad);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Guard a typed read of untrusted RDF: a throw (wrong term type, malformed
 * literal) resolves to `undefined` — the field drops, the message survives.
 */
export function tryRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** All object IRIs for (subject, predicate) that are http(s) NamedNodes. */
export function objectIris(dataset: DatasetCore, subject: string, predicate: string): string[] {
  const out: string[] = [];
  for (const q of dataset.match(namedNode(subject), namedNode(predicate), null)) {
    if (q.object.termType === "NamedNode" && isHttpUrl(q.object.value)) out.push(q.object.value);
  }
  return out;
}

/** First object IRI for (subject, predicate), or undefined. */
export function objectIri(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  return objectIris(dataset, subject, predicate)[0];
}

/** First LITERAL object value for (subject, predicate), or undefined. */
export function objectLiteral(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  for (const q of dataset.match(namedNode(subject), namedNode(predicate), null)) {
    if (q.object.termType === "Literal") return q.object.value;
  }
  return undefined;
}

/** All subject IRIs carrying rdf:type `typeIri`. */
export function subjectsOfType(dataset: DatasetCore, typeIri: string): string[] {
  const out: string[] = [];
  const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  for (const q of dataset.match(null, rdfType, namedNode(typeIri))) {
    if (q.subject.termType === "NamedNode") out.push(q.subject.value);
  }
  return out;
}

/** Replace all (subject, predicate, *) with a single IRI object. */
export function setIri(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: string,
): void {
  removeAll(dataset, subject, predicate);
  dataset.add(quad(namedNode(subject), namedNode(predicate), namedNode(value)));
}

/** Add one (subject, predicate, IRI) triple. */
export function addIri(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: string,
): void {
  dataset.add(quad(namedNode(subject), namedNode(predicate), namedNode(value)));
}

/** Replace all (subject, predicate, *) with one string literal. */
export function setStringLiteral(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: string,
): void {
  removeAll(dataset, subject, predicate);
  dataset.add(quad(namedNode(subject), namedNode(predicate), literal(value)));
}

/** Replace all (subject, predicate, *) with one xsd:dateTime literal. */
export function setDateTimeLiteral(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: Date,
): void {
  removeAll(dataset, subject, predicate);
  dataset.add(
    quad(
      namedNode(subject),
      namedNode(predicate),
      literal(value.toISOString(), namedNode(XSD.dateTime)),
    ),
  );
}

/** Remove every (subject, predicate, *) quad. */
export function removeAll(dataset: DatasetCore, subject: string, predicate: string): void {
  for (const q of [...dataset.match(namedNode(subject), namedNode(predicate), null)]) {
    dataset.delete(q);
  }
}

/** Remove a specific (subject, predicate, objectIri) quad. */
export function removeIri(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: string,
): void {
  dataset.delete(quad(namedNode(subject), namedNode(predicate), namedNode(value)));
}

/** Remove every quad whose SUBJECT is `subject` (delete a node's description). */
export function removeSubject(dataset: DatasetCore, subject: Quad_Subject | string): void {
  const s: Term = typeof subject === "string" ? namedNode(subject) : subject;
  for (const q of [...dataset.match(s as Quad_Subject, null, null)]) dataset.delete(q);
}

/** Whether the dataset has any quad with this subject IRI. */
export function hasSubject(dataset: DatasetCore, subject: string): boolean {
  for (const _q of dataset.match(namedNode(subject), null, null)) return true;
  return false;
}

export type { Quad_Object };
export { literal, namedNode, quad };
