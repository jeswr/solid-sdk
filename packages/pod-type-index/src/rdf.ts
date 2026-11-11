// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  assertSerializedQuads,
  assertWritableQuads,
  isSafeAbsoluteIri,
} from "@jeswr/model-runtime";
import type { RdfReadResult } from "@jeswr/storage-client";
import { NS } from "@jeswr/suite-vocab";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { error } from "./common.js";
import { entities, type TypeRegistrationData } from "./generated/model.js";

export const PUBLIC = `${NS.SOLID}publicTypeIndex`;
export const PRIVATE = `${NS.SOLID}privateTypeIndex`;
export const PREFS = `${NS.PIM}preferencesFile`;
export const CLASS = `${NS.SOLID}forClass`;
export const INSTANCE = `${NS.SOLID}instance`;
export const CONTAINER = `${NS.SOLID}instanceContainer`;
export const TYPE = `${NS.RDF}type`;
export const REGISTRATION = `${NS.SOLID}TypeRegistration`;
export const INDEX = `${NS.SOLID}TypeIndex`;

/** Raw evidence for mutation policy, and the blank-subject gap in generated wrappers. */
export class Resource extends TermWrapper {
  get node() {
    return this.termType === "BlankNode"
      ? DataFactory.blankNode(this.value)
      : DataFactory.namedNode(this.value);
  }
  iris(predicate: string): string[] {
    const out: string[] = [];
    for (const q of this.dataset.match(
      this.node,
      DataFactory.namedNode(predicate),
      undefined,
      DataFactory.defaultGraph(),
    )) {
      if (q.object.termType === "NamedNode") out.push(q.object.value);
    }
    return out;
  }

  values(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

export class IndexDataset extends DatasetWrapper {
  get registrations(): Iterable<Resource> {
    return [...this.instancesOf(REGISTRATION, Resource)].filter((reg) =>
      reg.iris(TYPE).includes(REGISTRATION),
    );
  }
}

/** Generated pointers work on untyped WebID subjects without adding a foaf:Agent type. */
export function pointer(subject: Resource, predicate: string, read = false): Set<string> {
  if (!isSafeAbsoluteIri(subject.value)) throw error("scope", subject.value);
  const dataset = read
    ? new Store([...subject.dataset.match(subject.node, null, null, DataFactory.defaultGraph())])
    : subject.dataset;
  const profile = new entities.Profile.Wrapper(subject.value, dataset, DataFactory);
  switch (predicate) {
    case PUBLIC:
      return profile.publicTypeIndex;
    case PRIVATE:
      return profile.privateTypeIndex;
    case PREFS:
      return profile.preferencesFile;
    default:
      return new Set<string>();
  }
}

export function registrationData(subject: Resource): TypeRegistrationData {
  // Runtime subjects are NamedNodes only. Keep the original typed read for blank nodes;
  // never skolemize them, since removal must retain their identity and annotations.
  if (subject.termType === "BlankNode") {
    return {
      forClass: subject.iris(CLASS),
      instance: subject.iris(INSTANCE),
      instanceContainer: subject.iris(CONTAINER),
    };
  }
  // Generated reads see a union of graphs. This package deliberately reads only the
  // default graph; project the current subject, keeping the work linear in index size.
  const dataset = new Store([
    ...subject.dataset.match(subject.node, null, null, DataFactory.defaultGraph()),
  ]);
  return entities.TypeRegistration.parse(subject.value, dataset) ?? {};
}

export function addRegistration(
  document: RdfReadResult,
  subject: string,
  iri: string,
  target: string,
  container: boolean,
): void {
  if (![subject, iri, target].every(isSafeAbsoluteIri)) throw error("scope", document.url);
  const data = {
    forClass: [iri],
    ...(container ? { instanceContainer: [target] } : { instance: [target] }),
  };
  const built = entities.TypeRegistration.build(subject, data);
  // Optional generated fields can silently drop invalid values. Never publish a shell.
  if (
    built.match(
      DataFactory.namedNode(subject),
      DataFactory.namedNode(container ? CONTAINER : INSTANCE),
      DataFactory.namedNode(target),
      DataFactory.defaultGraph(),
    ).size !== 1
  ) {
    throw error("scope", document.url);
  }
  for (const quad of built) document.dataset.add(quad);
}

export function removeRegistration(subject: Resource, container: boolean): void {
  const predicate = container ? CONTAINER : INSTANCE;
  const iri = subject.iris(CLASS)[0] as string;
  const location = subject.iris(predicate)[0] as string;
  const reg =
    subject.termType === "BlankNode"
      ? undefined
      : new entities.TypeRegistration.Wrapper(subject.value, subject.dataset, DataFactory);
  const classes = reg ? reg.forClass : subject.values(CLASS);
  const locations = reg
    ? container
      ? reg.instanceContainer
      : reg.instance
    : subject.values(predicate);
  // A failed delete must abort the mutation before the type marker or any storage write.
  if (!classes.delete(iri) || !locations.delete(location)) throw error("conflict", subject.value);
  // Remove only the exact explicit type, preserving every unrelated annotation/type.
  if (!subject.values(TYPE).delete(REGISTRATION)) throw error("conflict", subject.value);
}

export function markIndex(document: RdfReadResult, visibility: "public" | "private"): void {
  new entities.TypeIndex.Wrapper(document.url, document.dataset, DataFactory)
    .mark()
    .types.add(`${NS.SOLID}${visibility === "public" ? "ListedDocument" : "UnlistedDocument"}`);
}

export function resource(document: RdfReadResult, subject: string): Resource {
  return new Resource(subject, document.dataset, DataFactory);
}

export function emptyDocument(url: string): RdfReadResult {
  return { url, etag: null, contentType: "text/turtle", dataset: new Store() };
}

export function indexDataset(document: RdfReadResult): IndexDataset {
  return new IndexDataset(document.dataset, DataFactory);
}

export async function serialize(document: RdfReadResult): Promise<string> {
  const quads = [...document.dataset];
  assertWritableQuads(quads);
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads(quads);
  const result = await new Promise<string>((resolve, reject) => {
    writer.end((cause, text) => (cause ? reject(cause) : resolve(text)));
  });
  assertSerializedQuads(quads, result);
  return result;
}
