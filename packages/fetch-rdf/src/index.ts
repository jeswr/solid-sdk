/**
 * `@jeswr/fetch-rdf` — canonical fetch + parse helpers for Solid RDF.
 *
 * Two functions, one error class. {@link parseRdf} dispatches a string
 * body on its `Content-Type` (Turtle / N-Triples / N-Quads / TriG via
 * `n3`; JSON-LD via `jsonld-streaming-parser`). {@link fetchRdf}
 * orchestrates an HTTP GET + parse, and returns the parsed dataset
 * alongside the strong-validator ETag and the raw `Response`.
 *
 * @packageDocumentation
 */

export { parseRdf, extractMediaType, SUPPORTED_RDF_MEDIA_TYPES } from './parse.js';
export { fetchRdf, DEFAULT_ACCEPT } from './fetch.js';
export { RdfFetchError } from './errors.js';
export type { RdfFetchErrorOptions } from './errors.js';
export type { ParseRdfOptions, FetchRdfOptions, FetchedRdf } from './types.js';
