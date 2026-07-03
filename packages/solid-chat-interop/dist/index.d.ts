/**
 * `@jeswr/solid-chat-interop` — a chat/conversation interop RECONCILER for the
 * Solid app suite.
 *
 * Maps between the suite's three chat shapes through a single canonical hub:
 *  - **ActivityStreams 2.0** — the canonical write model (exactly what
 *    `@jeswr/pod-chat` produces).
 *  - **SolidOS `meeting:LongChat`** — the installed-base read shape (`sioc:`/
 *    `foaf:`/`dct:`/`schema:`).
 *  - **external schemas** via a tiny adapter SEAM, with one concrete
 *    {@link LibreChatAdapter} as proof.
 *
 * Mints NO new chat predicate; reuses `pc:ChatRoom` (pod-chat) and the
 * `@jeswr/solid-task-model` `wf:Task` actionable overlay, so an actionable chat
 * message is the SAME task shape solid-issues / the Pod Manager read. Pure-RDF and
 * non-server-touching; untrusted IRIs are filtered http(s)-only on read AND write.
 *
 * @packageDocumentation
 */
export type { ChatAdapter } from "./adapter.js";
export { As2MessageDoc, as2MessageSubject, buildAs2Message, parseAs2Message, } from "./as2.js";
export type { CanonicalMessage, CanonicalRoom, MessageProvenance, MessageTask, TaskState, } from "./canonical.js";
export { docOf, httpIriOrUndefined, isHttpIri, safeHttpIri, safeIri, sanitizeText, } from "./iri.js";
export { LibreChatAdapter, type LibreChatAdapterOptions, type LibreChatMessage, } from "./librechat.js";
export { buildLongChatMessage, LongChatMessageDoc, longChatMessageSubject, parseLongChatMessage, } from "./longchat.js";
export { as2ToCanonical, canonicalToAs2, canonicalToLongChat, longChatToCanonical, MAPPING_TABLE, type MappingRow, parseAs2, parseLongChat, roundTripAs2ToLongChat, serializeAs2, serializeLongChat, storeToTurtle, } from "./reconcile.js";
export { AS, AS_ATTRIBUTED_TO, AS_COLLECTION, AS_CONTENT, AS_CONTEXT, AS_IN_REPLY_TO, AS_ITEMS, AS_MEDIA_TYPE, AS_NAME, AS_NOTE, AS_PERSON, AS_PUBLISHED, DCT, DCT_CREATED, DCT_CREATOR, DCT_IS_REPLACED_BY, DCT_TITLE, DEFAULT_MEDIA_TYPE, FOAF, FOAF_MAKER, MEETING, MEETING_LONG_CHAT, PC, PC_CHAT_ROOM, PREFIXES, PROV, PROV_WAS_ATTRIBUTED_TO, PROV_WAS_DERIVED_FROM, PROV_WAS_GENERATED_BY, RDF, RDF_TYPE, SCHEMA, SCHEMA_DATE_DELETED, SCHEMA_MESSAGE, SIOC, SIOC_CONTENT, SIOC_HAS_REPLY, SIOC_NOTE, TASK_CLASS, WF, WF_ASSIGNEE, WF_CLOSED, WF_OPEN, wf, XSD, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map