import { Store } from "n3";
/**
 * Parse an RDF body (string OR a fetch Response body stream) into a real n3
 * {@link Store}. A stream body is materialised to text first (the published
 * `parseRdf` accepts a string only). The parsed dataset's quads are copied into a
 * fresh n3 Store so the caller gets the full Store API regardless of fetch-rdf's
 * declared `DatasetCore` return.
 */
export declare function parseToStore(body: string | ReadableStream<Uint8Array>, contentTypeHeader: string | null, options?: {
    baseIRI?: string;
}): Promise<Store>;
