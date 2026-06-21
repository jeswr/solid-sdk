/**
 * `MemoryStore` — a Solid-pod CRUD store for `mem:MemoryItem` resources under a
 * single container, with conditional writes and a fail-closed scope guard.
 *
 * **Injectable authenticated fetch.** The store does NO crypto / DPoP itself — the
 * caller injects an already-authenticated `fetch` (e.g. from
 * `@solid/reactive-authentication` or a client-credentials DPoP fetch). This keeps
 * the store a pure LDP client (zero PSS-core risk, like `@jeswr/solid-task-model`).
 *
 * **Scope guard on every op.** Every target URL is asserted to lie under
 * `container` (see {@link ./scope.ts}) before any request — defence in depth, so a
 * caller-supplied or server-listed URL can never make the store touch a foreign
 * origin or escape the container sub-tree.
 *
 * **RDF discipline (house rule).** The ONLY RDF the store touches is built/parsed
 * via the model (`buildMemory`/`parseMemoryTtl`), the container listing
 * (`@jeswr/fetch-rdf` `parseRdf` + `@solid/object` `ContainerDataset`), and the
 * Type-Index registration (the typed `TermWrapper` below). NEVER hand-built triples.
 */
import { Store } from "n3";
import { type MemoryData, MemoryItem } from "./memory.js";
/** A single member of a container listing. */
export interface ContainerMember {
    /** Absolute URL of the member. */
    readonly url: string;
    /** True iff the member is itself a container (trailing slash). */
    readonly container: boolean;
}
/** Options for {@link MemoryStore} construction. */
export interface MemoryStoreOptions {
    /** Absolute container URL the store owns (normalised to one trailing slash). */
    container: string;
    /** The (authenticated) fetch the store issues every request with. */
    fetch: typeof globalThis.fetch;
}
/** A typed Solid Type-Index registration descriptor (the small, portable form). */
export interface TypeRegistration {
    /** The class the registration is `solid:forClass` (here `mem:MemoryItem`). */
    readonly forClass: string;
    /** The `solid:instanceContainer` where instances of `forClass` live. */
    readonly instanceContainer: string;
}
/**
 * A CRUD store for `mem:MemoryItem` resources under one container.
 *
 * Construct with an absolute container URL + an authenticated fetch. The
 * constructor rejects a non-http(s) container and normalises it to a single
 * trailing slash.
 */
export declare class MemoryStore {
    /** The normalised container URL (one trailing slash). */
    readonly container: string;
    private readonly fetch;
    constructor(options: MemoryStoreOptions);
    /**
     * Create a new memory under the container. Mints a fresh resource URL
     * (`${container}${uuid}`), serialises the memory, and PUTs it with
     * `If-None-Match: *` (a CONDITIONAL create — fails if the resource already
     * exists). Returns the minted URL + the response ETag (if the server sent one).
     *
     * @throws if the server rejects the write (incl. a 412 collision).
     */
    create(data: MemoryData): Promise<{
        url: string;
        etag?: string;
    }>;
    /**
     * Fetch + parse the memory at `url`. Returns `null` for a missing resource
     * (404/410) or a resource that holds no `mem:MemoryItem`.
     *
     * @throws if the target is outside the container, or on any non-ok, non-404/410
     *   response.
     */
    get(url: string): Promise<{
        data: MemoryData;
        etag?: string;
    } | null>;
    /**
     * Update the memory at `url`. Sets `dct:modified` to now in the written data,
     * serialises, and PUTs. Passes `If-Match: <etag>` when `opts.ifMatch` is given
     * (an optimistic-concurrency conditional write — fails if the resource changed
     * since that ETag).
     *
     * **STICKY-field preservation (`dct:created`, `prov:invalidatedAtTime`) — `created`
     * best-effort, the tombstone FAIL-CLOSED.** A PUT replaces the whole resource, and
     * `buildMemory` writes only the fields it is given (defaulting a missing `created` to
     * now, omitting a missing `invalidatedAt`). So when the caller omits these fields, the
     * store makes ONE read of the existing resource to carry them forward. The two fields
     * have DIFFERENT failure semantics, deliberately:
     * - **`created`** is cosmetic, so its preservation is BEST-EFFORT: if the read fails
     *   (no read permission — a write-only caller — or a network error), the PUT still
     *   proceeds and `created` defaults to now.
     * - **`invalidatedAt` (the soft-forget tombstone)** is a SAFETY property — dropping it
     *   would silently RESURRECT a forgotten memory (a right-to-be-forgotten violation), so
     *   when it is omitted its preservation is FAIL-CLOSED: if the read FAILS (throws),
     *   `update` REJECTS rather than risk a resurrection. (A clean "resource absent" 404/410
     *   is NOT a failure — there is no tombstone to drop on a non-existent resource, so the
     *   PUT proceeds.) To update in a read-restricted context, pass `invalidatedAt`
     *   explicitly (an explicit value — including `undefined` only via {@link unforget}'s
     *   path — is authoritative and skips the read for that field).
     *
     * An explicitly-supplied value always wins and is NOT overridden by the pre-read (the
     * caller is authoritative). Because an OMITTED `invalidatedAt` is sticky, a routine
     * update never resurrects a forgotten memory; there is no way through `update` to
     * *clear* a tombstone — to deliberately **un-forget**, call {@link unforget}.
     *
     * **Escape hatch for a write-only caller.** Since `invalidatedAt: undefined` is
     * indistinguishable from omitted (so it cannot mean "assert live"), a read-restricted
     * caller that KNOWS the memory is not forgotten passes `opts.assumeNotForgotten: true`
     * — an explicit, audited acknowledgement that skips the tombstone pre-read and writes
     * NO tombstone. Use it deliberately: it CAN drop a tombstone, so only when the caller
     * is certain the target is live (or genuinely intends to clear it without a read).
     *
     * @throws if the target is outside the container; on the PUT's own non-ok response
     *   (incl. a 412 precondition failure); or — the fail-closed tombstone guard — if
     *   `invalidatedAt` is omitted (and `assumeNotForgotten` is not set) and the
     *   existence/tombstone pre-read could not be completed (so the tombstone status is
     *   unknown). A failing `created`-only pre-read does NOT throw.
     */
    update(url: string, data: MemoryData, opts?: {
        ifMatch?: string;
        assumeNotForgotten?: boolean;
    }): Promise<{
        etag?: string;
    }>;
    /**
     * Delete the memory at `url`. Passes `If-Match: <etag>` when `opts.ifMatch` is
     * given (conditional delete).
     *
     * @throws if the target is outside the container, or on any non-ok response.
     */
    delete(url: string, opts?: {
        ifMatch?: string;
    }): Promise<void>;
    /**
     * **Soft-forget** the memory at `url` — the right-to-be-forgotten path WITH an
     * audit trail. Unlike {@link delete} (a hard DELETE that erases the resource),
     * `forget` KEEPS the resource and writes a `prov:invalidatedAtTime` TOMBSTONE
     * timestamp onto it, so a consumer (an agent-memory view, `openclaw-memory`) can
     * tombstone a memory rather than destroy it: the entry shows as forgotten + when,
     * and is excluded from {@link search} / `searchMemories` by default.
     *
     * Implementation: it READS the existing memory (the tombstone is written over the
     * existing data, so the rest of the fields must be carried forward) then PUTs it
     * back with `invalidatedAt` set. The read is REQUIRED — a soft-forget cannot
     * preserve data it cannot read; if you only have write access (or want true
     * erasure), use {@link delete} instead. The tombstone time is `opts.at` if given,
     * else now.
     *
     * **Idempotent.** Forgetting an already-forgotten memory keeps the ORIGINAL
     * tombstone time (it does not slide the audit timestamp forward) unless an
     * explicit `opts.at` is supplied — an explicit value always wins.
     *
     * @returns the new ETag (if the server sent one) and the tombstone time written.
     * @throws if the target is outside the container, the resource is missing / not a
     *   `mem:MemoryItem` / unreadable, or the PUT is rejected (incl. a 412).
     */
    forget(url: string, opts?: {
        ifMatch?: string;
        at?: Date;
    }): Promise<{
        etag?: string;
        invalidatedAt: Date;
    }>;
    /**
     * **Un-forget** the memory at `url` — the explicit inverse of {@link forget}: clear
     * its `prov:invalidatedAtTime` tombstone so it becomes a live, searchable memory
     * again, KEEPING the resource + every other field. Needed because `invalidatedAt` is
     * OMITTED-IS-STICKY in {@link update} (so a routine update can't accidentally
     * resurrect a memory), which also means `update` can't be used to *clear* it.
     *
     * It READS the existing memory then PUTs it back with the tombstone removed (and
     * `dct:modified` bumped). The read is REQUIRED (it preserves the rest of the data);
     * it does NOT go through `update`'s sticky preservation, so the tombstone is genuinely
     * dropped. Defaults `If-Match` to the just-read ETag for optimistic-concurrency safety.
     *
     * Idempotent: un-forgetting an already-live memory is a no-op rewrite (still bumps
     * `dct:modified`).
     *
     * @returns the new ETag (if the server sent one).
     * @throws if the target is outside the container, the resource is missing / not a
     *   `mem:MemoryItem` / unreadable, or the PUT is rejected (incl. a 412).
     */
    unforget(url: string, opts?: {
        ifMatch?: string;
    }): Promise<{
        etag?: string;
    }>;
    /**
     * List the direct `ldp:contains` members of the container. Returns an empty
     * array for a missing container (404/410). Each member is scope-guarded against
     * the container — a foreign-origin / escaping member listed by a hostile or buggy
     * server is skipped, never surfaced.
     *
     * @throws on any non-ok, non-404/410 response.
     */
    list(): Promise<ContainerMember[]>;
    /**
     * Fetch + parse every non-container member of the container that holds a
     * `mem:MemoryItem`. Non-memory members (and missing/410 members) are skipped
     * (`get` returns null for them).
     */
    all(): Promise<Array<{
        url: string;
        data: MemoryData;
        etag?: string;
    }>>;
    /**
     * Convenience: fetch all memories ({@link all}) then filter them client-side via
     * `searchMemories` (from `./search.js`). Lazily imports the pure search module so a
     * consumer that only does CRUD never pulls it in.
     */
    search(query: import("./search.js").MemorySearchQuery): Promise<MemoryData[]>;
    /**
     * The Type-Index registration descriptor for this store — the small portable
     * form a consumer links into a pod's type index so other apps/agents discover
     * where memories live. (Linking it into the profile / type-index document is the
     * consumer's concern — M2.)
     */
    typeIndexRegistration(): TypeRegistration;
    /**
     * Build a fresh n3 `Store` holding the `solid:TypeRegistration` triples
     * (`a solid:TypeRegistration; solid:forClass mem:MemoryItem; solid:instanceContainer <container>`)
     * via the typed wrapper — never hand-built. The registration subject is
     * `${container}#memory-registration`. Profile-/type-index linking is the
     * consumer's concern (M2).
     */
    buildTypeRegistration(): Store;
    /** Serialise the registration store to Turtle (n3.Writer with the model prefixes). */
    serializeTypeRegistration(): Promise<string>;
    /** Serialise a memory at `url` to Turtle, guarding the URL against the container. */
    private serialize;
}
export { type MemoryData, MemoryItem };
//# sourceMappingURL=store.d.ts.map