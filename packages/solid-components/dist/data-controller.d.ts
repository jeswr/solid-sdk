import type { Store } from "n3";
/**
 * The dependency-injection seam the DataController is constructed with. Every
 * field is optional except — at least one fetch must be derivable: `fetch`
 * defaults to `globalThis.fetch`, and `publicFetch` defaults to `fetch`.
 */
export interface DataSeam {
    /**
     * The session-bound authenticated fetch. Used for the user's own origin(s).
     * Defaults to `globalThis.fetch` when omitted (an unauthenticated reader).
     */
    readonly fetch?: typeof fetch;
    /**
     * The credential-free fetch for foreign-origin / public reads. There is NO
     * default and NO fallback: a `{ public: true }` read REQUIRES this to be set
     * (else it throws). It must NOT carry the session's DPoP-bound token, so the
     * controller never falls back to {@link DataSeam.fetch} nor to a possibly-patched
     * `globalThis.fetch` for a public read. Inject a fetch you captured BEFORE any
     * auth code patched the global (e.g. solid-elements' `publicFetch`).
     */
    readonly publicFetch?: typeof fetch;
}
/** Per-read options. */
export interface ReadOptions {
    /**
     * Read with the PUBLIC (credential-free) fetch instead of the authenticated
     * one. Use for foreign-origin / public resources. Default `false`.
     */
    readonly public?: boolean;
    /**
     * A previously-returned {@link ReadResult.etag}. When present it is sent as
     * `If-None-Match`; a `304 Not Modified` resolves to a {@link ReadResult} with
     * `notModified: true` and NO fresh dataset (the caller keeps its cached copy).
     */
    readonly etag?: string;
    /** Abort signal threaded into the underlying fetch. */
    readonly signal?: AbortSignal;
    /** Extra request headers merged in (the Accept header is always overridden). */
    readonly headers?: Record<string, string>;
}
/**
 * Options for {@link DataController.listContainer}. Deliberately a SUBSET of
 * {@link ReadOptions} WITHOUT `etag`: a listing always needs the graph to enumerate
 * children, so a conditional 304 (no body) would be a usability trap. For
 * conditional re-listing, call {@link DataController.read} with the container's
 * etag and re-list only when it is NOT a 304.
 */
export type ListOptions = Omit<ReadOptions, "etag">;
/** The result of a (conditional) RDF read. */
export interface ReadResult {
    /**
     * The FINAL resource URL after any redirects (`response.url`), falling back to
     * the requested URL when the fetch impl does not expose it. This is the base
     * against which the body's relative IRIs were resolved.
     */
    readonly url: string;
    /**
     * The parsed RDF graph. `undefined` ONLY when {@link ReadResult.notModified} is
     * `true` (a 304 — the caller keeps its cached dataset). Always present on 2xx.
     */
    readonly dataset?: Store;
    /** The response `ETag`, when the server sent one — pass it back as a conditional. */
    readonly etag?: string;
    /** `true` when the server answered `304 Not Modified` to a conditional GET. */
    readonly notModified: boolean;
}
/** One child of an LDP container listing. */
export interface ContainerChild {
    /** The child resource's absolute URL (the `ldp:contains` object). */
    readonly url: string;
    /** Whether the child is itself an LDP container (best-effort from the listing). */
    readonly isContainer: boolean;
}
/** The result of a container listing read. */
export interface ContainerListing {
    /** The container URL that was listed. */
    readonly url: string;
    /** The container's children (order is the parse order; de-duplicated by URL). */
    readonly children: ContainerChild[];
    /** The container resource's ETag, when present — for a conditional re-list. */
    readonly etag?: string;
    /** The full parsed container graph, for callers that need more than the listing. */
    readonly dataset: Store;
}
/**
 * The injectable read-path controller. Construct once with a {@link DataSeam} and
 * reuse it; it holds no per-resource state (the ETag is the caller's to keep).
 */
export declare class DataController {
    #private;
    constructor(seam?: DataSeam);
    /** The authenticated fetch this controller reads the user's own origin with. */
    get fetch(): typeof fetch;
    /**
     * The injected credential-free fetch for public reads, or `undefined` when none
     * was supplied (a `{ public: true }` read then fails closed).
     */
    get publicFetch(): typeof fetch | undefined;
    /**
     * Read one RDF resource into an N3 Store, classifying any failure onto the
     * 4-class taxonomy. Honours a conditional `If-None-Match` (the `etag` option):
     * a `304` resolves to `{ notModified: true }` with no dataset.
     *
     * A `{ public: true }` read REQUIRES an injected `publicFetch` (the credential
     * boundary is fail-closed) — without one it throws a {@link NetworkError} rather
     * than risk using the authenticated fetch.
     *
     * @throws {@link DataControllerError} — exactly one of NotFound / AccessDenied /
     *   Network / DataFormat. Never throws a raw `Response` or fetch error.
     */
    read(url: string, options?: ReadOptions): Promise<ReadResult>;
    /**
     * List an LDP container: read its RDF then collect every `ldp:contains` child.
     * Each child's `isContainer` is derived from an `rdf:type` of `ldp:Container` /
     * `ldp:BasicContainer` IF that triple is present in the container's own graph
     * (CSS/ESS commonly include it), else from a trailing-slash heuristic.
     *
     * @throws {@link DataControllerError} as {@link DataController.read} does.
     */
    listContainer(url: string, options?: ListOptions): Promise<ContainerListing>;
}
