// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";

/** Metadata for one member of a synthetic listing; callers supply validated IRIs. */
export interface ListingMetadata {
  readonly url: string;
  readonly title: string;
  readonly modified: Date | null;
  readonly size: number | null;
  readonly contentType: string | null;
  readonly types: readonly string[];
}

/**
 * Build default-graph membership and supplied metadata through generated accessors.
 * No types are inferred and null fields are omitted. This performs no I/O or pod-scope checks.
 */
export function buildListingDataset(
  containerUrl: string,
  entries: Iterable<ListingMetadata>,
): Quad[] {
  const dataset = new Store();
  const container = new entities.ListingContainer.Wrapper(containerUrl, dataset, DataFactory);
  for (const entry of entries) {
    const resource = new entities.ListingMember.Wrapper(entry.url, dataset, DataFactory);
    container.contains.add(entry.url);
    resource.title.add(entry.title);
    if (entry.modified !== null) {
      // Preserve the original RangeError contract instead of silently dropping an invalid Date.
      entry.modified.toISOString();
      resource.modified.add(entry.modified);
    }
    if (entry.size !== null) resource.size.add(entry.size);
    if (entry.contentType !== null) resource.format.add(entry.contentType);
    for (const type of entry.types) resource.types.add(type);
  }
  return [...dataset];
}
