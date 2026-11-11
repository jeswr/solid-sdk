// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  assertSerializedQuads,
  assertWritableQuads,
  isSafeAbsoluteIri,
  isTurtlePrefixName,
} from "@jeswr/model-runtime";
import type { DatasetCore, Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, type Store, Writer } from "n3";
export const SH = "http://www.w3.org/ns/shacl#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const DASH = "http://datashapes.org/dash#";
export const LIMIT = {
  quads: 10000,
  bytes: 524288,
  fields: 256,
  options: 1024,
  depth: 4,
  values: 10000,
  text: 65536,
} as const;
export const termId = (term: Term): string =>
  JSON.stringify([
    term.termType,
    term.value,
    term.termType === "Literal" ? [term.datatype.value, term.language] : null,
  ]);
export function* objects(data: DatasetCore, subject: Term, predicate: string): Generator<Term> {
  const lazy = (data as DatasetCore & { readQuads?: Store["readQuads"] }).readQuads;
  const quads = lazy
    ? lazy.call(data, subject, DataFactory.namedNode(predicate), null, null)
    : data.match(subject, DataFactory.namedNode(predicate));
  for (const q of quads) yield q.object;
}
/** All graph construction, including RDF lists, uses wrapper accessors. */
export function put(store: Store, subject: Term, predicate: string, object: Term): void {
  const wrapper = new TermWrapper(subject, store, DataFactory);
  SetFrom.subjectPredicate(wrapper, predicate, TermAs.term, TermFrom.itself).add(object);
}
const prefixesByStore = new WeakMap<Store, Record<string, string>>();
export function withPrefixes(store: Store, prefixes?: Record<string, string>): Store {
  prefixesByStore.set(store, { ...prefixes });
  return store;
}
export function checkedPrefixes(prefixes: Record<string, string> = {}): Record<string, string> {
  if (Object.keys(prefixes).length > 256) throw new TypeError("too many prefixes");
  for (const [name, iri] of Object.entries(prefixes)) {
    if (!isTurtlePrefixName(name) || !isSafeAbsoluteIri(iri))
      throw new TypeError("unsafe prefix declaration");
  }
  return prefixes;
}
export async function serialize(store: Store): Promise<string> {
  if (store.size > LIMIT.quads) throw new TypeError("serialization quad limit exceeded");
  const quads = [...store];
  assertWritableQuads(quads);
  const writer = new Writer({ prefixes: checkedPrefixes(prefixesByStore.get(store)) });
  writer.addQuads(quads);
  const ttl = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  assertSerializedQuads(quads, ttl);
  return ttl;
}
