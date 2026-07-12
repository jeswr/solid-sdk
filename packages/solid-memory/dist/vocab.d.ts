/**
 * Vocabulary IRIs for the typed RDF agent-memory model.
 *
 * **Mint minimally, reuse everything.** Mirroring `@jeswr/solid-task-model` (and
 * per the suite federation discipline), this model mints exactly TWO terms — the
 * memory class and an optional embedding pointer — and reuses established,
 * dereferenceable vocabularies for every field. The aim is the same as the task
 * model's: a memory written by one agent is re-readable by another (and by the
 * memory-adapter ecosystem — mem0 / OpenClaw / LangChain / Letta — that maps TO
 * this model), so the data is portable, not siloed.
 *
 * Minted (under `mem:` — `https://w3id.org/jeswr/memory#`):
 * - **`mem:MemoryItem`** — the class every memory is stamped + Type-Index-registered
 *   with (so other apps/agents can DISCOVER where memories live in a pod).
 * - **`mem:embeddingRef`** — an OPTIONAL object-property pointing at a sidecar
 *   embedding resource. We deliberately do NOT inline vectors into the RDF: this
 *   is the M2 vector-search seam (an opaque, WAC-scoped sidecar the client embeds
 *   + searches), keeping the memory graph small and the embedding access-controllable
 *   independently.
 *
 * Reused (NOTHING else minted):
 * - **`schema:` — schema.org** (`http://schema.org/`): `schema:text` (the memory
 *   body), `schema:keywords` (free-text tags), `schema:about` (a category/topic
 *   class IRI; see the about-vs-categories note below).
 * - **`dct:` — Dublin Core Terms** (`http://purl.org/dc/terms/`): `dct:created` /
 *   `dct:modified` (timestamps), and `dct:subject` (the single `about` topic IRI;
 *   see below).
 * - **`prov:` — W3C PROV-O** (`http://www.w3.org/ns/prov#`): `prov:wasAttributedTo`
 *   (the producing agent — a WebID or `@jeswr/solid-agent-card` IRI) and
 *   `prov:wasGeneratedBy` (the conversation/activity that produced the memory —
 *   an AS2.0 `as:Note` or a pod-chat `pc:ChatRoom`; this is the not-siloed
 *   memory↔chat link).
 * - **`as:` — ActivityStreams 2.0** (`https://www.w3.org/ns/activitystreams#`) and
 *   **`pc:` — pod-chat** (`https://w3id.org/jeswr/pod-chat#`): the target classes of
 *   `prov:wasGeneratedBy`. The `pc:` IRI is the EXACT one `@jeswr/pod-chat` already
 *   defines (`pc:ChatRoom` is an `as:Collection`), so a memory generated from a
 *   pod-chat room links to a real, readable chat — verified in `pod-chat/src/vocab.ts`.
 * - **`rdf:`** (`rdf:type`) and **`solid:`** (the Type-Index registration; see
 *   `./store.ts`) and **`xsd:`** (datatypes via the wrapper mappers).
 *
 * **`about` (single topic) vs `categories` (a set) — two DISTINCT reused predicates.**
 * A memory may have ONE subject/topic IRI (`about`) and a SET of category/tag IRIs
 * (`categories`). Using `schema:about` for both would COLLIDE — a reader could not
 * tell the single topic from a category. So, deliberately:
 * - **`categories[]` → `schema:about`** (multi-valued: each category/topic IRI is a
 *   `schema:about` object), and
 * - **`about` (the single topic) → `dct:subject`** (a distinct, reusable predicate).
 * Both are established + dereferenceable, neither is minted, and because they are
 * different predicates they never collide. Free-text tags (NOT IRIs) are a third,
 * orthogonal field: `schema:keywords` string literals.
 */
/** Minted memory vocabulary — `mem:MemoryItem`, `mem:embeddingRef`. (w3id redirect is needs:user.) */
export declare const MEM = "https://w3id.org/jeswr/memory#";
/** schema.org (canonical http scheme) — `schema:text`, `schema:keywords`, `schema:about`. */
export declare const SCHEMA = "http://schema.org/";
/** Dublin Core Terms — `dct:created`, `dct:modified`, `dct:subject` (the single `about` topic). */
export declare const DCT = "http://purl.org/dc/terms/";
/** W3C PROV-O — `prov:wasAttributedTo` (agent), `prov:wasGeneratedBy` (source conversation). */
export declare const PROV = "http://www.w3.org/ns/prov#";
/** RDF — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/**
 * ActivityStreams 2.0 — `as:Note` (a conversation message), the canonical write
 * shape pod-chat + the suite chat-interop model produce. A `prov:wasGeneratedBy`
 * target. Same IRI `@jeswr/pod-chat` uses (`pod-chat/src/vocab.ts`).
 */
export declare const AS = "https://www.w3.org/ns/activitystreams#";
/**
 * pod-chat application vocabulary — `pc:ChatRoom` (an `as:Collection`), the room a
 * memory was generated in. EXACT IRI from `@jeswr/pod-chat` (verified in
 * `pod-chat/src/vocab.ts`); reused here so the memory↔chat link dereferences to a
 * real chat room rather than a bespoke namespace. (w3id redirect is needs:user.)
 */
export declare const PC = "https://w3id.org/jeswr/pod-chat#";
/** XSD datatypes (referenced via the wrapper value mappers). */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `mem:` term IRI. */
export declare const mem: (local: string) => string;
/** Build a `schema:` term IRI. */
export declare const schema: (local: string) => string;
/** Build a `dct:` term IRI. */
export declare const dct: (local: string) => string;
/** Build a `prov:` term IRI. */
export declare const prov: (local: string) => string;
/** Build an `rdf:` term IRI. */
export declare const rdf: (local: string) => string;
/** Build an `as:` term IRI. */
export declare const as: (local: string) => string;
/** Build a `pc:` term IRI. */
export declare const pc: (local: string) => string;
/** Build an `xsd:` term IRI. */
export declare const xsd: (local: string) => string;
/** The RDF class every memory is stamped + Type-Index-registered with. */
export declare const MEMORY_CLASS: string;
/** `mem:embeddingRef` — optional pointer to a sidecar embedding resource (M2 vector seam). */
export declare const MEM_EMBEDDING_REF: string;
/** The `rdf:type` predicate IRI (convenience). */
export declare const RDF_TYPE: string;
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export declare const PREFIXES: {
    readonly mem: "https://w3id.org/jeswr/memory#";
    readonly schema: "http://schema.org/";
    readonly dct: "http://purl.org/dc/terms/";
    readonly prov: "http://www.w3.org/ns/prov#";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly as: "https://www.w3.org/ns/activitystreams#";
    readonly pc: "https://w3id.org/jeswr/pod-chat#";
    readonly xsd: "http://www.w3.org/2001/XMLSchema#";
};
//# sourceMappingURL=vocab.d.ts.map