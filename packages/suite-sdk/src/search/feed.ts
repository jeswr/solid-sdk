// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, type LocalIndex, type Quad, type QuadSource } from "@jeswr/rdf-engine";
import type { Entry } from "@jeswr/storage-client";
import { httpIri } from "./query.js";

const { namedNode, literal, quad } = DataFactory;
const dct = "http://purl.org/dc/terms/";
const xsd = "http://www.w3.org/2001/XMLSchema#";

/**
 * Build listing metadata with RDF/JS terms, including names for un-fetched binary files.
 * Call with the complete successful listing (all pages); replacement drops removed members.
 */
export function containerSearchDataset(container: string, entries: Iterable<Entry>): Quad[] {
  const subject = namedNode(httpIri(container));
  const quads: Quad[] = [];
  for (const entry of entries) {
    const member = namedNode(httpIri(entry.url));
    const path = new URL(entry.url).pathname.replace(/\/$/, "");
    const segment = path.slice(path.lastIndexOf("/") + 1);
    let title: string;
    try {
      title = decodeURIComponent(segment);
    } catch {
      title = segment;
    }
    quads.push(
      quad(subject, namedNode("http://www.w3.org/ns/ldp#contains"), member),
      quad(member, namedNode(`${dct}title`), literal(title)),
    );
    if (entry.modified !== null)
      quads.push(
        quad(
          member,
          namedNode(`${dct}modified`),
          literal(entry.modified.toISOString(), namedNode(`${xsd}dateTime`)),
        ),
      );
    if (entry.size !== null)
      quads.push(
        quad(
          member,
          namedNode("http://www.w3.org/ns/posix/stat#size"),
          literal(String(entry.size), namedNode(`${xsd}integer`)),
        ),
      );
    if (entry.contentType !== null)
      quads.push(quad(member, namedNode(`${dct}format`), literal(entry.contentType)));
    for (const type of entry.types)
      quads.push(
        quad(
          member,
          namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          namedNode(httpIri(type)),
        ),
      );
  }
  return quads;
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
