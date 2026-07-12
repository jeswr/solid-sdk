import type { DatasetCore } from "@rdfjs/types";
import type { VerificationResult } from "./types.js";
import { type AppNode } from "./wrappers.js";
/** Options for {@link verify}. */
export interface VerifyOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * Skip the network entirely and verify an RDF body already in hand. When set,
     * the `input` to `verify` is treated as the document body (not a URL) and
     * `bodyContentType` selects the parser.
     */
    readonly body?: string;
    /** Content-Type for {@link VerifyOptions.body} (default `text/turtle`). */
    readonly bodyContentType?: string;
    /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
    readonly baseIRI?: string;
    /**
     * Require the single `fedapp:App` subject to equal the fetched URL (the
     * expected client-id IRI). This binds the description to the location it was
     * served from, so a document at URL A cannot cleanly describe a different app
     * IRI B (a spoofing vector for the federation trust model).
     *
     * Defaults to `true` for a FETCHED document (the URL is a meaningful identity
     * claim) and to `false` for a `body` already in hand (the caller supplies a
     * base IRI, not an authoritative location). Set explicitly to override either.
     */
    readonly requireSubjectMatch?: boolean;
}
/**
 * Verify an app's federation registration.
 *
 * @param input - the registration document URL (fetched + parsed) OR, when
 *   `options.body` is set, the base IRI for the supplied body.
 * @returns a {@link VerificationResult}: `valid` plus the parsed
 *   {@link AppRegistration} and any {@link VerificationIssue}s.
 */
export declare function verify(input: string, options?: VerifyOptions): Promise<VerificationResult>;
/** Options for {@link verifyDataset}. */
export interface VerifyDatasetOptions {
    /**
     * Require the single `fedapp:App` subject to equal `expectedId`. When `true`,
     * a document whose App subject ≠ `expectedId` is rejected with a
     * `subject-mismatch` issue (the spoofing guard). Requires `expectedId`; if
     * `expectedId` is absent this check is skipped. Defaults to `false` so the
     * existing registry / offline `{body}` callers (where the subject legitimately
     * differs from the fetch/base IRI) keep their behaviour.
     */
    readonly requireSubjectMatch?: boolean;
}
/**
 * Verify an already-parsed dataset. Exposed so callers who fetched the RDF
 * themselves (e.g. inside {@link list}) avoid a second fetch.
 *
 * @param dataset - the parsed RDF graph.
 * @param expectedId - the document URL / expected client-id IRI. Used to scope
 *   error messages and, when `options.requireSubjectMatch` is set, to bind the
 *   `fedapp:App` subject to this IRI.
 * @param options - see {@link VerifyDatasetOptions}.
 */
export declare function verifyDataset(dataset: DatasetCore, expectedId?: string, options?: VerifyDatasetOptions): VerificationResult;
/**
 * Verify a single {@link AppNode} in isolation: project it to an
 * {@link AppRegistration} and run the per-app checks (well-formed access modes,
 * complete SectorUse blocks, non-empty, requests some access). Exposed so
 * {@link list} can verify each app of a multi-app registry document independently.
 */
export declare function verifyApp(app: AppNode): VerificationResult;
//# sourceMappingURL=verify.d.ts.map