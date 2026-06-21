/**
 * Neutralise an untrusted VALUES graph before it is inlined into shacl-form:
 * drop every `(s, rdf:type|dct:conformsTo, <http(s) IRI>)` quad — the exact
 * triples shacl-form's empty-shapes auto-import would turn into an unguarded
 * fetch. Works on the parsed n3 Store (NEVER hand-edits Turtle text) and
 * re-serialises via `n3.Writer`. Returns the cleaned Turtle.
 *
 * Non-http objects (literals, blank nodes) and all other predicates are
 * preserved verbatim, so the rendered view is unchanged except for the removal
 * of the SSRF import vectors. (A removed `rdf:type`/`conformsTo` IRI is purely a
 * shacl-form shape-discovery hint here — the view renders against the explicit
 * shapes graph, never an auto-fetched one.)
 */
export declare function neutraliseValuesTurtle(turtle: string): Promise<string>;
/**
 * Parse a resolved SHAPES Turtle string and return its quad count. The element
 * uses this to FAIL CLOSED when the count is zero: an empty loaded-shapes graph
 * is the precondition for shacl-form's auto-import path, so a zero-quad shapes
 * graph must NEVER reach a mounted <shacl-form>.
 */
export declare function countTurtleQuads(turtle: string): Promise<number>;
/**
 * A non-IRI sentinel set as `data-values-subject` so shacl-form does not
 * auto-DERIVE a values subject from the untrusted data graph (its
 * `valuesSubject ||= findConformsToValuesSubject(store)` is short-circuited by
 * any truthy value). A `urn:` subject is never an http(s) fetch target, and
 * shacl-form only fetches a `urn:` subject's imports when a `proxy` is set —
 * which this element never sets — so even the sentinel itself is fetch-inert.
 */
export declare const VALUES_SUBJECT_SENTINEL = "urn:jeswr:solid-components:shacl-view:values-subject";
/** A graph source for the view: an already-in-hand string, or a URL to pre-fetch. */
export type GraphSource = {
    readonly kind: "inline";
    readonly text: string;
    /**
     * The RDF media type of `text`. MUST be a no-network RDF type
     * (Turtle/N-Triples/N-Quads/TriG); defaults to `text/turtle`. JSON-LD /
     * RDF-XML are REJECTED (§9 fix 4) — their parser resolves a remote
     * `@context`/import through an unguarded fetch.
     */
    readonly contentType?: string;
} | {
    /**
     * A URL the APP trusts (it chose it). Fetched with the injected seam:
     * `auth` ⇒ the session-bound fetch; `public` ⇒ the credential-free fetch.
     */
    readonly kind: "trusted";
    readonly url: string;
    readonly seam: "auth" | "public";
} | {
    /**
     * A user-configured / untrusted REMOTE URL. Fetched ONLY through
     * @jeswr/guarded-fetch (https-only, SSRF-blocked, capped + timed out).
     */
    readonly kind: "remote";
    readonly url: string;
};
/**
 * The app fetches the resolver may use for a `trusted` source.
 *
 * `publicFetch` is OPTIONAL and has NO fallback: a `{ seam: "public" }` source is
 * FAIL-CLOSED — if `publicFetch` is not provided, the resolver throws rather than
 * silently using `fetch` (which is the authenticated, possibly DPoP-bound session
 * fetch). This is the credential boundary: a public/foreign read must never carry
 * the session token just because a credential-free fetch was not supplied. There
 * is deliberately no "pristine global" default here — by the time a component
 * resolves, `globalThis.fetch` may already have been patched by auth code, so it
 * cannot be trusted as credential-free; the caller must pass an explicit one.
 */
export interface FetchSeam {
    readonly fetch: typeof fetch;
    readonly publicFetch?: typeof fetch;
}
/** Options for {@link resolveGraphToTurtle}. */
export interface ResolveOptions {
    /** Abort signal threaded into whichever fetch runs. */
    readonly signal?: AbortSignal;
    /**
     * Override the guarded-fetch loader (tests inject a stub so they neither hit the
     * network nor bundle undici). Production omits it → the real dynamic import.
     */
    readonly loadGuardedFetch?: () => Promise<typeof fetch>;
    /** Max bytes for a `remote` fetch (passed to guarded-fetch). Default 2 MiB. */
    readonly maxBytes?: number;
    /** Timeout (ms) for a `remote` fetch (passed to guarded-fetch). Default 10s. */
    readonly timeoutMs?: number;
}
/**
 * Resolve a {@link GraphSource} to a Turtle STRING ready to inline into
 * shacl-form. The ONLY fetch a `remote` source can use is the guarded one; a
 * `trusted` source uses the app's own seam; an `inline` source is parsed + re-
 * serialised (to normalise + validate) but never fetched.
 *
 * @throws on a parse failure or a guard rejection (the element renders the error).
 */
export declare function resolveGraphToTurtle(source: GraphSource, seam: FetchSeam, options?: ResolveOptions): Promise<string>;
