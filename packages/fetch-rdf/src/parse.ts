/**
 * RDF parsing dispatch — body in, dataset out.
 *
 * Mirrors the {@link https://solidproject.org/TR/protocol Solid Protocol v0.11.0 §5.2}
 * "RDF documents are served as `text/turtle` or `application/ld+json`"
 * guarantee: Solid only uses Turtle and JSON-LD in the wild, so we
 * dispatch on the response `Content-Type` and call the relevant native
 * parser directly. N-Triples and N-Quads are routed through n3 too,
 * since the n3 parser handles them natively.
 *
 * This is a deliberate non-use of `rdf-parse`: that package pulls in
 * every RDF serialisation we don't need, complicates browser bundling,
 * and forces a `Readable.from` shim on string bodies. The dispatch
 * pattern below is the same one documented in the master-repo
 * `solid-pod-data-access` skill.
 *
 * @packageDocumentation
 */

import contentType from 'content-type';
import datasetFactory from '@rdfjs/dataset';
import { Parser as N3Parser } from 'n3';
import { JsonLdParser } from 'jsonld-streaming-parser';
import type { DatasetCore, Quad } from '@rdfjs/types';
import { RdfFetchError } from './errors.js';
import type { ParseRdfOptions } from './types.js';

/** Media types this dispatch helper recognises. Anything else triggers
 * an {@link RdfFetchError} rather than a silent best-effort parse. */
export const SUPPORTED_RDF_MEDIA_TYPES = [
  'text/turtle',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
  'application/ld+json',
] as const;

/** The set of media types routed to the n3 parser. */
const N3_FAMILY = new Set<string>([
  'text/turtle',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
]);

/** The set of media types routed to the JSON-LD streaming parser. */
const JSON_LD_FAMILY = new Set<string>([
  'application/ld+json',
]);

/**
 * Parse a Turtle / N-Triples / N-Quads / TriG / JSON-LD body into a
 * fresh in-memory `DatasetCore`.
 *
 * @param body - The raw response body as a string.
 * @param contentTypeHeader - The raw `Content-Type` response header
 *   value. `null` is treated as `text/turtle` (the Solid Protocol §5.2
 *   default).
 * @param options - Optional. `baseIRI` is used to resolve relative
 *   references in the body — in practice the resource URL itself.
 * @throws {@link RdfFetchError} if the media type isn't one of
 *   {@link SUPPORTED_RDF_MEDIA_TYPES}, if the Content-Type header is
 *   malformed, or if the underlying parser throws.
 */
export async function parseRdf(
  body: string,
  contentTypeHeader: string | null,
  options: ParseRdfOptions = {},
): Promise<DatasetCore> {
  const rawHeader = contentTypeHeader ?? 'text/turtle';
  let mediaType: string;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(
      `Invalid Content-Type header: "${rawHeader}".`,
      { cause, contentType: rawHeader },
    );
  }

  const baseIRI = options.baseIRI;

  if (N3_FAMILY.has(mediaType)) {
    let quads: Quad[];
    try {
      // n3's Parser accepts an optional `format` so it can switch into
      // line-mode / quads-mode based on the media type. Passing the raw
      // header keeps the parser's own dispatch in charge.
      quads = new N3Parser({ format: mediaType, ...(baseIRI !== undefined && { baseIRI }) }).parse(body);
    } catch (cause) {
      throw new RdfFetchError(
        `Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ''}.`,
        { cause, contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
      );
    }
    return datasetFactory.dataset(quads);
  }

  if (JSON_LD_FAMILY.has(mediaType)) {
    let quads: Quad[];
    try {
      quads = await parseJsonLd(body, baseIRI);
    } catch (cause) {
      throw new RdfFetchError(
        `Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ''}.`,
        { cause, contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
      );
    }
    return datasetFactory.dataset(quads);
  }

  throw new RdfFetchError(
    `Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(', ')}.`,
    { contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
  );
}

/**
 * Parse a media-type header string and return its `type` (no
 * parameters) lowercased. Returns `null` if the header is missing or
 * malformed — useful for `Accept-Patch` probing.
 */
export function extractMediaType(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return contentType.parse(headerValue).type;
  } catch {
    return null;
  }
}

/** Internal: stream a JSON-LD body through `JsonLdParser` and collect
 * the emitted quads. Uses `parser.write(body); parser.end()` rather
 * than piping a Node stream so we don't depend on `Readable.from` shims
 * in browsers.
 *
 * Note: we deliberately do NOT pass `dataFactory: N3DataFactory` —
 * recent n3 versions (≥2.x) tightened the `literal()` argument
 * validation in a way that crashes on the `null` second argument
 * jsonld-streaming-parser passes for plain literals. Letting
 * `JsonLdParser` use its own default factory (`@rdfjs/data-model`)
 * sidesteps the incompatibility; the resulting quads are still RDF/JS
 * `Quad`s which `@rdfjs/dataset` accepts. */
function parseJsonLd(body: string, baseIRI?: string): Promise<Quad[]> {
  return new Promise<Quad[]>((resolve, reject) => {
    const parser = new JsonLdParser({
      ...(baseIRI !== undefined && { baseIRI }),
    });
    const collected: Quad[] = [];
    parser.on('data', (quad: Quad) => {
      collected.push(quad);
    });
    parser.on('error', reject);
    parser.on('end', () => {
      resolve(collected);
    });
    parser.write(body);
    parser.end();
  });
}
