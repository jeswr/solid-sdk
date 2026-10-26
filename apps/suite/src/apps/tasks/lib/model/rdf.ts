// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { escapeIri, isHttpIri } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

export { DataFactory, NS, Store };
/** Tasks retains the shared model's HTTP schema.org wire contract (DECISIONS V7). */
export const SCHEMA = NS.SCHEMA.replace("https:", "http:");
export const SCHED = NS.SCHEDULING;
const legacySched = "https://w3id.org/jeswr/sectors/scheduling#";
export function aliases(predicate: string): string[] {
  if (predicate.startsWith(SCHED)) return [predicate, predicate.replace(SCHED, legacySched)];
  if (predicate.startsWith(SCHEMA)) return [predicate, predicate.replace(SCHEMA, NS.SCHEMA)];
  return [predicate];
}

/** Shared typed accessor plumbing; never creates quads directly. */
export class Node extends TermWrapper {
  text(predicate: string): string | undefined {
    for (const p of aliases(predicate)) {
      const term = OptionalFrom.subjectPredicate(this, p, TermAs.term);
      if (term?.termType === "Literal") return term.value;
    }
    return undefined;
  }
  setText(predicate: string, value: string | undefined): void {
    this.clear(predicate);
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  number(predicate: string): number | undefined {
    const text = this.text(predicate);
    return text === undefined ? undefined : Number(text);
  }
  setNumber(predicate: string, value: number | undefined, integer = false): void {
    this.clear(predicate);
    OptionalAs.object(this, predicate, value, integer ? LiteralFrom.integer : LiteralFrom.double);
  }
  date(predicate: string): Date | undefined {
    const value = this.text(predicate);
    return value === undefined ? undefined : new Date(value);
  }
  setDate(predicate: string, value: Date | undefined): void {
    this.clear(predicate);
    OptionalAs.object(this, predicate, value, LiteralFrom.dateTime);
  }
  setTyped(predicate: string, value: string | undefined, datatype: string): void {
    this.clear(predicate);
    OptionalAs.object(
      this,
      predicate,
      value === undefined ? undefined : ([datatype, value] as [string, string]),
      LiteralFrom.datatypeTuple,
    );
  }
  iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  setIri(predicate: string, value: string | undefined): void {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  iris(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  nodes(predicate: string): Set<Node> {
    return SetFrom.subjectPredicate(this, predicate, TermAs.instance(Node), TermFrom.instance);
  }
  clear(predicate: string): void {
    for (const p of aliases(predicate)) this.nodes(p).clear();
  }
  child(): Node {
    return new Node(this.factory.blankNode(), this.dataset, this.factory);
  }
  get types(): Set<string> {
    return this.iris(`${NS.RDF}type`);
  }
}

/** Preserve shared linked nodes; edits receive a copy with the same foreign metadata. */
export function editableNode(value: Node): Node {
  if (!value.dataset.match(null, null, TermFrom.instance(value, value.factory)).size) return value;
  const copy = value.child();
  for (const quad of value.dataset.match(TermFrom.instance(value, value.factory)))
    copy.nodes(quad.predicate.value).add(new Node(quad.object, value.dataset, value.factory));
  return copy;
}
/** Drop only fields owned by this model, and only after the node is unlinked everywhere. */
export function clearSchedulingNode(
  value: Node,
  predicates: readonly string[],
  type: string,
): void {
  if (value.dataset.match(null, null, TermFrom.instance(value, value.factory)).size) return;
  for (const predicate of predicates) value.clear(predicate);
  for (const iri of aliases(type)) value.types.delete(iri);
}

export function node(id: string, dataset: DatasetCore): Node {
  return new Node(id, dataset, DataFactory);
}
export async function parse(
  url: string,
  body: string,
  contentType = "text/turtle",
): Promise<Store> {
  return new Store([...(await parseRdf(body, contentType, { baseIRI: url }))]);
}
export function serialize(dataset: DatasetCore): Promise<string> {
  // Accessors and foreign datasets can bypass field validation. Reject unsafe lexical
  // IRIs without silently changing RDF identities during persistence.
  for (const quad of dataset)
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      const iri = term.termType === "Literal" ? term.datatype : term;
      if (iri.termType === "NamedNode" && escapeIri(iri.value) !== iri.value)
        throw new TypeError("Unsafe RDF IRI.");
    }
  const writer = new Writer({
    prefixes: {
      wf: NS.WF,
      dct: NS.DCT,
      schema: SCHEMA,
      prov: NS.PROV,
      sched: SCHED,
      solid: NS.SOLID,
      rdfs: NS.RDFS,
      vcard: NS.VCARD,
      xsd: NS.XSD,
    },
  });
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}
/** Ported from Pod Manager productivity-store; deterministic suffixes are used for projects. */
export function slug(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "project"
  );
}
export function uniqueSlug(title: string, used: Iterable<string>): string {
  const taken = new Set(used);
  const base = slug(title);
  let value = base;
  for (let n = 2; taken.has(value); n++) value = `${base}-${n}`;
  return value;
}
export function requireTitle(title: string | undefined): void {
  if (!title?.trim()) throw new TypeError("A title is required.");
}
export function requireDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Invalid date.");
}
export function requireHttp(value: string): string {
  if (!isHttpIri(value)) throw new TypeError("Expected a safe HTTP(S) URL.");
  const url = new URL(value);
  if (url.username || url.password) throw new TypeError("Expected an HTTP(S) URL.");
  return value;
}
export function documentUrl(value: string): string {
  const url = new URL(requireHttp(value));
  url.hash = "";
  return url.href;
}
