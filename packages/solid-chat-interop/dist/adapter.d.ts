/**
 * The external-adapter SEAM — the not-siloed contract.
 *
 * An external chat schema (LibreChat, Matrix, granary, …) becomes interoperable
 * by mapping ITS message/room shape to the canonical model ONCE, behind this tiny
 * interface. The reconciler then turns the canonical result into AS2.0 (canonical
 * write) or SolidOS LongChat (installed-base) with no per-schema code.
 *
 * Keeping the boundary this small is the whole design: every new chat source is a
 * `ChatAdapter` implementation, never a new RDF dialect. An adapter is responsible
 * for projecting AWAY its private fields (so nothing source-internal leaks into the
 * canonical model) and for honest attribution — an AI/bot message must map to
 * {@link MessageProvenance}, not a faked human author.
 *
 * @typeParam E - the external message type the adapter consumes.
 * @typeParam R - the external room type the adapter consumes (defaults to `E`).
 */
import type { CanonicalMessage, CanonicalRoom } from "./canonical.js";
/**
 * Maps an external chat schema's message (and optionally room) onto the canonical
 * model. Implementations must:
 *  - copy ONLY canonical fields — never let a source-private field leak through;
 *  - apply the http(s)-only IRI guard to anything that becomes an IRI (author,
 *    room, inReplyTo, provenance members, assignee) — drop, don't coerce;
 *  - attribute AI/bot messages via {@link CanonicalMessage.provenance}, not a
 *    fabricated human `author`.
 */
export interface ChatAdapter<E, R = E> {
    /** Map one external message onto the canonical model. */
    toCanonical(externalMessage: E): CanonicalMessage;
    /** Map one external room onto the canonical model (optional). */
    toCanonicalRoom?(externalRoom: R): CanonicalRoom;
}
//# sourceMappingURL=adapter.d.ts.map