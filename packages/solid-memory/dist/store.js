// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { parseRdf } from "@jeswr/fetch-rdf";
import { NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { buildMemory, MemoryItem, parseMemoryTtl, storeToTurtle, } from "./memory.js";
import { assertWithinBase, isContainerUrl, normalizeContainer } from "./scope.js";
import { MEMORY_CLASS, PREFIXES, rdf } from "./vocab.js";
/** Solid Terms vocabulary — the Type-Index registration predicates/class. */
const SOLID = "http://www.w3.org/ns/solid/terms#";
const SOLID_TYPE_REGISTRATION = `${SOLID}TypeRegistration`;
const SOLID_FOR_CLASS = `${SOLID}forClass`;
const SOLID_INSTANCE_CONTAINER = `${SOLID}instanceContainer`;
/**
 * Typed `@rdfjs/wrapper` view of a `solid:TypeRegistration` subject — so the
 * registration triples are written through the vetted mappers, not hand-built.
 */
class TypeRegistrationDoc extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(SOLID_TYPE_REGISTRATION);
        return this;
    }
    get forClass() {
        return OptionalFrom.subjectPredicate(this, SOLID_FOR_CLASS, NamedNodeAs.string);
    }
    set forClass(value) {
        OptionalAs.object(this, SOLID_FOR_CLASS, value, NamedNodeFrom.string);
    }
    get instanceContainer() {
        return OptionalFrom.subjectPredicate(this, SOLID_INSTANCE_CONTAINER, NamedNodeAs.string);
    }
    set instanceContainer(value) {
        OptionalAs.object(this, SOLID_INSTANCE_CONTAINER, value, NamedNodeFrom.string);
    }
}
/**
 * A CRUD store for `mem:MemoryItem` resources under one container.
 *
 * Construct with an absolute container URL + an authenticated fetch. The
 * constructor rejects a non-http(s) container and normalises it to a single
 * trailing slash.
 */
export class MemoryStore {
    /** The normalised container URL (one trailing slash). */
    container;
    fetch;
    constructor(options) {
        // normalizeContainer throws on a non-http(s) / non-absolute container.
        this.container = normalizeContainer(options.container);
        this.fetch = options.fetch;
    }
    /**
     * Create a new memory under the container. Mints a fresh resource URL
     * (`${container}${uuid}`), serialises the memory, and PUTs it with
     * `If-None-Match: *` (a CONDITIONAL create — fails if the resource already
     * exists). Returns the minted URL + the response ETag (if the server sent one).
     *
     * @throws if the server rejects the write (incl. a 412 collision).
     */
    async create(data) {
        // Use the WHATWG Web Crypto global `crypto.randomUUID()` (present in Node >=20
        // and every browser) rather than `node:crypto` — so the store entry point stays
        // usable in browser Solid clients, matching its fetch-injected, pure-LDP-client
        // contract.
        const url = `${this.container}${crypto.randomUUID()}`;
        // Defence in depth: a minted URL is always under the container, but assert it.
        assertWithinBase(this.container, url);
        const body = await this.serialize(url, data);
        const res = await this.fetch(url, {
            method: "PUT",
            headers: {
                "content-type": "text/turtle",
                "if-none-match": "*",
            },
            body,
        });
        if (!res.ok) {
            throw new Error(`[solid-memory] create ${url} failed: ${res.status} ${res.statusText}`);
        }
        return { url, etag: res.headers.get("etag") ?? undefined };
    }
    /**
     * Fetch + parse the memory at `url`. Returns `null` for a missing resource
     * (404/410) or a resource that holds no `mem:MemoryItem`.
     *
     * @throws if the target is outside the container, or on any non-ok, non-404/410
     *   response.
     */
    async get(url) {
        assertWithinBase(this.container, url);
        const res = await this.fetch(url, {
            method: "GET",
            headers: { accept: "text/turtle, application/ld+json;q=0.9" },
        });
        if (res.status === 404 || res.status === 410) {
            return null;
        }
        if (!res.ok) {
            throw new Error(`[solid-memory] get ${url} failed: ${res.status} ${res.statusText}`);
        }
        const body = await res.text();
        const data = await parseMemoryTtl(url, body, res.headers.get("content-type"));
        if (!data)
            return null;
        return { data, etag: res.headers.get("etag") ?? undefined };
    }
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
    async update(url, data, opts) {
        assertWithinBase(this.container, url);
        // Preserve the STICKY fields the caller omitted from ONE read of the existing
        // resource. The caller distinguishes "preserve" (omit) from "set" (provide a value)
        // per field; an explicit value is authoritative and is never overridden by the read.
        let created = data.created;
        let invalidatedAt = data.invalidatedAt;
        // `assumeNotForgotten` is the explicit write-only escape hatch: the caller asserts
        // the target carries no tombstone, so we neither read nor preserve one (it is treated
        // as already-resolved, like an explicit invalidatedAt).
        const tombstoneResolved = invalidatedAt !== undefined || opts?.assumeNotForgotten === true;
        if (created === undefined || !tombstoneResolved) {
            let existing;
            try {
                existing = await this.get(url);
            }
            catch (cause) {
                // The read FAILED (read-denied / network error — NOT a clean 404/410, which
                // get() returns as null). `created` preservation is best-effort, but the
                // tombstone is FAIL-CLOSED: if the tombstone status is unresolved we cannot
                // confirm whether the memory is forgotten, so refuse rather than risk dropping
                // a tombstone and resurrecting a forgotten memory.
                if (!tombstoneResolved) {
                    throw new Error(`[solid-memory] update ${url} refused: could not read the existing resource to ` +
                        "preserve its prov:invalidatedAtTime tombstone (fail-closed — a routine update must " +
                        "not risk resurrecting a forgotten memory). Pass `invalidatedAt` explicitly, set " +
                        `opts.assumeNotForgotten, or use unforget()/delete().${cause instanceof Error ? ` Cause: ${cause.message}` : ""}`);
                }
                // created-only: best-effort, fall through with created defaulting to now.
                existing = null;
            }
            if (created === undefined)
                created = existing?.data.created;
            // existing is null for a clean 404/410 (no tombstone to preserve) — leaving
            // invalidatedAt undefined is correct: a non-existent resource cannot be forgotten.
            // When assumeNotForgotten is set, we intentionally do NOT carry a tombstone forward.
            if (invalidatedAt === undefined && !opts?.assumeNotForgotten) {
                invalidatedAt = existing?.data.invalidatedAt;
            }
        }
        const withModified = { ...data, created, invalidatedAt, modified: new Date() };
        const body = await this.serialize(url, withModified);
        const headers = { "content-type": "text/turtle" };
        if (opts?.ifMatch)
            headers["if-match"] = opts.ifMatch;
        const res = await this.fetch(url, { method: "PUT", headers, body });
        if (!res.ok) {
            throw new Error(`[solid-memory] update ${url} failed: ${res.status} ${res.statusText}`);
        }
        return { etag: res.headers.get("etag") ?? undefined };
    }
    /**
     * Delete the memory at `url`. Passes `If-Match: <etag>` when `opts.ifMatch` is
     * given (conditional delete).
     *
     * @throws if the target is outside the container, or on any non-ok response.
     */
    async delete(url, opts) {
        assertWithinBase(this.container, url);
        const headers = {};
        if (opts?.ifMatch)
            headers["if-match"] = opts.ifMatch;
        const res = await this.fetch(url, { method: "DELETE", headers });
        if (!res.ok) {
            throw new Error(`[solid-memory] delete ${url} failed: ${res.status} ${res.statusText}`);
        }
    }
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
    async forget(url, opts) {
        assertWithinBase(this.container, url);
        const existing = await this.get(url);
        if (!existing) {
            throw new Error(`[solid-memory] forget ${url} failed: no mem:MemoryItem to forget (missing or not a memory) — use delete() for a hard remove`);
        }
        // Idempotent: keep the original tombstone unless the caller supplies an explicit
        // `at` (which always wins). A fresh forget stamps now.
        const invalidatedAt = opts?.at ?? existing.data.invalidatedAt ?? new Date();
        // Carry every existing field forward; only set the tombstone. Pass `created`
        // explicitly so update() does NOT re-read (we already hold the data) and the
        // original creation time is preserved.
        const tombstoned = {
            ...existing.data,
            created: existing.data.created,
            invalidatedAt,
        };
        // Default the optimistic-concurrency guard to the ETag we just read, so a
        // concurrent writer between our read and PUT is detected (a stale read can't
        // silently clobber a newer version). A caller can override or omit via opts.
        const ifMatch = opts?.ifMatch ?? existing.etag;
        const res = await this.update(url, tombstoned, ifMatch ? { ifMatch } : undefined);
        return { etag: res.etag, invalidatedAt };
    }
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
    async unforget(url, opts) {
        assertWithinBase(this.container, url);
        const existing = await this.get(url);
        if (!existing) {
            throw new Error(`[solid-memory] unforget ${url} failed: no mem:MemoryItem to un-forget (missing or not a memory)`);
        }
        // Build the cleared form directly (NOT via update, whose omitted-is-sticky logic
        // would carry the tombstone forward). Preserve created + every field; drop only
        // invalidatedAt (spread then delete the key, so it is genuinely absent and
        // buildMemory writes no prov:invalidatedAtTime); bump modified.
        const cleared = { ...existing.data, modified: new Date() };
        delete cleared.invalidatedAt;
        const body = await this.serialize(url, cleared);
        const headers = { "content-type": "text/turtle" };
        const ifMatch = opts?.ifMatch ?? existing.etag;
        if (ifMatch)
            headers["if-match"] = ifMatch;
        const res = await this.fetch(url, { method: "PUT", headers, body });
        if (!res.ok) {
            throw new Error(`[solid-memory] unforget ${url} failed: ${res.status} ${res.statusText}`);
        }
        return { etag: res.headers.get("etag") ?? undefined };
    }
    /**
     * List the direct `ldp:contains` members of the container. Returns an empty
     * array for a missing container (404/410). Each member is scope-guarded against
     * the container — a foreign-origin / escaping member listed by a hostile or buggy
     * server is skipped, never surfaced.
     *
     * @throws on any non-ok, non-404/410 response.
     */
    async list() {
        const res = await this.fetch(this.container, {
            method: "GET",
            headers: { accept: "text/turtle, application/ld+json;q=0.9" },
        });
        if (res.status === 404 || res.status === 410) {
            return [];
        }
        if (!res.ok) {
            throw new Error(`[solid-memory] list ${this.container} failed: ${res.status} ${res.statusText}`);
        }
        const body = await res.text();
        // parseRdf resolves relative IRIs against the container URL (baseIRI), so
        // ldp:contains object IRIs come back absolute.
        const dataset = await parseRdf(body, res.headers.get("content-type"), {
            baseIRI: this.container,
        });
        const container = new ContainerDataset(dataset, DataFactory).container;
        if (!container) {
            // A valid but empty / non-container document — no members.
            return [];
        }
        const members = [];
        for (const resource of container.contains) {
            // resource.id may be relative; resolve against the container URL to be safe.
            const absolute = new URL(resource.id, this.container).toString();
            // Defence in depth: never surface a member that escapes the container.
            try {
                assertWithinBase(this.container, absolute);
            }
            catch {
                continue;
            }
            // Skip the container listing itself.
            if (absolute === this.container) {
                continue;
            }
            members.push({ url: absolute, container: isContainerUrl(absolute) });
        }
        return members;
    }
    /**
     * Fetch + parse every non-container member of the container that holds a
     * `mem:MemoryItem`. Non-memory members (and missing/410 members) are skipped
     * (`get` returns null for them).
     */
    async all() {
        const members = await this.list();
        const out = [];
        for (const member of members) {
            if (member.container)
                continue;
            const got = await this.get(member.url);
            if (got)
                out.push({ url: member.url, data: got.data, etag: got.etag });
        }
        return out;
    }
    /**
     * Convenience: fetch all memories ({@link all}) then filter them client-side via
     * `searchMemories` (from `./search.js`). Lazily imports the pure search module so a
     * consumer that only does CRUD never pulls it in.
     */
    async search(query) {
        const { searchMemories } = await import("./search.js");
        const items = await this.all();
        return searchMemories(items.map((i) => i.data), query);
    }
    /**
     * The Type-Index registration descriptor for this store — the small portable
     * form a consumer links into a pod's type index so other apps/agents discover
     * where memories live. (Linking it into the profile / type-index document is the
     * consumer's concern — M2.)
     */
    typeIndexRegistration() {
        return { forClass: MEMORY_CLASS, instanceContainer: this.container };
    }
    /**
     * Build a fresh n3 `Store` holding the `solid:TypeRegistration` triples
     * (`a solid:TypeRegistration; solid:forClass mem:MemoryItem; solid:instanceContainer <container>`)
     * via the typed wrapper — never hand-built. The registration subject is
     * `${container}#memory-registration`. Profile-/type-index linking is the
     * consumer's concern (M2).
     */
    buildTypeRegistration() {
        const store = new Store();
        const subject = `${this.container}#memory-registration`;
        const reg = new TypeRegistrationDoc(subject, store, DataFactory).mark();
        reg.forClass = MEMORY_CLASS;
        reg.instanceContainer = this.container;
        return store;
    }
    /** Serialise the registration store to Turtle (n3.Writer with the model prefixes). */
    serializeTypeRegistration() {
        const writer = new Writer({ prefixes: { ...PREFIXES, solid: SOLID } });
        writer.addQuads([...this.buildTypeRegistration()]);
        return new Promise((resolve, reject) => {
            writer.end((error, result) => (error ? reject(error) : resolve(result)));
        });
    }
    /** Serialise a memory at `url` to Turtle, guarding the URL against the container. */
    serialize(url, data) {
        assertWithinBase(this.container, url);
        return serializeAt(url, data);
    }
}
/** Serialise a memory document at `url` (kept separate so it is trivially testable). */
function serializeAt(url, data) {
    return storeToTurtle(buildMemory(url, data));
}
// Re-export the member-typed model symbols a store consumer commonly needs
// alongside the store, so `@jeswr/solid-memory/store` is self-sufficient.
export { MemoryItem };
//# sourceMappingURL=store.js.map