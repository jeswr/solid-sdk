// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The public RECONCILER — read either chat shape into the canonical model, write
 * the canonical model into either shape.
 *
 * The suite already speaks THREE chat shapes (AS2.0 = the canonical write model,
 * SolidOS `meeting:LongChat` = the installed-base read, and the Pod Manager's sioc
 * append-log = a LongChat subset). This module RECONCILES them through the single
 * canonical hub ({@link CanonicalMessage}) — it invents no fourth dialect and mints
 * no predicate. The mapping is documented IN CODE as {@link MAPPING_TABLE}.
 *
 * Two layers of entry point:
 *  - **dataset-level** ({@link as2ToCanonical} / {@link canonicalToAs2} /
 *    {@link longChatToCanonical} / {@link canonicalToLongChat}) — work on a parsed
 *    `DatasetCore` / an n3 `Store`, for callers that already have the RDF in memory;
 *  - **serialized-string-level** ({@link parseAs2} / {@link parseLongChat} /
 *    {@link serializeAs2} / {@link serializeLongChat}) — accept/return a Turtle or
 *    JSON-LD body, parsing via `@jeswr/fetch-rdf`'s `parseRdf` (never a bespoke
 *    parser) and serialising via `n3.Writer` (never hand-concatenated triples).
 */

import type { DatasetCore } from "@rdfjs/types";
import { type Store, Writer } from "n3";
import { type As2MessageDoc, as2MessageSubject, buildAs2Message, parseAs2Message } from "./as2.js";
import type { CanonicalMessage } from "./canonical.js";
import {
  buildLongChatMessage,
  type LongChatMessageDoc,
  longChatMessageSubject,
  parseLongChatMessage,
} from "./longchat.js";
import {
  AS_ATTRIBUTED_TO,
  AS_CONTENT,
  AS_CONTEXT,
  AS_IN_REPLY_TO,
  AS_MEDIA_TYPE,
  AS_PUBLISHED,
  DCT_CREATED,
  DCT_IS_REPLACED_BY,
  FOAF_MAKER,
  PREFIXES,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  SCHEMA_DATE_DELETED,
  SIOC_CONTENT,
  SIOC_HAS_REPLY,
  WF_ASSIGNEE,
} from "./vocab.js";

// `As2MessageDoc` / `LongChatMessageDoc` are imported as types only to keep the
// reconciler dependency-light; the doc classes themselves live in their modules.
export type { As2MessageDoc, LongChatMessageDoc };

/** One row of the canonical ↔ AS2.0 ↔ LongChat mapping. */
export interface MappingRow {
  /** The canonical {@link CanonicalMessage} field. */
  canonical: string;
  /** The AS2.0 predicate IRI (or class note), or `null` when not represented. */
  as2: string | null;
  /** The SolidOS LongChat predicate IRI (or class note), or `null` when not represented. */
  longChat: string | null;
  /** Human note on the mapping. */
  note: string;
}

/**
 * The canonical ↔ AS2.0 ↔ LongChat field mapping, as data (the documented
 * contract). Mirrors the solid-oss-integration-targets report (§3). This is the
 * single in-code source of truth for what each shape uses for each canonical field.
 */
export const MAPPING_TABLE: readonly MappingRow[] = [
  {
    canonical: "content",
    as2: AS_CONTENT,
    longChat: SIOC_CONTENT,
    note: "Message body text.",
  },
  {
    canonical: "mediaType",
    as2: AS_MEDIA_TYPE,
    longChat: null,
    note: "Body content type. AS2.0 carries it; LongChat has no per-message media type (defaults to text/plain).",
  },
  {
    canonical: "author",
    as2: AS_ATTRIBUTED_TO,
    longChat: FOAF_MAKER,
    note: "Human author WebID (an IRI; http(s)-only).",
  },
  {
    canonical: "published",
    as2: AS_PUBLISHED,
    longChat: DCT_CREATED,
    note: "Post timestamp (xsd:dateTime).",
  },
  {
    canonical: "room",
    as2: AS_CONTEXT,
    longChat: null,
    note: "The room/thread (an IRI). AS2.0 links it via as:context; LongChat models the room by the message's CONTAINER, not a triple.",
  },
  {
    canonical: "inReplyTo",
    as2: AS_IN_REPLY_TO,
    longChat: SIOC_HAS_REPLY,
    note: "Reply target (an IRI). LongChat writes BOTH as:inReplyTo and sioc:has_reply; AS2.0 uses as:inReplyTo.",
  },
  {
    canonical: "replacedBy",
    as2: DCT_IS_REPLACED_BY,
    longChat: DCT_IS_REPLACED_BY,
    note: "Edit pointer — the resource that supersedes this one (an IRI).",
  },
  {
    canonical: "deletedAt",
    as2: SCHEMA_DATE_DELETED,
    longChat: SCHEMA_DATE_DELETED,
    note: "Soft-delete tombstone timestamp.",
  },
  {
    canonical: "provenance.attributedTo",
    as2: PROV_WAS_ATTRIBUTED_TO,
    longChat: PROV_WAS_ATTRIBUTED_TO,
    note: "AI/agent attribution WebID (an IRI). Same PROV-O term in both shapes.",
  },
  {
    canonical: "provenance.generatedBy",
    as2: PROV_WAS_GENERATED_BY,
    longChat: PROV_WAS_GENERATED_BY,
    note: "Model/endpoint IRI that generated the message.",
  },
  {
    canonical: "provenance.derivedFrom",
    as2: PROV_WAS_DERIVED_FROM,
    longChat: PROV_WAS_DERIVED_FROM,
    note: "Source IRI the message was derived/imported from.",
  },
  {
    canonical: "task",
    as2: "rdf:type wf:Task + wf:Open/wf:Closed (+ dct:title)",
    longChat: "rdf:type wf:Task + wf:Open/wf:Closed (+ dct:title)",
    note: "The actionable overlay — the SAME @jeswr/solid-task-model wf:Task shape on the message subject, carried through unchanged.",
  },
  {
    canonical: "task.assignee",
    as2: WF_ASSIGNEE,
    longChat: WF_ASSIGNEE,
    note: "The task's assignee WebID (an IRI), part of the wf:Task overlay.",
  },
];

// --- Dataset-level entry points ---------------------------------------------

/**
 * Read an AS2.0 message subject from a parsed dataset into the canonical model.
 *
 * @param dataset - the parsed RDF.
 * @param subject - the message subject IRI (default: the conventional `#it` of
 *   `resourceUrl` when supplied, else required). Pass `subject` directly when the
 *   foreign document uses a non-`#it` subject.
 */
export function as2ToCanonical(
  dataset: DatasetCore,
  subject: string,
): CanonicalMessage | undefined {
  return parseAs2Message(subject, dataset);
}

/** Write the canonical model to an AS2.0 message `Store` rooted at `subject`. */
export function canonicalToAs2(msg: CanonicalMessage, subject: string): Store {
  return buildAs2Message(subject, msg);
}

/** Read a SolidOS LongChat message subject from a parsed dataset into the canonical model. */
export function longChatToCanonical(
  dataset: DatasetCore,
  subject: string,
): CanonicalMessage | undefined {
  return parseLongChatMessage(subject, dataset);
}

/** Write the canonical model to a SolidOS LongChat message `Store` rooted at `subject`. */
export function canonicalToLongChat(msg: CanonicalMessage, subject: string): Store {
  return buildLongChatMessage(subject, msg);
}

// --- Serialised-string-level entry points -----------------------------------

/** Serialise an n3 `Store` to Turtle via `n3.Writer` with the reconciler's prefixes. */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ format: "text/turtle", prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Parse a serialized RDF body (Turtle / JSON-LD / …) and read an AS2.0 message
 * from it into the canonical model. Dispatches on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted parser — never a bespoke
 * one).
 *
 * @param baseIri     - the resource URL; the base IRI for relative refs and the
 *   document the `#it` subject is resolved against.
 * @param body        - the raw serialized body.
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, the
 *   Solid Protocol §5.2 default).
 * @param subject     - the message subject IRI; defaults to `${baseIri}#it`.
 */
export async function parseAs2(
  baseIri: string,
  body: string,
  contentType: string | null = "text/turtle",
  subject: string = as2MessageSubject(baseIri),
): Promise<CanonicalMessage | undefined> {
  const dataset = await parseToDataset(baseIri, body, contentType);
  return parseAs2Message(subject, dataset);
}

/**
 * Parse a serialized RDF body and read a SolidOS LongChat message from it into the
 * canonical model. Same `parseRdf` dispatch as {@link parseAs2}.
 *
 * @param subject - the message subject IRI; defaults to `${baseIri}#it`.
 */
export async function parseLongChat(
  baseIri: string,
  body: string,
  contentType: string | null = "text/turtle",
  subject: string = longChatMessageSubject(baseIri),
): Promise<CanonicalMessage | undefined> {
  const dataset = await parseToDataset(baseIri, body, contentType);
  return parseLongChatMessage(subject, dataset);
}

/** Serialise the canonical model as an AS2.0 Turtle document rooted at `subject`. */
export function serializeAs2(msg: CanonicalMessage, subject: string): Promise<string> {
  return storeToTurtle(buildAs2Message(subject, msg));
}

/** Serialise the canonical model as a SolidOS LongChat Turtle document rooted at `subject`. */
export function serializeLongChat(msg: CanonicalMessage, subject: string): Promise<string> {
  return storeToTurtle(buildLongChatMessage(subject, msg));
}

/**
 * Parse a serialized body into a dataset, coalescing a `null` content-type to the
 * Solid default BEFORE parsing (callers routinely pass `Response.headers.get(
 * "content-type")`, which is `null` for a header-less response). Lazy-imports
 * `@jeswr/fetch-rdf` to keep its (Node-targeted) parser out of any pure-build
 * path a consumer tree-shakes — matching how the suite apps import it.
 */
async function parseToDataset(
  baseIri: string,
  body: string,
  contentType: string | null,
): Promise<DatasetCore> {
  const resolvedContentType = contentType ?? "text/turtle";
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  return parseRdf(body, resolvedContentType, { baseIRI: baseIri });
}

// --- Round-trip (shared-field-preservation) ---------------------------------

/**
 * Reconcile an AS2.0 canonical message THROUGH LongChat and back: build the AS2.0
 * shape, parse it to canonical, build the LongChat shape from that, and parse THAT
 * back to canonical. The returned canonical message is what survives the full
 * AS2.0 → canonical → LongChat → canonical journey — the shared fields a
 * cross-format consumer can rely on (content/author/published/inReplyTo + the
 * wf:Task overlay + provenance).
 *
 * `room`/`mediaType` do NOT survive into the LongChat hop (LongChat carries
 * neither — see {@link MAPPING_TABLE}); they are recovered from the input so the
 * result reflects the full canonical model rather than silently dropping them. Pass
 * `lossy: true` to get the strict "what LongChat itself preserves" view instead.
 */
export async function roundTripAs2ToLongChat(
  msg: CanonicalMessage,
  subject: string,
  opts: { lossy?: boolean } = {},
): Promise<CanonicalMessage> {
  const as2Turtle = await serializeAs2(msg, subject);
  const fromAs2 = await parseAs2(subject, as2Turtle, "text/turtle", subject);
  if (!fromAs2) throw new Error("round-trip: AS2.0 message did not parse back");

  const longChatTurtle = await serializeLongChat(fromAs2, subject);
  const fromLongChat = await parseLongChat(subject, longChatTurtle, "text/turtle", subject);
  if (!fromLongChat) throw new Error("round-trip: LongChat message did not parse back");

  if (opts.lossy) return fromLongChat;

  // Recover the LongChat-lossy canonical fields (room/mediaType) from the AS2.0
  // hop so the result is the full canonical model. (LongChat models room by
  // container, not a triple, and carries no media type — see MAPPING_TABLE.)
  const result: CanonicalMessage = { ...fromLongChat };
  if (fromAs2.room !== undefined) result.room = fromAs2.room;
  if (fromAs2.mediaType !== undefined) result.mediaType = fromAs2.mediaType;
  return result;
}
