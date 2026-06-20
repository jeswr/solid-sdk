/**
 * `@jeswr/matrix-chat-to-pod` — ingest Matrix room history into a Solid pod
 * (owner-private, READ/import-only phase 1).
 *
 * The highest chat-capture multiplier in the suite's OSS-integration plan: one
 * schema reaches WhatsApp / Signal / Telegram / Slack / Discord / iMessage via
 * mautrix bridges / Beeper, because they all surface as ordinary Matrix
 * `m.room.message` events on the network-neutral Matrix Client-Server API.
 *
 * Two layers:
 *  - the PURE, fixture-tested transform {@link matrixEventToCanonical} (the value)
 *    — a Matrix event → a `@jeswr/solid-chat-interop` {@link CanonicalMessage}, with
 *    edits (`m.replace` → `dct:isReplacedBy`), redactions (→ `schema:dateDeleted`),
 *    replies (`m.in_reply_to`), and strict untrusted-input filtering; and
 *  - the thin {@link importRoom} orchestration — pages the Matrix `/messages` API
 *    through `@jeswr/guarded-fetch` (the homeserver is a user-configured remote, so
 *    every read is SSRF-guarded), transforms each event, and writes each message as
 *    an OWNER-PRIVATE SolidOS LongChat resource via an injectable authed `fetch`
 *    (readable by PM `/chat` and any LongChat reader).
 *
 * No new RDF predicate is minted, no triple is hand-built: the canonical model and
 * the LongChat serialization come from `@jeswr/solid-chat-interop`, parsing/
 * serialization from `@jeswr/fetch-rdf` + `n3.Writer`.
 *
 * @packageDocumentation
 */
export type { CanonicalMessage } from "@jeswr/solid-chat-interop";
export { buildOwnerOnlyAclTurtle, type ImportRoomOptions, type ImportRoomResult, importRoom, } from "./import.js";
export type { MatrixEvent, MatrixInReplyTo, MatrixMessageContent, MatrixMessagesResponse, MatrixRelatesTo, MatrixUnsigned, } from "./matrix.js";
export { type MatrixContext, type MatrixEventResult, type MessageResult, matrixEventToCanonical, type RedactionResult, type ReplaceResult, type SkipResult, } from "./transform.js";
//# sourceMappingURL=index.d.ts.map