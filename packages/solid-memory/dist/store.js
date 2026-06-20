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
     * **Best-effort `dct:created` preservation.** A PUT replaces the whole resource, and
     * `buildMemory` defaults a missing `created` to now — so when the caller omits
     * `created`, the store makes a BEST-EFFORT read of the existing resource to carry its
     * original `created` forward (rather than rewriting it to the update time). The read
     * is best-effort by design: if it fails — no read permission (a write-only caller),
     * a missing/malformed/410 resource — the PUT still proceeds, and `created` defaults
     * to now (the documented `buildMemory` behaviour). For a read-restricted context
     * where preservation MUST be guaranteed, pass `data.created` explicitly — an explicit
     * value always wins and skips the pre-read entirely (the caller is authoritative).
     *
     * @throws if the target is outside the container, or on the PUT's own non-ok
     *   response (incl. a 412 precondition failure). A failing best-effort pre-read does
     *   NOT throw — it never blocks the write.
     */
    async update(url, data, opts) {
        assertWithinBase(this.container, url);
        // Best-effort preservation of the original creation timestamp when the caller
        // doesn't supply one. NEVER block the PUT on the read: a write-only caller, or an
        // unreadable/malformed existing resource, must still be able to update.
        let created = data.created;
        if (created === undefined) {
            try {
                const existing = await this.get(url);
                created = existing?.data.created;
            }
            catch {
                // No read permission / unreadable resource — fall through; `created` will
                // default to now in buildMemory (documented). Pass `created` explicitly to
                // guarantee preservation in a read-restricted context.
            }
        }
        const withModified = { ...data, created, modified: new Date() };
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