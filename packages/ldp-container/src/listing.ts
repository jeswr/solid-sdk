// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import { addLiteralTriple } from "@jeswr/rdf-serialize/wrapper";
import { NS } from "@jeswr/suite-vocab";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";

/** Metadata for one member of a synthetic listing; callers supply validated IRIs. */
export interface ListingMetadata {
  readonly url: string;
  readonly title: string;
  readonly modified: Date | null;
  readonly size: number | null;
  readonly contentType: string | null;
  readonly types: readonly string[];
}

/** Write listing literals alongside Resource's existing mutable rdf:type accessor. */
class ListingResource extends Resource {
  override set title(value: string) {
    addLiteralTriple(this, `${NS.DCT}title`, value);
  }

  override set modified(value: Date) {
    addLiteralTriple(this, `${NS.DCT}modified`, value.toISOString(), `${NS.XSD}dateTime`);
  }

  override set size(value: number) {
    addLiteralTriple(this, `${NS.POSIX}size`, String(value), `${NS.XSD}integer`);
  }

  set format(value: string) {
    addLiteralTriple(this, `${NS.DCT}format`, value);
  }
}

/**
 * Build default-graph membership and supplied metadata through typed RDF accessors.
 * No types are inferred and null fields are omitted. This performs no I/O or scope checks.
 */
export function buildListingDataset(
  containerUrl: string,
  entries: Iterable<ListingMetadata>,
): Quad[] {
  const dataset = new Store();
  const container = new Container(containerUrl, dataset, DataFactory);
  for (const entry of entries) {
    const resource = new ListingResource(entry.url, dataset, DataFactory);
    container.contains.add(resource);
    resource.title = entry.title;
    if (entry.modified !== null) resource.modified = entry.modified;
    if (entry.size !== null) resource.size = entry.size;
    if (entry.contentType !== null) resource.format = entry.contentType;
    for (const type of entry.types) resource.type.add(type);
  }
  return [...dataset];
}
