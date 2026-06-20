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
import { type Store } from "n3";
import { type As2MessageDoc } from "./as2.js";
import type { CanonicalMessage } from "./canonical.js";
import { type LongChatMessageDoc } from "./longchat.js";
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
export declare const MAPPING_TABLE: readonly MappingRow[];
/**
 * Read an AS2.0 message subject from a parsed dataset into the canonical model.
 *
 * @param dataset - the parsed RDF.
 * @param subject - the message subject IRI (default: the conventional `#it` of
 *   `resourceUrl` when supplied, else required). Pass `subject` directly when the
 *   foreign document uses a non-`#it` subject.
 */
export declare function as2ToCanonical(dataset: DatasetCore, subject: string): CanonicalMessage | undefined;
/** Write the canonical model to an AS2.0 message `Store` rooted at `subject`. */
export declare function canonicalToAs2(msg: CanonicalMessage, subject: string): Store;
/** Read a SolidOS LongChat message subject from a parsed dataset into the canonical model. */
export declare function longChatToCanonical(dataset: DatasetCore, subject: string): CanonicalMessage | undefined;
/** Write the canonical model to a SolidOS LongChat message `Store` rooted at `subject`. */
export declare function canonicalToLongChat(msg: CanonicalMessage, subject: string): Store;
/** Serialise an n3 `Store` to Turtle via `n3.Writer` with the reconciler's prefixes. */
export declare function storeToTurtle(store: Store): Promise<string>;
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
export declare function parseAs2(baseIri: string, body: string, contentType?: string | null, subject?: string): Promise<CanonicalMessage | undefined>;
/**
 * Parse a serialized RDF body and read a SolidOS LongChat message from it into the
 * canonical model. Same `parseRdf` dispatch as {@link parseAs2}.
 *
 * @param subject - the message subject IRI; defaults to `${baseIri}#it`.
 */
export declare function parseLongChat(baseIri: string, body: string, contentType?: string | null, subject?: string): Promise<CanonicalMessage | undefined>;
/** Serialise the canonical model as an AS2.0 Turtle document rooted at `subject`. */
export declare function serializeAs2(msg: CanonicalMessage, subject: string): Promise<string>;
/** Serialise the canonical model as a SolidOS LongChat Turtle document rooted at `subject`. */
export declare function serializeLongChat(msg: CanonicalMessage, subject: string): Promise<string>;
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
export declare function roundTripAs2ToLongChat(msg: CanonicalMessage, subject: string, opts?: {
    lossy?: boolean;
}): Promise<CanonicalMessage>;
//# sourceMappingURL=reconcile.d.ts.map