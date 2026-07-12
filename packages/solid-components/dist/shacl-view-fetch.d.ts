/**
 * Neutralise an untrusted VALUES graph before it is inlined into shacl-form: drop
 * every `(s, dct:conformsTo, <http(s) IRI>)` quad — the auto-import ROOT-SHAPE
 * trigger (and, when ALL conformsTo are http, the auto-DERIVATION source too).
 * Works on the parsed n3 Store (NEVER hand-edits Turtle text) and re-serialises
 * via `n3.Writer`. Returns the cleaned Turtle.
 *
 * This is a NARROW defence-in-depth layer, NOT the SSRF closer — the empty-shapes
 * fail-closed (fix 1 in shacl-view.ts) is what actually closes the auto-import
 * (its `countQuads(loaded-shapes) === 0` precondition can never hold for a mounted
 * form). See the block comment above.
 *
 * It deliberately PRESERVES `rdf:type` quads (load-bearing for shacl-form's
 * view-mode shape-selection — stripping them blanks a benign instance: the High)
 * and `dct:conformsTo` quads with a NON-http object (a legitimate `urn:` profile
 * reference shacl-form uses to derive the values subject so the instance renders).
 * Literals, blank nodes, and all other predicates are preserved verbatim, so the
 * rendered view is unchanged except for the removal of the http(s) conformsTo
 * import vector.
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
/** The outcome of {@link resolveAndHarden} — exactly one of three shapes. */
export type HardenedGraphs = {
    /** Both graphs resolved + hardened; mount shacl-form with these inline strings. */
    readonly kind: "ready";
    readonly shapesTurtle: string;
    readonly valuesTurtle: string;
} | {
    /** The shapes graph is empty (fix 1) — render the empty/error state, never mount. */
    readonly kind: "empty-shapes";
    readonly message: string;
} | {
    /** A resolve/parse/guard failure — render the error state, never mount. */
    readonly kind: "error";
    readonly message: string;
};
/** The error message used when the resolved shapes graph has zero quads (fix 1). */
export declare const EMPTY_SHAPES_MESSAGE: string;
/**
 * Resolve + §9-harden a shapes + values source pair into the inline Turtle strings
 * to hand shacl-form. The ONE place the view + the edit form share, so the edit
 * form can never drift from the view's SSRF guarantees. NEVER throws — every
 * failure is reported as a `kind` so the caller renders a fail-closed state and
 * never mounts a form on bad/empty input.
 *
 * @param shapes - the SHACL shapes source.
 * @param values - the data source to render/edit against the shapes.
 * @param seam   - the credential-boundary fetch seam (auth + optional public).
 * @param options - resolver options (maxBytes/timeout/test guarded-fetch loader).
 */
export declare function resolveAndHarden(shapes: GraphSource, values: GraphSource, seam: FetchSeam, options?: ResolveOptions): Promise<HardenedGraphs>;
