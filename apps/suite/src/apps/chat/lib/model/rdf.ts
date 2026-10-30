// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { safeIri, serialize } from "@jeswr/rdf-serialize";
import { sanitizeText } from "@jeswr/solid-chat-interop";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { ChatModelError, httpIri } from "./validation";

export { NS };
export const RDF_TYPE = `${NS.RDF}type`;

/** Small typed accessor shared by collection, room, and message metadata. */
export class ChatNode extends TermWrapper {
  get types(): Set<string> {
    return this.refs(RDF_TYPE);
  }
  refs(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  setText(predicate: string, value: string | undefined): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  setIri(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  setDate(predicate: string, value: Date): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.dateTime);
  }
}
/** Per-object filtering avoids one malformed value hiding the rest of a foreign set. */
export function readRefs(dataset: DatasetCore, subject: string, predicate: string): string[] {
  const values = new Set<string>();
  for (const q of dataset.match(
    DataFactory.namedNode(subject),
    null,
    null,
    DataFactory.defaultGraph(),
  )) {
    if (canonicalize(q.predicate.value) !== predicate || q.object.termType !== "NamedNode")
      continue;
    try {
      values.add(httpIri(predicate === RDF_TYPE ? canonicalize(q.object.value) : q.object.value));
    } catch {
      /* Foreign invalid IRIs are not navigation targets. */
    }
  }
  return [...values].sort();
}
export function readText(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  for (const q of dataset.match(
    DataFactory.namedNode(subject),
    null,
    null,
    DataFactory.defaultGraph(),
  )) {
    if (canonicalize(q.predicate.value) === predicate && q.object.termType === "Literal")
      return LiteralAs.string(new TermWrapper(q.object, dataset, DataFactory));
  }
  return undefined;
}
export function readDate(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
): string | undefined {
  const raw = readText(dataset, subject, predicate);
  if (raw === undefined) return undefined;
  const at = new Date(raw);
  return Number.isFinite(at.getTime()) ? at.toISOString() : undefined;
}
export async function parseChat(
  body: string,
  url: string,
  contentType: string | null = "text/turtle",
) {
  return parseRdf(body, contentType, { baseIRI: httpIri(url) });
}
/** All persisted RDF passes through the shared n3 Writer; named graphs would lose identity in Turtle. */
export async function serializeChat(dataset: DatasetCore, format = "text/turtle"): Promise<string> {
  for (const q of dataset) {
    if (q.object.termType === "Literal" && sanitizeText(q.object.value) !== q.object.value)
      throw new ChatModelError("invalid-input");
    if (q.graph.termType !== "DefaultGraph") throw new ChatModelError("invalid-input");
    for (const term of [
      q.subject,
      q.predicate,
      q.object,
      ...(q.object.termType === "Literal" ? [q.object.datatype] : []),
    ]) {
      if (term.termType === "NamedNode" && safeIri(term.value) !== term.value)
        throw new ChatModelError("invalid-input");
    }
  }
  return serialize([...dataset], { format });
}
