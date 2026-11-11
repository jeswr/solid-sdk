// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";
import { DCT } from "./vocab.js";
export interface DocumentVersion {
  url: string;
  snapshot: string;
  created: string;
  creator?: string | undefined;
  name?: string | undefined;
  kind: "named" | "automatic";
}

export function readVersion(url: string, dataset: DatasetCore): Omit<DocumentVersion, "url"> {
  const node = new entities.Revision.Wrapper(url, dataset, DataFactory);
  const { created, snapshot, kind } = node;
  // Untyped version metadata shares a generated view with sparse revisions;
  // only this facet's presence requirements cannot be expressed on prov:Entity.
  if (!created || !snapshot || kind === undefined) throw new Error("Malformed document version");
  // Generator gap: optional root fields drop malformed terms. The old untyped
  // version facet instead isolates the whole entry when the creator mapper throws.
  const anchor = new TermWrapper(url, dataset, DataFactory);
  OptionalFrom.subjectPredicate(anchor, DCT.creator, NamedNodeAs.string);
  return {
    created: created.toISOString(),
    snapshot,
    kind,
    creator: node.creator,
    name: node.label,
  };
}
export function buildVersion(version: DocumentVersion): Store {
  const dataset = new Store();
  const node = new entities.Revision.Wrapper(version.url, dataset, DataFactory);
  node.created = new Date(version.created);
  node.creator = version.creator;
  node.label = version.name;
  node.kind = version.kind;
  node.snapshot = version.snapshot;
  return dataset;
}
