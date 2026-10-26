// AUTHORED-BY Codex GPT-6.1-Sol
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RdfFetchError, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import type { DataFactory as RdfFactory, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { JsonLdParser } from "jsonld-streaming-parser";
import { DataFactory, Store, StreamParser, Writer } from "n3";
import {
  decodePrefix,
  limitedBody,
  MAX_CONTENT_BYTES,
  mediaType,
  normalizeLocalJsonLd,
} from "./content.js";

/** Bound object overhead even for tiny or duplicate statements. */
export const MAX_RDF_QUADS = 16_384;

export class RdfLimitError extends Error {
  constructor() {
    super("RDF expansion/output budget exhausted.");
  }
}

function termBytes(term: Term, depth = 0): number {
  if (depth > 64) throw new RdfLimitError();
  if (term.termType === "Quad") {
    return (
      termBytes(term.subject, depth + 1) +
      termBytes(term.predicate, depth + 1) +
      termBytes(term.object, depth + 1) +
      termBytes(term.graph, depth + 1)
    );
  }
  return (
    Buffer.byteLength(term.value) +
    (term.termType === "Literal" ? Buffer.byteLength(term.language) + termBytes(term.datatype) : 0)
  );
}

/** Check expanded terms before constructing each quad, including duplicates. */
function budgetedFactory(): RdfFactory {
  let quads = 0;
  let bytes = 0;
  let createdBytes = 0;
  function charge(value: string): void {
    createdBytes += Buffer.byteLength(value);
    if (createdBytes > MAX_CONTENT_BYTES) throw new RdfLimitError();
  }
  return {
    ...DataFactory,
    // Also bound expanded declarations and terms that never reach a quad.
    namedNode<Iri extends string = string>(value: Iri) {
      charge(value);
      return DataFactory.namedNode(value);
    },
    blankNode(value) {
      if (value) charge(value);
      return DataFactory.blankNode(value);
    },
    // JSON-LD's factory calls use null for an absent datatype/language.
    literal(value, languageOrDatatype) {
      charge(value);
      // N3 2 supports directional languages; @types/n3 still omits that overload.
      return (DataFactory.literal as RdfFactory["literal"])(value, languageOrDatatype ?? undefined);
    },
    quad(subject, predicate, object, graph = DataFactory.defaultGraph()) {
      bytes += termBytes(subject) + termBytes(predicate) + termBytes(object) + termBytes(graph);
      if (++quads > MAX_RDF_QUADS || bytes > MAX_CONTENT_BYTES) throw new RdfLimitError();
      return DataFactory.quad(subject, predicate, object, graph);
    },
  };
}

/**
 * The pinned parseRdf API only exposes baseIRI, with no quad/factory budget seam.
 * Use its existing parser libraries here so limits apply before Store insertion.
 * Input is already byte-capped; JSON-LD must also pass the local-context guard.
 */
export async function parseBoundedRdf(source: string, contentType: string, baseIRI: string) {
  const format = contentType === "application/x-turtle" ? "text/turtle" : contentType;
  if (!(SUPPORTED_RDF_MEDIA_TYPES as readonly string[]).includes(format)) {
    throw new RdfFetchError(`Unsupported RDF media type: ${format}`, { contentType: format });
  }
  const input = Buffer.from(
    format === "application/ld+json" ? normalizeLocalJsonLd(source) : source,
  );
  const factory = budgetedFactory();
  const parser =
    format === "application/ld+json"
      ? new JsonLdParser({ baseIRI, dataFactory: factory })
      : new StreamParser({ format, baseIRI, factory });
  const dataset = new Store();
  // Small chunks keep parser queues bounded as well as the retained dataset.
  function* chunks() {
    for (let offset = 0; offset < input.length; offset += 4096) {
      yield input.subarray(offset, offset + 4096);
    }
  }
  await pipeline(
    Readable.from(chunks()),
    parser,
    new Writable({
      objectMode: true,
      write(quad, _encoding, done) {
        dataset.addQuad(quad);
        done();
      },
    }),
  );
  return dataset;
}

/** Negotiated, bounded RDF reads for every search discovery/scan path. */
export async function fetchBoundedRdf(url: string, options: { fetch: typeof fetch }) {
  const response = await options.fetch(url, {
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new RdfFetchError(`HTTP ${response.status} fetching ${url}`, { status: response.status });
  }
  const { bytes, truncated } = await limitedBody(response);
  if (truncated) throw new RdfLimitError();
  const dataset = await parseBoundedRdf(
    decodePrefix(bytes, false),
    mediaType(response.headers.get("content-type") ?? "text/turtle"),
    response.url || url,
  );
  return { dataset, headers: response.headers };
}

/** Write a union graph without ever accumulating an oversized Turtle string. */
export function serializeBoundedTurtle(dataset: Store): string {
  const view = new Store();
  for (const graph of dataset.getGraphs(null, null, null)) {
    for (const quad of new NamedGraphDataset(graph, dataset, DataFactory)) view.addQuad(quad);
  }
  const chunks: string[] = [];
  let bytes = 0;
  let failure: Error | undefined;
  const writer = new Writer(
    {
      write(chunk: string, _encoding: string, done?: () => void) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_CONTENT_BYTES) failure = new RdfLimitError();
        if (!failure) chunks.push(chunk);
        done?.();
      },
      end(done?: () => void) {
        done?.();
      },
    },
    { format: "text/turtle" },
  );
  for (const quad of view) {
    writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph, (error?: Error) => {
      if (error) failure = error;
    });
    if (failure) throw failure;
  }
  writer.end((error) => {
    if (error) failure = error;
  });
  if (failure) throw failure;
  return chunks.join("");
}
