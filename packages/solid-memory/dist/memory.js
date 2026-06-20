// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined, isHttpIri } from "./iri.js";
import { dct, MEM_EMBEDDING_REF, MEMORY_CLASS, PREFIXES, prov, rdf, schema } from "./vocab.js";
// `isHttpIri` lives in the shared pure-IRI core (`./iri.ts`); re-exported here so
// the `.` and `./memory` public entry points keep exporting it (matches how
// `@jeswr/solid-task-model`'s `./task` re-exports it).
export { isHttpIri } from "./iri.js";
/**
 * Assign `target[key] = value` ONLY when `value` is defined — the "copy an
 * optional field through, omitting it when absent" pattern, named once so a plain
 * data projection reads as a flat list of field copies rather than a wall of
 * `if (x !== undefined)` branches. Typed so each call still binds a single named
 * field of `T` to a value of that field's exact type (no widening, no `any`).
 */
function setIfDefined(target, key, value) {
    if (value !== undefined)
        target[key] = value;
}
/**
 * Typed `@rdfjs/wrapper` view of a single memory subject. Each accessor reads/writes
 * through the vetted mappers — no quad is ever hand-built. Construct it on the
 * memory subject IRI (conventionally `${resourceUrl}#it`).
 */
export class MemoryItem extends TermWrapper {
    /** The memory subject IRI. */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `mem:MemoryItem`. Idempotent; returns `this` for chaining. */
    mark() {
        this.types.add(MEMORY_CLASS);
        return this;
    }
    /** Whether this subject is a `mem:MemoryItem`. */
    get isMemory() {
        return this.types.has(MEMORY_CLASS);
    }
    /** `schema:text` — the memory body. */
    get text() {
        return OptionalFrom.subjectPredicate(this, schema("text"), LiteralAs.string);
    }
    set text(value) {
        OptionalAs.object(this, schema("text"), value, LiteralFrom.string);
    }
    get created() {
        return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
    }
    set created(value) {
        OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
    }
    get modified() {
        return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
    }
    set modified(value) {
        OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
    }
    /** `dct:subject` — the single subject/topic IRI of the memory. */
    get about() {
        return OptionalFrom.subjectPredicate(this, dct("subject"), NamedNodeAs.string);
    }
    set about(value) {
        OptionalAs.object(this, dct("subject"), value, NamedNodeFrom.string);
    }
    /** `prov:wasAttributedTo` — the producing agent's WebID / agent-card IRI. */
    get attributedTo() {
        return OptionalFrom.subjectPredicate(this, prov("wasAttributedTo"), NamedNodeAs.string);
    }
    set attributedTo(value) {
        OptionalAs.object(this, prov("wasAttributedTo"), value, NamedNodeFrom.string);
    }
    /** `prov:wasGeneratedBy` — the generating conversation (an `as:Note` / pod-chat `pc:ChatRoom` IRI). */
    get generatedBy() {
        return OptionalFrom.subjectPredicate(this, prov("wasGeneratedBy"), NamedNodeAs.string);
    }
    set generatedBy(value) {
        OptionalAs.object(this, prov("wasGeneratedBy"), value, NamedNodeFrom.string);
    }
    /** `mem:embeddingRef` — a sidecar embedding resource IRI (the M2 vector-search seam). */
    get embeddingRef() {
        return OptionalFrom.subjectPredicate(this, MEM_EMBEDDING_REF, NamedNodeAs.string);
    }
    set embeddingRef(value) {
        OptionalAs.object(this, MEM_EMBEDDING_REF, value, NamedNodeFrom.string);
    }
    /** `schema:keywords` — free-text tags (live set of string literals). */
    get keywords() {
        return SetFrom.subjectPredicate(this, schema("keywords"), LiteralAs.string, LiteralFrom.string);
    }
    /** `schema:about` — category/topic class IRIs (live set of IRIs). */
    get categories() {
        return SetFrom.subjectPredicate(this, schema("about"), NamedNodeAs.string, NamedNodeFrom.string);
    }
}
/**
 * Conventional memory subject IRI for a resource: `${resourceUrl}#it`. The memory
 * subject is rooted at `#it` within its own document, mirroring the task model.
 */
export function memorySubject(resourceUrl) {
    return `${resourceUrl}#it`;
}
/**
 * Parse a memory out of a dataset, or `undefined` if the subject is not a
 * `mem:MemoryItem`.
 *
 * @param resourceUrl - the resource document URL; the memory subject is
 *   `${resourceUrl}#it` (see {@link memorySubject}).
 * @param dataset     - the parsed RDF (e.g. from {@link parseMemoryTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export function parseMemory(resourceUrl, dataset) {
    const doc = new MemoryItem(memorySubject(resourceUrl), dataset, DataFactory);
    if (!doc.isMemory)
        return undefined;
    // text is the always-present field; every other field is copied through only
    // when the accessor returned a value (setIfDefined), so the result omits absent
    // fields exactly as before.
    const data = { text: doc.text ?? "" };
    setIfDefined(data, "created", doc.created);
    setIfDefined(data, "modified", doc.modified);
    // Object-property fields are filtered the SAME way on READ as on write
    // (httpIriOrUndefined): pod data is untrusted input, so a hostile resource that
    // stores a `javascript:` / `mailto:` / `urn:` IRI as a NamedNode object on
    // about/attributedTo/generatedBy/embeddingRef must not surface it to a consumer
    // (which might render it as a link). A non-http(s) value is dropped, matching
    // buildMemory's write-side filter so the read/write trust boundary is symmetric.
    setIfDefined(data, "about", httpIriOrUndefined(doc.about));
    setIfDefined(data, "attributedTo", httpIriOrUndefined(doc.attributedTo));
    setIfDefined(data, "generatedBy", httpIriOrUndefined(doc.generatedBy));
    setIfDefined(data, "embeddingRef", httpIriOrUndefined(doc.embeddingRef));
    // The two set-valued fields are omitted when empty (their absence vs an empty
    // array is observable to consumers, so this is kept explicit). Categories are
    // IRIs, so a non-http(s) category read from a hostile pod is dropped too;
    // keywords are free-text literals and are kept verbatim.
    const keywords = [...doc.keywords];
    const categories = [...doc.categories].filter(isHttpIri);
    if (keywords.length > 0)
        data.keywords = keywords;
    if (categories.length > 0)
        data.categories = categories;
    return data;
}
/**
 * Build a fresh n3 `Store` holding one memory rooted at `${resourceUrl}#it`.
 *
 * Object-property fields that are not absolute http(s) IRIs (`about`,
 * `attributedTo`, `generatedBy`, `embeddingRef`, and each `categories` entry) are
 * DROPPED rather than coerced into a malformed `NamedNode` — keeping the graph
 * well-formed (pod data is untrusted input). `keywords` are free-text literals, so
 * every entry is written (no IRI filter). `created` defaults to now.
 */
export function buildMemory(resourceUrl, data) {
    const store = new Store();
    const doc = new MemoryItem(memorySubject(resourceUrl), store, DataFactory).mark();
    doc.text = data.text || undefined;
    doc.created = data.created ?? new Date();
    doc.modified = data.modified;
    // Drop any object-property value that is not an absolute http(s) IRI (untrusted
    // pod input) rather than coerce it into a malformed NamedNode.
    doc.about = httpIriOrUndefined(data.about);
    doc.attributedTo = httpIriOrUndefined(data.attributedTo);
    doc.generatedBy = httpIriOrUndefined(data.generatedBy);
    doc.embeddingRef = httpIriOrUndefined(data.embeddingRef);
    // Categories are IRIs — drop non-http(s). Keywords are free text — keep all.
    for (const iri of data.categories ?? [])
        if (isHttpIri(iri))
            doc.categories.add(iri);
    for (const keyword of data.keywords ?? [])
        doc.keywords.add(keyword);
    return store;
}
/**
 * Serialise a memory to Turtle (via `n3.Writer`, with the model's prefixes).
 * Builds the store with {@link buildMemory}, then writes it — never
 * hand-concatenates RDF.
 */
export async function serializeMemory(resourceUrl, data) {
    return storeToTurtle(buildMemory(resourceUrl, data));
}
/** Serialise any n3 `Store` to Turtle with the model's prefixes. */
export function storeToTurtle(store) {
    const writer = new Writer({ prefixes: { ...PREFIXES } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
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
export async function parseMemoryTtl(url, body, contentType = "text/turtle") {
    // Coalesce BEFORE parsing: callers routinely pass `Response.headers.get(
    // "content-type")`, which is `null` for a header-less response. The default
    // parameter only fires for `undefined`, so an explicit `null` would otherwise
    // bypass this function's documented "⇒ text/turtle" default and lean on
    // parseRdf's own null-handling. Honour the contract here regardless.
    const resolvedContentType = contentType ?? "text/turtle";
    // Lazy import keeps the (Node-targeted) fetch-rdf dep out of any pure-parse
    // path a consumer might tree-shake — and matches how the apps import it.
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: url });
    return parseMemory(url, dataset);
}
//# sourceMappingURL=memory.js.map