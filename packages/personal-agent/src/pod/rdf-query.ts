// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * RDF/JS query helpers over a `DatasetCore` — the shape `@jeswr/fetch-rdf`'s `parseRdf`
 * returns (only the standard `.match()` interface, NOT n3's `getSubjects`/`getObjects`
 * convenience methods). Reads go through these so every consumer uses the sanctioned parse
 * result uniformly.
 */
import type { DatasetCore, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";

const { namedNode } = DataFactory;

/** All object terms of `(subject, predicate, *)`. */
export function objectsOf(store: DatasetCore, subject: string, predicate: string): Quad_Object[] {
  const out: Quad_Object[] = [];
  for (const q of store.match(namedNode(subject), namedNode(predicate), null, null)) {
    out.push(q.object);
  }
  return out;
}

/** All subject terms of `(*, predicate, object)`. */
export function subjectsOf(
  store: DatasetCore,
  predicate: string,
  object: Term | null,
): Quad_Subject[] {
  const out: Quad_Subject[] = [];
  for (const q of store.match(null, namedNode(predicate), object, null)) {
    out.push(q.subject);
  }
  return out;
}

/** The first literal object value of `(subject, predicate)`. */
export function firstLiteralOf(
  store: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  for (const object of objectsOf(store, subject, predicate)) {
    if (object.termType === "Literal") return object.value;
  }
  return undefined;
}

/** The first named-node IRI object of `(subject, predicate)`. */
export function firstIriOf(
  store: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  for (const object of objectsOf(store, subject, predicate)) {
    if (object.termType === "NamedNode") return object.value;
  }
  return undefined;
}
