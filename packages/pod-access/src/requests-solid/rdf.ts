// AUTHORED-BY Codex GPT-6
import { escapeIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Quad, Quad_Subject, Term } from "@rdfjs/types";
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

/** BCP 47 shape only; n3.Writer emits language tags verbatim. */
const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * Never serialize an untrusted term verbatim through n3.Writer. IRIs and datatypes must already
 * be escaped, language tags must be well formed, and only the default graph is accepted. Blank
 * node labels come from foreign documents (JSON-LD allows any label), so every blank node is
 * relabelled to a generated `b<n>` label, preserving identity within the document.
 */
export async function turtle(dataset: DatasetCore): Promise<string> {
  const copy = canonicalizeAccmDataset(dataset, DataFactory);
  const labels = new Map<string, string>();
  const safe = <T extends Term>(term: T): T => {
    if (term.termType === "NamedNode" && escapeIri(term.value) !== term.value) {
      throw new TypeError("Unsafe RDF IRI");
    }
    if (term.termType === "Literal") {
      if (escapeIri(term.datatype.value) !== term.datatype.value) {
        throw new TypeError("Unsafe RDF datatype");
      }
      if (term.language !== "" && !LANGUAGE_TAG.test(term.language)) {
        throw new TypeError("Unsafe RDF language tag");
      }
    }
    if (term.termType === "BlankNode") {
      let label = labels.get(term.value);
      if (label === undefined) {
        label = `b${labels.size}`;
        labels.set(term.value, label);
      }
      return DataFactory.blankNode(label) as unknown as T;
    }
    return term;
  };
  const quads: Quad[] = [];
  for (const q of copy) {
    if (q.graph.termType !== "DefaultGraph") throw new TypeError("Named graphs are not supported");
    quads.push(DataFactory.quad(safe(q.subject), safe(q.predicate), safe(q.object)) as Quad);
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads(quads);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
