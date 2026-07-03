/**
 * The typed agent-memory model — typed read/write accessors over a single
 * `mem:MemoryItem` resource.
 *
 * **One model, many agents.** A memory written by one agent (or one memory
 * adapter — mem0 / OpenClaw / LangChain / Letta) is re-readable + searchable by
 * another, because they all agree on WHICH predicate carries WHICH field. The
 * class is `mem:MemoryItem`; the body is `schema:text`; timestamps are Dublin
 * Core; the producing agent is `prov:wasAttributedTo` (a WebID); the conversation
 * that produced it is `prov:wasGeneratedBy` (an `as:Note` / pod-chat `pc:ChatRoom`
 * — the not-siloed memory↔chat link). See {@link ./vocab.ts} for the rationale
 * (minted: `mem:MemoryItem` + `mem:embeddingRef`; everything else reused).
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store`, mirroring `@jeswr/solid-task-model`'s `Task`. Serialisation is
 * `n3.Writer`; parsing of a fetched body is `@jeswr/fetch-rdf`'s `parseRdf`.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
export { isHttpIri } from "./iri.js";
/**
 * A federated agent memory as a plain, serialisable object — the shape an app's /
 * agent's code works with. Every field except `text` is optional. Object-property
 * fields carry IRIs (a WebID, a conversation IRI, a category/topic IRI); free-text
 * fields carry string literals.
 */
export interface MemoryData {
    /** `schema:text` — the memory body. The one required field. */
    text: string;
    /** `dct:created`. */
    created?: Date;
    /** `dct:modified`. */
    modified?: Date;
    /** `schema:keywords` — free-text tags (string literals, not IRIs). */
    keywords?: string[];
    /** `schema:about` — category/topic class IRIs (a set). */
    categories?: string[];
    /** `dct:subject` — the single subject/topic IRI of the memory (distinct from categories). */
    about?: string;
    /** `prov:wasAttributedTo` — the producing agent's WebID / agent-card IRI. */
    attributedTo?: string;
    /** `prov:wasGeneratedBy` — the generating conversation (an `as:Note` / pod-chat `pc:ChatRoom` IRI). */
    generatedBy?: string;
    /** `mem:embeddingRef` — a sidecar embedding resource IRI (the M2 vector-search seam). */
    embeddingRef?: string;
    /**
     * `prov:invalidatedAtTime` — the soft-forget TOMBSTONE timestamp. When set, the
     * memory has been *forgotten* (right-to-be-forgotten with an audit trail) but is NOT
     * hard-deleted: the resource still exists, carrying the time it ceased to be valid.
     * The RDF predicate is the STANDARD PROV-O term `prov:invalidatedAtTime` (the
     * invalidation counterpart of `prov:generatedAtTime`) — reused, not minted; the
     * friendly TS field name is `invalidatedAt`. A tombstoned memory is excluded from
     * {@link searchMemories} by default (pass the search query's `includeForgotten`
     * flag to surface it). Write it with {@link MemoryStore.forget} (soft-forget)
     * rather than {@link MemoryStore.delete} (a hard DELETE).
     */
    invalidatedAt?: Date;
}
/**
 * Typed `@rdfjs/wrapper` view of a single memory subject. Each accessor reads/writes
 * through the vetted mappers — no quad is ever hand-built. Construct it on the
 * memory subject IRI (conventionally `${resourceUrl}#it`).
 */
export declare class MemoryItem extends TermWrapper {
    /** The memory subject IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `mem:MemoryItem`. Idempotent; returns `this` for chaining. */
    mark(): this;
    /** Whether this subject is a `mem:MemoryItem`. */
    get isMemory(): boolean;
    /** `schema:text` — the memory body. */
    get text(): string | undefined;
    set text(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
    get modified(): Date | undefined;
    set modified(value: Date | undefined);
    /** `dct:subject` — the single subject/topic IRI of the memory. */
    get about(): string | undefined;
    set about(value: string | undefined);
    /** `prov:wasAttributedTo` — the producing agent's WebID / agent-card IRI. */
    get attributedTo(): string | undefined;
    set attributedTo(value: string | undefined);
    /** `prov:wasGeneratedBy` — the generating conversation (an `as:Note` / pod-chat `pc:ChatRoom` IRI). */
    get generatedBy(): string | undefined;
    set generatedBy(value: string | undefined);
    /** `mem:embeddingRef` — a sidecar embedding resource IRI (the M2 vector-search seam). */
    get embeddingRef(): string | undefined;
    set embeddingRef(value: string | undefined);
    /**
     * `prov:invalidatedAtTime` — the soft-forget tombstone timestamp (right-to-be-
     * forgotten with an audit trail). A non-`undefined` value marks the memory as
     * forgotten while KEEPING the resource (a soft delete, not a hard DELETE).
     *
     * The RDF predicate is the standard PROV-O datatype property
     * `prov:invalidatedAtTime` (`http://www.w3.org/ns/prov#invalidatedAtTime`, the
     * invalidation counterpart of `prov:generatedAtTime`) — a REUSED PROV-O term, NOT
     * minted; the friendly TS field name stays `invalidatedAt`. Using the standard IRI
     * keeps the tombstone interoperable with any PROV-O-compliant client.
     */
    get invalidatedAt(): Date | undefined;
    set invalidatedAt(value: Date | undefined);
    /** Whether this subject has been soft-forgotten (carries a `prov:invalidatedAtTime`). */
    get isForgotten(): boolean;
    /** `schema:keywords` — free-text tags (live set of string literals). */
    get keywords(): Set<string>;
    /** `schema:about` — category/topic class IRIs (live set of IRIs). */
    get categories(): Set<string>;
}
/**
 * Conventional memory subject IRI for a resource: `${resourceUrl}#it`. The memory
 * subject is rooted at `#it` within its own document, mirroring the task model.
 */
export declare function memorySubject(resourceUrl: string): string;
/**
 * Parse a memory out of a dataset, or `undefined` if the subject is not a
 * `mem:MemoryItem`.
 *
 * @param resourceUrl - the resource document URL; the memory subject is
 *   `${resourceUrl}#it` (see {@link memorySubject}).
 * @param dataset     - the parsed RDF (e.g. from {@link parseMemoryTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export declare function parseMemory(resourceUrl: string, dataset: DatasetCore): MemoryData | undefined;
/**
 * Build a fresh n3 `Store` holding one memory rooted at `${resourceUrl}#it`.
 *
 * Object-property fields (`about`, `attributedTo`, `generatedBy`, `embeddingRef`,
 * and each `categories` entry) are run through `httpIriOrUndefined`: an absolute
 * http(s) IRI is written in its CANONICAL, injection-safe form (any
 * Turtle-breaking character percent-encoded) and a non-http(s) value is DROPPED
 * rather than coerced into a malformed `NamedNode` — keeping the graph
 * well-formed (pod data is untrusted input). `keywords` are free-text literals, so
 * every entry is written (no IRI filter). `created` defaults to now.
 */
export declare function buildMemory(resourceUrl: string, data: MemoryData): Store;
/**
 * Serialise a memory to Turtle (via `n3.Writer`, with the model's prefixes).
 * Builds the store with {@link buildMemory}, then writes it — never
 * hand-concatenates RDF.
 */
export declare function serializeMemory(resourceUrl: string, data: MemoryData): Promise<string>;
/** Serialise any n3 `Store` to Turtle with the model's prefixes. */
export declare function storeToTurtle(store: Store): Promise<string>;
/**
 * Parse a Turtle / JSON-LD body into a memory, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted RDF parser — never a bespoke
 * one). Returns `undefined` if the document holds no `mem:MemoryItem` at `${url}#it`.
 *
 * @param url         - the resource URL (used as the base IRI for relative refs
 *   and to locate the `#it` subject).
 * @param body        - the raw response body.
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, per
 *   the Solid Protocol §5.2 default).
 */
export declare function parseMemoryTtl(url: string, body: string, contentType?: string | null): Promise<MemoryData | undefined>;
//# sourceMappingURL=memory.d.ts.map