// AUTHORED-BY Codex GPT-6.1-Sol
import type { RdfReadResult } from "@jeswr/storage-client";
import { NS } from "@jeswr/suite-vocab";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
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
  const dataset = read
    ? new Store([...subject.dataset.match(subject.node, null, null, DataFactory.defaultGraph())])
    : subject.dataset;
  const profile = new entities.Profile.Wrapper(subject.value, dataset, DataFactory);
  return {
    [PUBLIC]: profile.publicTypeIndex,
    [PRIVATE]: profile.privateTypeIndex,
    [PREFS]: profile.preferencesFile,
  }[predicate] as Set<string>;
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
  const data = {
    forClass: [iri],
    ...(container ? { instanceContainer: [target] } : { instance: [target] }),
  };
  for (const quad of entities.TypeRegistration.build(subject, data)) document.dataset.add(quad);
}

export function removeRegistration(subject: Resource, container: boolean): void {
  const predicate = container ? CONTAINER : INSTANCE;
  const iri = subject.iris(CLASS)[0] as string;
  const location = subject.iris(predicate)[0] as string;
  if (subject.termType === "BlankNode") {
    subject.values(CLASS).delete(iri);
    subject.values(predicate).delete(location);
  } else {
    const reg = new entities.TypeRegistration.Wrapper(subject.value, subject.dataset, DataFactory);
    reg.forClass.delete(iri);
    (container ? reg.instanceContainer : reg.instance).delete(location);
  }
  // Remove only the exact explicit type, preserving every unrelated annotation/type.
  subject.values(TYPE).delete(REGISTRATION);
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
  try {
    return await entities.TypeIndex.storeToTurtle(new Store([...document.dataset]));
  } catch (cause) {
    // Preserve the public N3 error contract; runtime integrity failures stay fail-closed.
    if (cause instanceof TypeError && cause.message === "RDF serialization failed") {
      throw cause.cause;
    }
    throw cause;
  }
}
