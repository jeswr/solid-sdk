import type { DatasetCore } from "@rdfjs/types";
import type { VerificationResult } from "./types.js";
/** Options for {@link verifyDescriptor}. */
export interface VerifyOptions {
    /**
     * A `fetch` implementation (e.g. an authenticated Solid fetch).
     *
     * SECURITY — this fetch is the SSRF boundary when verifying by URL. In a
     * **server / Node** context the default `globalThis.fetch` is NOT SSRF-guarded;
     * when `input` is an UNTRUSTED URL, inject an SSRF-guarded fetch (e.g.
     * `@jeswr/guarded-fetch`'s node fetch, DNS-pinned). Prefer the `body` /
     * {@link verifyDataset} paths when the RDF is already in hand — they never
     * touch the network.
     */
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
//# sourceMappingURL=verify.d.ts.map