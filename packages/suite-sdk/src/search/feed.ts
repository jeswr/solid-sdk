// AUTHORED-BY Codex GPT-6.1-Sol
import { buildListingDataset } from "@jeswr/ldp-container";
import type { LocalIndex, Quad, QuadSource } from "@jeswr/rdf-engine";
import type { Entry } from "@jeswr/storage-client";
import { httpIri } from "./query.js";

/**
 * Build listing metadata with RDF/JS terms, including names for un-fetched binary files.
 * Call with the complete successful listing (all pages); replacement drops removed members.
 */
export function containerSearchDataset(container: string, entries: Iterable<Entry>): Quad[] {
  return buildListingDataset(
    httpIri(container),
    Array.from(entries, (entry) => {
      const url = httpIri(entry.url);
      const path = new URL(entry.url).pathname.replace(/\/$/, "");
      const segment = path.slice(path.lastIndexOf("/") + 1);
      let title: string;
      try {
        title = decodeURIComponent(segment);
      } catch {
        title = segment;
      }
      return { ...entry, url, title, types: entry.types.map((type) => httpIri(type)) };
    }),
  );
}

/**
 * Feeder seam for cached parsed RDF and complete StorageClient listings. solid-offline's
 * onVisit currently has no dataset: invoke resource(url, dataset) in the page's cache pipeline.
 */
export function createSearchFeeder(index: LocalIndex): {
  resource(url: string, dataset: QuadSource): Promise<void>;
  container(url: string, entries: Iterable<Entry>): Promise<void>;
} {
  return {
    resource: (url, dataset) => index.put(httpIri(url), dataset),
    container: (url, entries) =>
      index.put(
        `urn:jeswr:search:listing:${encodeURIComponent(httpIri(url))}`,
        containerSearchDataset(url, entries),
      ),
  };
}
