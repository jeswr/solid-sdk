// AUTHORED-BY Codex GPT-6
import { escapeIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Quad_Subject } from "@rdfjs/types";
import { LiteralFrom, NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import { accmAliases, canonicalizeAccmDataset } from "./canonical-vocab.js";

/** Read foreign objects individually, so one malformed value cannot hide its siblings. */
export function values(
  dataset: DatasetCore,
  subject: string | Quad_Subject,
  predicate: string,
): string[] {
  const out: string[] = [];
  for (const p of accmAliases(predicate)) {
    for (const q of dataset.match(
      typeof subject === "string" ? DataFactory.namedNode(subject) : subject,
      DataFactory.namedNode(p),
    )) {
      if (q.object.termType === "NamedNode" || q.object.termType === "Literal") {
        out.push(q.object.value);
      }
    }
  }
  return out;
}

/** Typed scalar writes; the caller supplies trusted predicates and validated values. */
export function set(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  value: string | Date | undefined,
  iri = false,
): void {
  const node = new TermWrapper(subject, dataset, DataFactory);
  for (const p of accmAliases(predicate)) {
    OptionalAs.object(node, p, undefined, NamedNodeFrom.string);
  }
  if (value instanceof Date) {
    OptionalAs.object(node, predicate, value, LiteralFrom.dateTime);
  } else {
    OptionalAs.object(node, predicate, value, iri ? NamedNodeFrom.string : LiteralFrom.string);
  }
}

/** Never serialize an untrusted IRI verbatim through n3.Writer. Refuse identity changes. */
export async function turtle(dataset: DatasetCore): Promise<string> {
  const copy = canonicalizeAccmDataset(dataset, DataFactory);
  for (const q of copy) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (term.termType === "NamedNode" && escapeIri(term.value) !== term.value) {
        throw new TypeError("Unsafe RDF IRI");
      }
      if (term.termType === "Literal" && escapeIri(term.datatype.value) !== term.datatype.value) {
        throw new TypeError("Unsafe RDF datatype");
      }
    }
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...copy]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
