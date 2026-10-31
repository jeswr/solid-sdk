// AUTHORED-BY Codex GPT-6.1-Sol
import type { RdfReadResult } from "@jeswr/storage-client";
import { NS } from "@jeswr/suite-vocab";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

export const PUBLIC = `${NS.SOLID}publicTypeIndex`;
export const PRIVATE = `${NS.SOLID}privateTypeIndex`;
export const PREFS = `${NS.PIM}preferencesFile`;
export const CLASS = `${NS.SOLID}forClass`;
export const INSTANCE = `${NS.SOLID}instance`;
export const CONTAINER = `${NS.SOLID}instanceContainer`;
export const TYPE = `${NS.RDF}type`;
export const REGISTRATION = `${NS.SOLID}TypeRegistration`;
export const INDEX = `${NS.SOLID}TypeIndex`;

/** Typed writes; tolerant per-object reads keep good IRIs beside malformed foreign values. */
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

export function resource(document: RdfReadResult, subject: string): Resource {
  return new Resource(subject, document.dataset, DataFactory);
}

export function emptyDocument(url: string): RdfReadResult {
  return { url, etag: null, contentType: "text/turtle", dataset: new Store() };
}

export function indexDataset(document: RdfReadResult): IndexDataset {
  return new IndexDataset(document.dataset, DataFactory);
}

export function serialize(document: RdfReadResult): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads([...document.dataset]);
    writer.end((error, text) => (error ? reject(error) : resolve(text)));
  });
}
