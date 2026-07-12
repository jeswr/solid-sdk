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
import type { MemorySearchQuery } from "@jeswr/solid-memory";
import { MemoryStore } from "@jeswr/solid-memory/store";
/**
 * How to build the adapter's {@link MemoryStore}: either inject a ready store, or
 * pass the container + an authenticated fetch and let the adapter construct it.
 */
export type SolidMemoryStoreInput = {
    /** A ready, configured `MemoryStore` (the adapter uses it as-is). */
    memoryStore: MemoryStore;
} | {
    /** Absolute http(s) container URL the memories live under. */
    container: string;
    /** The injected, already-authenticated pod `fetch`. */
    fetch: typeof globalThis.fetch;
};
/** Provenance + behaviour options shared by both construction shapes. */
export interface SolidMemoryAdapterCommonOptions {
    /**
     * The producing agent's WebID — `prov:wasAttributedTo` on every stored memory.
     * Must be an absolute http(s) IRI to be written (`@jeswr/solid-memory` drops a
     * non-http(s) value). When omitted, memories carry no attribution.
     */
    agentWebId?: string;
    /**
     * A default `prov:wasGeneratedBy` conversation IRI applied to a `store` that
     * does not supply its own `generatedBy`. Must be an absolute http(s) IRI to be
     * written.
     */
    defaultGeneratedBy?: string;
}
/** Full options for {@link SolidMemoryAdapter}. */
export type SolidMemoryAdapterOptions = SolidMemoryStoreInput & SolidMemoryAdapterCommonOptions;
/** Per-memory provenance + tagging supplied to {@link SolidMemoryAdapter.store}. */
export interface StoreOptions {
    /**
     * The OpenClaw `agent_id` (informational identity context). Recorded in the
     * returned result for the caller, but it is NOT the canonical PROV attribution
     * — a tool-call `agent_id` is free text, not necessarily an http(s) WebID, so
     * the canonical `prov:wasAttributedTo` is the CONFIGURED {@link
     * SolidMemoryAdapterCommonOptions.agentWebId}.
     */
    agentId?: string;
    /**
     * The generating conversation IRI (`prov:wasGeneratedBy`). Overrides the
     * adapter's {@link SolidMemoryAdapterCommonOptions.defaultGeneratedBy}.
     */
    generatedBy?: string;
    /** Free-text tags (`schema:keywords`, string literals, kept verbatim). */
    keywords?: string[];
    /** Category/topic class IRIs (`schema:about`). Non-http(s) entries are dropped. */
    categories?: string[];
}
/**
 * A memory as the adapter surfaces it — the stable pod URL as `id` (so {@link
 * SolidMemoryAdapter.forget}/{@link SolidMemoryAdapter.get} can address it), the
 * body as `memory`, and the rest of the model as `metadata`.
 *
 * **No `score`.** There is NO server-side relevance ranking available to a
 * client-side adapter (recall is deterministic substring/tag filtering), so a
 * relevance score is deliberately OMITTED rather than fabricated.
 */
export interface MemoryRecord {
    /** The stable pod resource URL — pass it to `get`/`forget`. */
    id: string;
    /** The memory body (`schema:text`). */
    memory: string;
    /** The remaining model fields. */
    metadata: MemoryMetadata;
}
/** The non-body model fields surfaced on a {@link MemoryRecord}. */
export interface MemoryMetadata {
    created?: Date;
    modified?: Date;
    keywords?: string[];
    categories?: string[];
    /** The single subject/topic IRI (`dct:subject`). */
    about?: string;
    /** The producing agent's WebID (`prov:wasAttributedTo`). */
    attributedTo?: string;
    /** The generating conversation IRI (`prov:wasGeneratedBy`). */
    generatedBy?: string;
}
/** The result of a successful {@link SolidMemoryAdapter.store}. */
export interface StoreResult {
    /** The minted pod resource URL of the new memory. */
    id: string;
    /** The stored body. */
    memory: string;
    /** The `agent_id` the caller supplied (echoed back), if any. */
    agentId?: string;
}
/**
 * A typed failure raised by the adapter for a caller-attributable rejection — e.g.
 * an out-of-container `id` the scope guard refused, or a malformed `id`. Carries a
 * stable {@link ForgetError.code} so a caller can branch without string-matching.
 */
export declare class AdapterScopeError extends Error {
    /** A stable machine code. */
    readonly code: "out-of-scope";
    /** The offending id. */
    readonly id: string;
    constructor(id: string, cause: unknown);
}
/**
 * The shape returned by {@link SolidMemoryAdapter.forget} — a typed result rather
 * than a throw, so a caller (and the OpenClaw tool wrapper) can report a clean
 * failure. A scope-guard rejection is `{ ok: false, code: "out-of-scope" }`; an
 * unexpected error is re-thrown (it is not a caller-attributable, expected case).
 */
export type ForgetResult = {
    ok: true;
    id: string;
} | {
    ok: false;
    id: string;
    code: "out-of-scope";
    message: string;
};
/**
 * The pure adapter. Construct it with a ready `MemoryStore` (or a container +
 * fetch) and optional provenance defaults; call `store` / `recall` / `search` /
 * `get` / `forget` / `list`.
 */
export declare class SolidMemoryAdapter {
    /** The underlying `@jeswr/solid-memory` store — the single RDF + network surface. */
    private readonly memoryStore;
    private readonly agentWebId?;
    private readonly defaultGeneratedBy?;
    constructor(options: SolidMemoryAdapterOptions);
    /** The container the adapter (its store) owns. */
    get container(): string;
    /**
     * Store a new memory in the pod. Threads PROV-O: `attributedTo` is the
     * CONFIGURED {@link agentWebId}; `generatedBy` is the supplied conversation IRI,
     * falling back to {@link defaultGeneratedBy}. Returns the minted pod URL as `id`.
     */
    store(content: string, opts?: StoreOptions): Promise<StoreResult>;
    /**
     * Recall memories by a free-text query (case-insensitive substring over the
     * memory body), capped to `limit` (when given). Each result carries its stable
     * pod URL as `id`.
     */
    recall(query: string, limit?: number): Promise<MemoryRecord[]>;
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
    search(query: MemorySearchQuery, limit?: number): Promise<MemoryRecord[]>;
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
    get(id: string): Promise<MemoryRecord | null>;
    /**
     * List every memory under the container (each with its `id`). Malformed / hostile
     * / non-memory members are skipped (see {@link allResilient}). Never throws for a
     * bad member.
     */
    list(): Promise<MemoryRecord[]>;
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
    private allResilient;
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
    forget(id: string, opts?: {
        ifMatch?: string;
    }): Promise<ForgetResult>;
}
//# sourceMappingURL=core.d.ts.map