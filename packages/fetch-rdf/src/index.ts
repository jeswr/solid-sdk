/**
 * `@jeswr/fetch-rdf` — canonical fetch + parse helpers for Solid RDF.
 *
 * Two functions, one error class. {@link parseRdf} dispatches a body
 * (string or stream) on its `Content-Type` (Turtle / N-Triples /
 * N-Quads / TriG via `n3`; JSON-LD via `jsonld-streaming-parser`),
 * streaming chunks straight into an `N3.Store`. {@link fetchRdf}
 * orchestrates an HTTP GET + parse and returns the dataset alongside
 * the response headers.
 *
 * @packageDocumentation
 */

export { parseRdf, extractMediaType, SUPPORTED_RDF_MEDIA_TYPES } from './parse.js';
export type { RdfBody } from './parse.js';
export { fetchRdf } from './fetch.js';
export { RdfFetchError } from './errors.js';
export type { RdfFetchErrorOptions } from './errors.js';
export type { ParseRdfOptions, FetchRdfOptions, FetchedRdf } from './types.js';
