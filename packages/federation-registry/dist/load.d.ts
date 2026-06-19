import type { DatasetCore } from "@rdfjs/types";
import type { RegistryIssue } from "./types.js";
/** The subset of the fetch-backed options the loader needs. */
export interface LoadOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /** Parse a body already in hand instead of fetching. */
    readonly body?: string;
    /** Content-Type for {@link LoadOptions.body} (default `text/turtle`). */
    readonly bodyContentType?: string;
    /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
    readonly baseIRI?: string;
}
/** A loaded dataset, or the single issue describing why it could not be loaded. */
export type LoadResult = {
    dataset: DatasetCore;
} | {
    issue: RegistryIssue;
};
/**
 * Load an RDF dataset from `input`: parse `options.body` if present (a PARSE
 * operation, no network), else fetch `input` (a FETCH operation). On failure
 * returns a single `{ issue }` whose code distinguishes a transport `fetch-failed`
 * from a `parse-failed` (see {@link classifyFetchError}); `noun` names the document
 * in the human-readable message (e.g. "registry document" / "storage description").
 */
export declare function loadDataset(input: string, options: LoadOptions, noun: string): Promise<LoadResult>;
/**
 * Render an error from the load path into a human-readable message. An
 * {@link RdfFetchError} with a `status` is an HTTP failure; without one it is a
 * parse-of-response failure. `noun` names the document (e.g. "registry document").
 */
export declare function describeError(err: unknown, noun: string): string;
//# sourceMappingURL=load.d.ts.map