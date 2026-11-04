// AUTHORED-BY Codex GPT-6
import type { NormalisedDoc } from "@jeswr/pod-connectors";
import { DataFactory } from "n3";
import { classificationForSourceClass } from "../../lib/model/classify";
import { type DataCategory, DOMAINS, UNCATEGORISED } from "../../lib/model/domains";

/** Empty snapshots still get written (and carry document provenance), but they
 * contain no items to navigate to. Classify only collections with source items. */
export function domainForWrittenDocument(doc: NormalisedDoc): DataCategory | undefined {
  if (
    !doc.dataset.match(
      null,
      DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      DataFactory.namedNode(doc.forClass),
    ).size
  )
    return undefined;
  const { domain } = classificationForSourceClass(
    doc.forClass,
    doc.sourceUrl ? [doc.sourceUrl] : [],
  );
  if (domain.id !== "other") return domain;
  // Some companion classes (Spotify artists/playback events) use sector types.
  return DOMAINS.find((domain) => domain.id === doc.category) ?? UNCATEGORISED;
}
