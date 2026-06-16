import type { DatasetCore } from "@rdfjs/types";
import type { VerificationResult } from "./types.js";
/** Options for {@link verifyDescriptor}. */
export interface VerifyOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * Skip the network and verify an RDF body already in hand. When set, `input`
     * is treated as the document base IRI (not a URL to fetch) and
     * `bodyContentType` selects the parser.
     */
    readonly body?: string;
    /** Content-Type for {@link VerifyOptions.body} (default `text/turtle`). */
    readonly bodyContentType?: string;
    /** Base IRI to resolve relative IRIs when parsing a body (default `input`). */
    readonly baseIRI?: string;
    /**
     * Require the single `ad:AgentDescription` subject to equal `input` (the
     * expected agent IRI) — so a document served at URL A cannot cleanly describe a
     * different agent B (a spoofing vector). Defaults to `true` for a FETCHED
     * document and `false` for an in-hand `body`. Set explicitly to override.
     */
    readonly requireSubjectMatch?: boolean;
    /**
     * The expected agent subject IRI when verifying a `body`. ANP descriptions are
     * commonly served at the WebID/profile fragment `#ad` while the agent subject
     * is the agent IRI; supply it to enable subject-binding for an in-hand body.
     */
    readonly expectedId?: string;
}
/** Options for {@link verifyDataset}. */
export interface VerifyDatasetOptions {
    /** Require the single `ad:AgentDescription` subject to equal `expectedId`. */
    readonly requireSubjectMatch?: boolean;
}
/**
 * Verify an agent description.
 *
 * @param input - the description document URL (fetched + parsed) OR, when
 *   `options.body` is set, the base IRI for the supplied body.
 */
export declare function verifyDescriptor(input: string, options?: VerifyOptions): Promise<VerificationResult>;
/**
 * Verify an already-parsed dataset. Exposed so callers who fetched the RDF
 * themselves (e.g. inside {@link import("./discover.js").discoverAgent}) avoid a
 * second fetch.
 */
export declare function verifyDataset(dataset: DatasetCore, expectedId?: string, options?: VerifyDatasetOptions): VerificationResult;
/**
 * Classify a fetch/parse error into the right issue code. An {@link RdfFetchError}
 * carries discriminator fields: an HTTP `status` ⇒ the request reached the server
 * but it answered non-2xx (`fetch-failed`); a `contentType` WITHOUT a status ⇒ we
 * received a response but could not parse that media type (`parse-failed`); neither
 * ⇒ a transport/network failure (`fetch-failed`). A non-RdfFetchError is treated as
 * a parse failure (it surfaced from the parser, not the transport).
 */
export declare function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed";
//# sourceMappingURL=verify.d.ts.map