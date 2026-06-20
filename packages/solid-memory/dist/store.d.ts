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
     * @throws if the target is outside the container, or on any non-ok response
     *   (incl. a 412 precondition failure).
     */
    update(url: string, data: MemoryData, opts?: {
        ifMatch?: string;
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