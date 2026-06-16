/**
 * Optional ActivityStreams 2.0 (AS2 / JSON-LD) projection of the unified model.
 *
 * The suite uses Linked-Data conventions where the model is RDF. A community
 * message maps cleanly onto an `as:Note`, a thread onto an `as:Collection` of
 * notes, and a channel onto an `as:Collection` of threads. This lets a consumer
 * store/index community items as RDF (e.g. in a pod) using the standard
 * ActivityStreams vocabulary, with no bespoke vocab.
 *
 * These builders emit plain JSON-LD objects (the `@context` is the canonical AS2
 * context URL). They are dependency-free — a consumer that wants quads can parse
 * the JSON-LD with the suite's RDF libs (`@jeswr/fetch-rdf` / jsonld). We do NOT
 * pull an RDF library into this read client's runtime; the AS2 layer is opt-in.
 */
import type { CommunityChannel, CommunityMessage, CommunityThread } from "./types.js";
/** A minimal AS2 JSON-LD object. */
export interface As2Object {
    "@context": string;
    type: string;
    id?: string;
    [key: string]: unknown;
}
/** Project a {@link CommunityMessage} to an `as:Note`. */
export declare function messageToAs2(message: CommunityMessage): As2Object;
/** Project a {@link CommunityThread} to an `as:Collection` of notes. */
export declare function threadToAs2(thread: CommunityThread): As2Object;
/** Project a {@link CommunityChannel} to an `as:Collection` of threads. */
export declare function channelToAs2(channel: CommunityChannel): As2Object;
//# sourceMappingURL=activitystreams.d.ts.map