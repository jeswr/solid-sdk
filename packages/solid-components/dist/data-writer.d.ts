import { Store } from "n3";
/**
 * The write seam: the OWN-ORIGIN authenticated fetch + the base the writes are
 * confined to. A write is always to the user's own pod, so there is no
 * `publicFetch` here (writing to a foreign origin with a credential-free fetch is a
 * non-feature). `fetch` defaults to `globalThis.fetch` when omitted.
 */
export interface WriteSeam {
    /** The session-bound authenticated fetch. Defaults to `globalThis.fetch`. */
    readonly fetch?: typeof fetch;
    /**
     * The base URL every write must stay within (same origin + a path prefix). When
     * set, a save/delete to a target OUTSIDE this base is REFUSED before any fetch.
     * Omit it to disable the path-prefix check (the origin/scheme checks still apply
     * relative to the target itself, and a caller without a base SHOULD constrain
     * targets another way). Strongly recommended: set it to the app's pod root /
     * working container so a buggy `src` can never write elsewhere.
     */
    readonly base?: string;
}
/** The lifecycle state a save/delete moves through (the components surface it). */
export type SaveStatus = "idle" | "saving" | "saved" | "error";
/** The result of a conditional write. */
export interface WriteResult {
    /** The resource URL written (the final URL after any redirect, else the target). */
    readonly url: string;
    /** The NEW `ETag` the server returned, when present — keep it for the next write. */
    readonly etag?: string;
}
/** Options common to the conditional writes. */
export interface ConditionalWriteOptions {
    /**
     * The `If-Match` value (the etag of the version being replaced) — the lost-update
     * guard for an UPDATE. REQUIRED to overwrite an existing resource unless
     * {@link ConditionalWriteOptions.ifNoneMatch} asserts a create.
     */
    readonly ifMatch?: string;
    /**
     * `If-None-Match: "*"` for a CREATE-ONLY write (the resource must NOT already
     * exist). Pass `"*"` (the only meaningful value) to create-if-absent. Mutually
     * exclusive with {@link ConditionalWriteOptions.ifMatch}.
     */
    readonly ifNoneMatch?: string;
    /** Abort signal threaded into the fetch. */
    readonly signal?: AbortSignal;
    /** Extra headers merged in (Content-Type + the conditional headers always win). */
    readonly headers?: Record<string, string>;
}
/** Options for {@link DataWriter.saveMerged} — the §10 merge save. */
export interface SaveMergedOptions {
    /**
     * Abort signal threaded into BOTH the pre-read and the write. A single signal so
     * an abort cancels the whole save atomically.
     */
    readonly signal?: AbortSignal;
    /**
     * Treat a 404 on the pre-read as "the resource does not exist yet" → a
     * CREATE-ONLY (`If-None-Match: "*"`) write of the mutator's output applied to an
     * EMPTY graph, instead of a merge. Default `true` (a save of a not-yet-existing
     * resource creates it). Set `false` to require the resource to pre-exist (a save
     * then fails on a missing resource).
     */
    readonly createIfAbsent?: boolean;
}
/**
 * What a {@link ShapedNodeMutator} resolves to: nothing (`undefined` — it mutated
 * the passed graph in place) OR a fresh Store to write instead (a pure-build path).
 */
export type MutatorResult = Store | undefined;
/**
 * A mutator that applies the form's edited values to the (already-loaded) existing
 * graph through the MODEL's typed accessors. It receives the live n3 Store (the
 * existing resource graph, with every untouched triple intact) and the resource
 * URL; it must apply ONLY the shape-covered predicates of the edited subject via the
 * model's typed setters (`Task`/`Contact`/`Bookmark`), leaving all other triples
 * untouched. It MUST NOT hand-build a quad. Returning is optional (it mutates in
 * place → return `undefined`); a returned Store is used instead, for callers that
 * prefer a pure build.
 */
export type ShapedNodeMutator = (graph: Store, resourceUrl: string) => MutatorResult | Promise<MutatorResult>;
/** Thrown when a write target falls outside the configured base / scope guard. */
export declare class WriteScopeError extends Error {
    /** The offending target URL. */
    readonly url: string;
    constructor(url: string, reason: string);
}
/**
 * Thrown when a caller asks to overwrite an existing, ETag-bearing resource WITHOUT
 * a conditional (`If-Match` / `If-None-Match`). The fail-closed lost-update guard:
 * an unconditional overwrite of an existing resource is never allowed.
 */
export declare class UnconditionalOverwriteError extends Error {
    /** The resource URL the unconditional overwrite targeted. */
    readonly url: string;
    constructor(url: string);
}
/** Thrown when a conditional write is rejected by the server (412 / 409 / 428). */
export declare class WriteConflictError extends Error {
    /** The resource URL the conflicting write targeted. */
    readonly url: string;
    /** The HTTP status the server returned (412 / 409 / 428). */
    readonly status: number;
    constructor(url: string, status: number);
}
/** Thrown for any other non-2xx write failure (transport / 4xx / 5xx). */
export declare class WriteFailedError extends Error {
    /** The resource URL. */
    readonly url: string;
    /** The HTTP status, when the failure came from a response. */
    readonly status?: number;
    constructor(url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/**
 * The injectable WRITE-path controller. Construct once with a {@link WriteSeam} and
 * reuse it; it holds no per-resource state (the ETag is the caller's to keep, and
 * `saveMerged` reads it for you). Every write is scope-guarded + conditional.
 */
export declare class DataWriter {
    #private;
    constructor(seam?: WriteSeam);
    /** The base every write is confined to, or `undefined` (no path-prefix check). */
    get base(): string | undefined;
    /**
     * §10 MERGE-NOT-REPLACE save (THE correctness invariant). Loads the existing
     * resource graph (keeping its ETag), applies the form's edited values via the
     * MODEL's typed-accessor mutator onto that loaded graph (so only the shape-covered
     * predicates change — incl. dual-predicate writes — and every untouched triple is
     * preserved), then conditionally `If-Match` PUTs the merged graph.
     *
     * If the resource does not exist yet (404 on the pre-read) and
     * `createIfAbsent` (default true), the mutator is applied to an EMPTY graph and
     * the result is CREATE-ONLY written (`If-None-Match: "*"`) so a concurrent
     * creation cannot be clobbered.
     *
     * @param url     - the resource to save (scope-guarded against the base).
     * @param mutate  - applies the form delta through the model's typed setters.
     * @param options - see {@link SaveMergedOptions}.
     * @throws {@link WriteScopeError} if `url` is outside the base.
     * @throws {@link WriteConflictError} on a 412/409/428 (lost-update / exists).
     * @throws {@link WriteFailedError} on any other write failure.
     */
    saveMerged(url: string, mutate: ShapedNodeMutator, options?: SaveMergedOptions): Promise<WriteResult>;
    /**
     * Conditional PUT of a Turtle body. ENFORCES the lost-update guard: overwriting an
     * existing resource requires `ifMatch`; `ifNoneMatch: "*"` is the create-only
     * alternative. An UNCONDITIONAL PUT (neither set) is REFUSED unless
     * `allowUnconditional` is explicitly passed (used only for a brand-new resource a
     * caller has already proven absent some other way — `saveMerged` never uses it).
     *
     * @throws {@link UnconditionalOverwriteError} if neither conditional is set.
     * @throws {@link WriteScopeError} if `url` is outside the base.
     * @throws {@link WriteConflictError} / {@link WriteFailedError} on a failure.
     */
    putTurtle(url: string, turtle: string, options?: ConditionalWriteOptions & {
        allowUnconditional?: boolean;
    }): Promise<WriteResult>;
    /**
     * Conditional DELETE. Requires `ifMatch` (the lost-update guard) — an
     * unconditional delete of an existing resource is refused, mirroring the write
     * discipline. Scope-guarded.
     */
    delete(url: string, options: {
        ifMatch: string;
        signal?: AbortSignal;
    }): Promise<void>;
}
