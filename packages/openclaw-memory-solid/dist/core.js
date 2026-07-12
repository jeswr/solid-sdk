// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `SolidMemoryAdapter` — the PURE, OpenClaw-runtime-independent core.
 *
 * Maps the small set of agent-memory operations (store / recall / search / get /
 * forget / list) onto a `@jeswr/solid-memory` {@link MemoryStore}, so an agent's
 * memory lives in the USER'S Solid pod — owner-owned, portable, and readable +
 * searchable by every other agent that speaks the `mem:MemoryItem` model.
 *
 * **No OpenClaw symbol is imported here.** This module depends ONLY on
 * `@jeswr/solid-memory` (and through it, on RDF) — never on any OpenClaw runtime
 * type. The OpenClaw memory-slot plugin (see `./plugin.ts`) is a THIN wrapper
 * over this core. The OpenClaw memory-backend interface is community-driven and
 * may drift; keeping ALL pod logic here, decoupled from the runtime, means a
 * drift in OpenClaw's contract only touches the wrapper, never the audited core.
 *
 * **RDF discipline (house rule).** This adapter NEVER builds or parses a triple:
 * every read/write goes through `@jeswr/solid-memory`'s `MemoryStore` /
 * `MemoryData` typed surface, which in turn uses the suite's vetted RDF stack
 * (`@jeswr/fetch-rdf` parse, `@rdfjs/wrapper` typed accessors, `n3.Writer`).
 *
 * **Security posture.**
 * - *Fail-closed scope guard.* The `MemoryStore` is constructed with the
 *   configured container and asserts every target URL lies under it BEFORE any
 *   request — so an attacker-supplied `id` (in `get`/`forget`) can never make the
 *   adapter touch a foreign origin or escape the container. {@link forget} and
 *   {@link get} surface that rejection cleanly (a typed error / a `null`), never
 *   an unhandled crash.
 * - *PROV-O attribution (NOT anonymized).* A stored memory is attributed to the
 *   CONFIGURED agent WebID (`prov:wasAttributedTo`) and, when supplied, to the
 *   generating conversation (`prov:wasGeneratedBy`) — provenance is threaded, not
 *   stripped.
 * - *Untrusted-record drop-not-fatal.* A pod member that is not a valid
 *   `mem:MemoryItem`, or that stores a hostile (`javascript:` / `mailto:`) IRI in
 *   an object-property, is dropped by `@jeswr/solid-memory` (non-http(s) IRIs are
 *   filtered on read) — so `recall` / `list` / `get` skip it gracefully and never
 *   surface the hostile value.
 * - *No remote fetch / no SSRF surface.* The adapter introduces NO network call
 *   of its own; the only `fetch` is the injected, already-authenticated pod
 *   `fetch`. So `@jeswr/guarded-fetch` is not needed (there is no outbound URL the
 *   adapter chooses).
 * - *Owner-private by default.* The adapter does NOT set ACLs and never
 *   auto-shares. Defaulting the memory container to owner-only is the consumer's
 *   (e.g. Pod Manager's) job.
 */
import { searchMemories } from "@jeswr/solid-memory";
import { MemoryStore } from "@jeswr/solid-memory/store";
/**
 * A typed failure raised by the adapter for a caller-attributable rejection — e.g.
 * an out-of-container `id` the scope guard refused, or a malformed `id`. Carries a
 * stable {@link ForgetError.code} so a caller can branch without string-matching.
 */
export class AdapterScopeError extends Error {
    /** A stable machine code. */
    code = "out-of-scope";
    /** The offending id. */
    id;
    constructor(id, cause) {
        super(`[openclaw-memory-solid] id "${id}" is outside the configured memory container and was refused (no request issued).`);
        this.name = "AdapterScopeError";
        this.id = id;
        // Preserve the underlying scope-guard error for debugging.
        this.cause = cause;
    }
}
/**
 * The pure adapter. Construct it with a ready `MemoryStore` (or a container +
 * fetch) and optional provenance defaults; call `store` / `recall` / `search` /
 * `get` / `forget` / `list`.
 */
export class SolidMemoryAdapter {
    /** The underlying `@jeswr/solid-memory` store — the single RDF + network surface. */
    memoryStore;
    agentWebId;
    defaultGeneratedBy;
    constructor(options) {
        if ("memoryStore" in options) {
            this.memoryStore = options.memoryStore;
        }
        else {
            // `MemoryStore`'s constructor rejects a non-http(s)/non-absolute container,
            // so an invalid container fails fast here.
            this.memoryStore = new MemoryStore({ container: options.container, fetch: options.fetch });
        }
        this.agentWebId = options.agentWebId;
        this.defaultGeneratedBy = options.defaultGeneratedBy;
    }
    /** The container the adapter (its store) owns. */
    get container() {
        return this.memoryStore.container;
    }
    /**
     * Store a new memory in the pod. Threads PROV-O: `attributedTo` is the
     * CONFIGURED {@link agentWebId}; `generatedBy` is the supplied conversation IRI,
     * falling back to {@link defaultGeneratedBy}. Returns the minted pod URL as `id`.
     */
    async store(content, opts = {}) {
        if (typeof content !== "string" || content.length === 0) {
            throw new TypeError("[openclaw-memory-solid] `store` requires a non-empty string content.");
        }
        const data = {
            text: content,
            // Object-property fields: `@jeswr/solid-memory` drops any value that is not
            // an absolute http(s) IRI, so passing `undefined` or a non-IRI is safe (it
            // is simply not written). attributedTo is NEVER anonymized.
            attributedTo: this.agentWebId,
            generatedBy: opts.generatedBy ?? this.defaultGeneratedBy,
            keywords: opts.keywords,
            categories: opts.categories,
        };
        const { url } = await this.memoryStore.create(data);
        return { id: url, memory: content, agentId: opts.agentId };
    }
    /**
     * Recall memories by a free-text query (case-insensitive substring over the
     * memory body), capped to `limit` (when given). Each result carries its stable
     * pod URL as `id`.
     */
    async recall(query, limit) {
        return this.search({ text: query }, limit);
    }
    /**
     * Search memories by a full {@link MemorySearchQuery} (conjunctive AND filters),
     * capped to `limit` (when given). Each result carries its stable pod URL as `id`.
     *
     * Drives the adapter's OWN resilient member walk ({@link allResilient}) — which
     * yields `{ url, data }` pairs and DROPS a member whose body fails to parse — and
     * filters the PAIRS with the pure `searchMemories`, so the correct pod URL stays
     * attached to each returned memory (`MemoryStore.search()` alone would lose the
     * URL, and `MemoryStore.all()` aborts the whole listing on a single un-parseable
     * member — see {@link allResilient}).
     */
    async search(query, limit) {
        const pairs = await this.allResilient();
        // `searchMemories` is `items.filter(...)` (pure, preserves element refs). Build
        // it on the data array, then keep the PAIRS whose data survived — matching by
        // reference identity, which `searchMemories` guarantees. This reliably keeps
        // each memory's pod URL attached (the whole point: `id` must be addressable).
        const kept = new Set(searchMemories(pairs.map((p) => p.data), query));
        const matched = pairs.filter((p) => kept.has(p.data));
        const capped = typeof limit === "number" && limit >= 0 ? matched.slice(0, limit) : matched;
        return capped.map(({ url, data }) => toRecord(url, data));
    }
    /**
     * Fetch a single memory by its pod URL (`id`). Returns `null` for a missing
     * resource, a non-`mem:MemoryItem` resource, a body that FAILS TO PARSE
     * (drop-not-fatal — a hostile/garbage resource never crashes the caller), or —
     * when the `id` is outside the container — `null` after the scope guard refuses
     * it WITHOUT any network request (a foreign id is treated as "not found here").
     *
     * A genuine network / server error (e.g. a 5xx) is RE-THROWN — only the expected,
     * caller-attributable cases (out-of-scope id, missing/non-memory/un-parseable
     * resource) collapse to `null`.
     */
    async get(id) {
        let res;
        try {
            res = await this.memoryStore.get(id);
        }
        catch (err) {
            // The store's scope guard throws (with NO request) for an out-of-container
            // id; surface that as "not found here" rather than crashing the caller.
            if (isScopeError(err))
                return null;
            // A malformed / un-parseable body throws an RDF parse error from the store's
            // `parseMemoryTtl`; treat a hostile/garbage resource as "not a memory" (null),
            // never a crash (the drop-not-fatal contract).
            if (isParseError(err))
                return null;
            // Any other (network / server) error is genuine — re-throw it.
            throw err;
        }
        if (!res)
            return null;
        return toRecord(id, res.data);
    }
    /**
     * List every memory under the container (each with its `id`). Malformed / hostile
     * / non-memory members are skipped (see {@link allResilient}). Never throws for a
     * bad member.
     */
    async list() {
        const pairs = await this.allResilient();
        return pairs.map(({ url, data }) => toRecord(url, data));
    }
    /**
     * The drop-not-fatal bulk read: list the container's members and parse each as a
     * memory, DROPPING any member whose body fails to parse (a hostile / garbage
     * resource) or that is not a `mem:MemoryItem`.
     *
     * This deliberately does NOT delegate to `MemoryStore.all()`: that method calls
     * `get()` per member with no per-member guard, so a single un-parseable member
     * makes the whole listing throw — which would let one poisoned resource abort an
     * agent's entire `recall` / `list` (a denial-of-service / availability hole). The
     * fix lives here, in the adapter, until `@jeswr/solid-memory` itself makes `all()`
     * resilient (a tracked upstream follow-up). A genuine network / server error for
     * a member is RE-THROWN (a real outage must not be silently swallowed); only a
     * parse failure or a non-memory body is dropped.
     */
    async allResilient() {
        const members = await this.memoryStore.list();
        const out = [];
        for (const member of members) {
            if (member.container)
                continue;
            let got;
            try {
                got = await this.memoryStore.get(member.url);
            }
            catch (err) {
                // Drop a member whose body fails to parse (hostile / garbage). A scope
                // error cannot occur here (list() already scope-filtered members), but
                // guard it anyway. Re-throw a genuine network / server error.
                if (isParseError(err) || isScopeError(err))
                    continue;
                throw err;
            }
            if (got)
                out.push({ url: member.url, data: got.data });
        }
        return out;
    }
    /**
     * Forget (HARD-delete) a memory by its pod URL (`id`).
     *
     * Returns a typed {@link ForgetResult} rather than throwing for the expected,
     * caller-attributable case: an `id` outside the container is refused by the
     * scope guard WITH NO network request and reported as
     * `{ ok: false, code: "out-of-scope" }`. Any other (network / server) error is
     * re-thrown (it is not an expected, caller-attributable failure).
     *
     * NOTE: `@jeswr/solid-memory` has no tombstone (`prov:invalidatedAt`) write API,
     * so forget is a HARD `DELETE` — the resource is removed, not tombstoned. A
     * soft-delete tombstone is a `@jeswr/solid-memory` follow-up.
     */
    async forget(id, opts = {}) {
        try {
            await this.memoryStore.delete(id, opts);
            return { ok: true, id };
        }
        catch (err) {
            if (isScopeError(err)) {
                return {
                    ok: false,
                    id,
                    code: "out-of-scope",
                    message: new AdapterScopeError(id, err).message,
                };
            }
            throw err;
        }
    }
}
/** Map a `(url, MemoryData)` pair to the adapter's surfaced {@link MemoryRecord}. */
function toRecord(url, data) {
    return {
        id: url,
        memory: data.text,
        metadata: {
            created: data.created,
            modified: data.modified,
            keywords: data.keywords,
            categories: data.categories,
            about: data.about,
            // `@jeswr/solid-memory` already dropped any non-http(s) IRI on read, so a
            // hostile `javascript:`/`mailto:` attributedTo is `undefined` here — never
            // surfaced to a consumer that might render it as a link.
            attributedTo: data.attributedTo,
            generatedBy: data.generatedBy,
        },
    };
}
/**
 * Recognise `@jeswr/solid-memory`'s fail-closed scope-guard rejection. The store
 * throws with a message containing "escapes container" / "refused" BEFORE issuing
 * any request for an out-of-container / foreign-origin target. We match on that
 * stable message (the store has no typed error class). An invalid-URL throw from
 * the store ("target URL is invalid") is also a no-request, caller-attributable
 * case, so it is treated the same way.
 */
function isScopeError(err) {
    if (!(err instanceof Error))
        return false;
    return (err.message.includes("escapes container") ||
        err.message.includes("target URL is invalid") ||
        err.message.includes("refused"));
}
/**
 * Recognise an RDF PARSE failure thrown by `@jeswr/solid-memory`'s `MemoryStore.get`
 * — which calls `@jeswr/fetch-rdf`'s `parseRdf`, throwing a TYPED `RdfFetchError`
 * (`err.name === "RdfFetchError"`, message "Failed to parse …") whose `cause` is the
 * underlying N3 syntax error. A hostile / garbage resource must be DROPPED
 * (drop-not-fatal), never crash a `recall` / `list` / `get`.
 *
 * Detection is deliberately NARROW so it never swallows a genuine network / server
 * failure (which `get` / `allResilient` must re-throw):
 * - each error in the chain is matched ONLY by the typed `RdfFetchError` name (the
 *   stable contract of `@jeswr/fetch-rdf`), or a raw N3 `SyntaxError` carrying the
 *   lexer's `"…on line N"` wording — NOT a bare "Failed to parse" substring, which a
 *   server error's `statusText` could coincidentally carry;
 * - we do NOT broad-match generic words ("Unexpected" / "syntax") — a server /
 *   network error message could coincidentally contain those, and broad-matching is
 *   what would let a real outage be silently dropped.
 *
 * The chain is walked because the parse error may be WRAPPED: `MemoryStore.get`
 * surfaces the `RdfFetchError` directly today, but a caller could wrap it (its
 * `cause` being the `RdfFetchError`, whose own `cause` is the N3 error). Walking a
 * bounded `cause` chain keeps the drop robust to wrapping while staying narrow — a
 * network error has no parse-typed link anywhere in its chain.
 */
function isParseError(err) {
    const isNarrowParse = (e) => {
        if (!(e instanceof Error))
            return false;
        const name = e.name ?? "";
        const msg = e.message ?? "";
        // The typed, stable signal: @jeswr/fetch-rdf's RdfFetchError wrapper — matched
        // ONLY by the typed name. A bare `msg.includes("Failed to parse")` is NOT used:
        // MemoryStore.get folds HTTP `statusText` into non-ok error messages, so a real
        // 5xx like `503 Failed to parse upstream response` would be mis-classified as a
        // parse failure and silently dropped (roborev Medium). The cause-chain walk below
        // still catches a WRAPPED RdfFetchError by its name on the inner link.
        if (name === "RdfFetchError")
            return true;
        // The raw N3 syntax error (if surfaced directly): narrow N3-syntax wording with
        // the lexer's line-number pattern, NOT a generic substring — a network error
        // never carries it.
        if (name === "SyntaxError" && /\bon line \d+\b/.test(msg))
            return true;
        return false;
    };
    // Walk a bounded cause chain (depth cap guards a cyclic `cause`).
    let cursor = err;
    for (let depth = 0; depth < 5 && cursor instanceof Error; depth++) {
        if (isNarrowParse(cursor))
            return true;
        cursor = cursor.cause;
    }
    return false;
}
//# sourceMappingURL=core.js.map