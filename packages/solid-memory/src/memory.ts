// AUTHORED-BY Codex GPT-5
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
 * n3 `Store`, mirroring `@jeswr/solid-task-model`'s `Task`. Serialisation uses
 * `@jeswr/rdf-serialize`; parsing uses `@jeswr/fetch-rdf`'s `parseRdf`.
 */

import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import { dct, MEM_EMBEDDING_REF, MEMORY_CLASS, PREFIXES, prov, rdf, schema } from "./vocab.js";

// `isHttpIri` lives in the shared pure-IRI core (`./iri.ts`); re-exported here so
// the `.` and `./memory` public entry points keep exporting it (matches how
// `@jeswr/solid-task-model`'s `./task` re-exports it).
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
 * Assign `target[key] = value` ONLY when `value` is defined — the "copy an
 * optional field through, omitting it when absent" pattern, named once so a plain
 * data projection reads as a flat list of field copies rather than a wall of
 * `if (x !== undefined)` branches. Typed so each call still binds a single named
 * field of `T` to a value of that field's exact type (no widening, no `any`).
 */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Typed `@rdfjs/wrapper` view of a single memory subject. Each accessor reads/writes
 * through the vetted mappers — no quad is ever hand-built. Construct it on the
 * memory subject IRI (conventionally `${resourceUrl}#it`).
 */
export class MemoryItem extends TermWrapper {
  /** The memory subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `mem:MemoryItem`. Idempotent; returns `this` for chaining. */
  mark(): this {
    this.types.add(MEMORY_CLASS);
    return this;
  }

  /** Whether this subject is a `mem:MemoryItem`. */
  get isMemory(): boolean {
    return this.types.has(MEMORY_CLASS);
  }

  /** `schema:text` — the memory body. */
  get text(): string | undefined {
    return OptionalFrom.subjectPredicate(this, schema("text"), LiteralAs.string);
  }
  set text(value: string | undefined) {
    OptionalAs.object(this, schema("text"), value, LiteralFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }

  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }

  /** `dct:subject` — the single subject/topic IRI of the memory. */
  get about(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("subject"), NamedNodeAs.string);
  }
  set about(value: string | undefined) {
    OptionalAs.object(this, dct("subject"), value, NamedNodeFrom.string);
  }

  /** `prov:wasAttributedTo` — the producing agent's WebID / agent-card IRI. */
  get attributedTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("wasAttributedTo"), NamedNodeAs.string);
  }
  set attributedTo(value: string | undefined) {
    OptionalAs.object(this, prov("wasAttributedTo"), value, NamedNodeFrom.string);
  }

  /** `prov:wasGeneratedBy` — the generating conversation (an `as:Note` / pod-chat `pc:ChatRoom` IRI). */
  get generatedBy(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("wasGeneratedBy"), NamedNodeAs.string);
  }
  set generatedBy(value: string | undefined) {
    OptionalAs.object(this, prov("wasGeneratedBy"), value, NamedNodeFrom.string);
  }

  /** `mem:embeddingRef` — a sidecar embedding resource IRI (the M2 vector-search seam). */
  get embeddingRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MEM_EMBEDDING_REF, NamedNodeAs.string);
  }
  set embeddingRef(value: string | undefined) {
    OptionalAs.object(this, MEM_EMBEDDING_REF, value, NamedNodeFrom.string);
  }

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
  get invalidatedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, prov("invalidatedAtTime"), LiteralAs.date);
  }
  set invalidatedAt(value: Date | undefined) {
    OptionalAs.object(this, prov("invalidatedAtTime"), value, LiteralFrom.dateTime);
  }

  /** Whether this subject has been soft-forgotten (carries a `prov:invalidatedAtTime`). */
  get isForgotten(): boolean {
    return this.invalidatedAt !== undefined;
  }

  /** `schema:keywords` — free-text tags (live set of string literals). */
  get keywords(): Set<string> {
    return SetFrom.subjectPredicate(this, schema("keywords"), LiteralAs.string, LiteralFrom.string);
  }

  /** `schema:about` — category/topic class IRIs (live set of IRIs). */
  get categories(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      schema("about"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/**
 * Conventional memory subject IRI for a resource: `${resourceUrl}#it`. The memory
 * subject is rooted at `#it` within its own document, mirroring the task model.
 */
export function memorySubject(resourceUrl: string): string {
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
export function parseMemory(resourceUrl: string, dataset: DatasetCore): MemoryData | undefined {
  const doc = new MemoryItem(memorySubject(resourceUrl), dataset, DataFactory);
  if (!doc.isMemory) return undefined;

  // text is the always-present field; every other field is copied through only
  // when the accessor returned a value (setIfDefined), so the result omits absent
  // fields exactly as before.
  const data: MemoryData = { text: doc.text ?? "" };
  setIfDefined(data, "created", doc.created);
  setIfDefined(data, "modified", doc.modified);
  // The soft-forget tombstone (prov:invalidatedAtTime) — a literal datetime, so no
  // IRI filtering applies; absent unless the memory was forgotten.
  setIfDefined(data, "invalidatedAt", doc.invalidatedAt);
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
  // IRIs: each is run through httpIriOrUndefined, keeping the CANONICALISED form
  // of any http(s) IRI (so a benign non-canonical value — missing trailing slash,
  // upper-case host — is not lost) and dropping only genuinely non-http(s) values
  // read from a hostile pod. keywords are free-text literals and kept verbatim.
  const keywords = [...doc.keywords];
  // Canonicalisation can collapse two DISTINCT stored terms onto one value
  // (e.g. <https://example.com> and <https://example.com/> both → the latter),
  // so dedupe with a Set AFTER canonicalising to avoid returning duplicates.
  const categories = [
    ...new Set(
      [...doc.categories]
        .map((c) => httpIriOrUndefined(c))
        .filter((c): c is string => c !== undefined),
    ),
  ];
  if (keywords.length > 0) data.keywords = keywords;
  if (categories.length > 0) data.categories = categories;
  return data;
}

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
export function buildMemory(resourceUrl: string, data: MemoryData): Store {
  const store = new Store();
  const doc = new MemoryItem(memorySubject(resourceUrl), store, DataFactory).mark();

  doc.text = data.text || undefined;
  doc.created = data.created ?? new Date();
  doc.modified = data.modified;
  // The soft-forget tombstone (prov:invalidatedAtTime). Written only when supplied —
  // a live (un-forgotten) memory carries no tombstone. Set via MemoryStore.forget.
  doc.invalidatedAt = data.invalidatedAt;

  // Drop any object-property value that is not an absolute http(s) IRI (untrusted
  // pod input) rather than coerce it into a malformed NamedNode.
  doc.about = httpIriOrUndefined(data.about);
  doc.attributedTo = httpIriOrUndefined(data.attributedTo);
  doc.generatedBy = httpIriOrUndefined(data.generatedBy);
  doc.embeddingRef = httpIriOrUndefined(data.embeddingRef);

  // Categories are IRIs — write the CANONICALISED form of each http(s) value
  // (httpIriOrUndefined percent-encodes any Turtle-breaking char, so the write is
  // injection-safe) and drop only genuinely non-http(s) values. Keywords are free
  // text — keep all.
  for (const iri of data.categories ?? []) {
    const safe = httpIriOrUndefined(iri);
    if (safe !== undefined) doc.categories.add(safe);
  }
  for (const keyword of data.keywords ?? []) doc.keywords.add(keyword);

  return store;
}

/**
 * Serialise a memory to Turtle with the model's prefixes.
 * Builds the store with {@link buildMemory}, then writes it — never
 * hand-concatenates RDF.
 */
export async function serializeMemory(resourceUrl: string, data: MemoryData): Promise<string> {
  return storeToTurtle(buildMemory(resourceUrl, data));
}

/** Serialise any n3 `Store` to Turtle with the model's prefixes. */
export function storeToTurtle(store: Store): Promise<string> {
  return serialize([...store], {
    format: "text/turtle",
    prefixes: { ...PREFIXES },
    emptyAsEmptyString: false,
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
export async function parseMemoryTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<MemoryData | undefined> {
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
