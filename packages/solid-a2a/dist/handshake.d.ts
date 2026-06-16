import type { DatasetCore, Quad } from "@rdfjs/types";
import type { HandshakeMessage, UpgradeOffer, UpgradeResponse } from "./types.js";
/**
 * Encode an offer to UPGRADE to the RDF/SHACL protocol `protocolHash`, fetchable
 * from `protocolSource`. When `required` is `true`, the offer is for a
 * security-bearing exchange that must NOT be silently downgraded to NL (see
 * {@link UpgradeOffer.required}). Returns the structured plain object (the
 * `kind`-discriminated DataPart payload).
 */
export declare function encodeUpgradeOffer(args: {
    protocolHash: string;
    protocolSource: string;
    required?: boolean;
    protocolName?: string;
}): UpgradeOffer;
/**
 * Decode + validate a structured upgrade-offer object. Returns the typed offer,
 * or throws a `TypeError` if the input is not a well-formed offer (a decode error
 * is a programming/protocol error, distinct from an ordinary decline).
 */
export declare function decodeUpgradeOffer(input: unknown): UpgradeOffer;
/** Encode a response (accept/decline) to an offer about `protocolHash`. */
export declare function encodeUpgradeResponse(args: {
    protocolHash: string;
    accept: boolean;
    reason?: string;
}): UpgradeResponse;
/** Decode + validate a structured upgrade-response object. */
export declare function decodeUpgradeResponse(input: unknown): UpgradeResponse;
/**
 * The no-silent-downgrade decision: given an offer and the peer's response, MAY
 * the exchange fall back to natural language?
 *
 * - The response MUST be about the SAME protocol as the offer — if
 *   `response.protocolHash !== offer.protocolHash`, the response is unrelated and
 *   CANNOT authorise a downgrade; returns `false` (fail closed). This forecloses an
 *   attack where an unrelated decline is used to justify NL fallback.
 * - If the offer is `required` and the peer DECLINED, the answer is `false` — a
 *   security-bearing exchange must NOT proceed in unsigned NL; the caller refuses.
 * - If the offer is `required` and the peer ACCEPTED, NL fallback is moot (they
 *   speak RDF/SHACL) — returns `false` (do not use NL).
 * - If the offer is NOT required, NL fallback is allowed when the peer declined the
 *   matching protocol.
 *
 * This is the codec-level expression of the roadmap's cross-cutting rule; it does
 * NOT enforce signatures — it just forecloses *silent* downgrade as the default.
 */
export declare function mayDowngradeToNl(offer: UpgradeOffer, response: UpgradeResponse): boolean;
/** The RDF (quads) form of a handshake message — for an RDF-native DataPart. */
export declare function handshakeToRdf(message: HandshakeMessage): Quad[];
/** Serialise a handshake message to Turtle (default) or another n3 format. */
export declare function handshakeToTurtle(message: HandshakeMessage, format?: string): Promise<string>;
/**
 * Read a handshake message back from RDF (the round-trip). Accepts the parsed
 * quads/dataset OR a Turtle/JSON-LD string (parsed via the sanctioned
 * `@jeswr/fetch-rdf` parser). Returns the typed message, or `undefined` if the
 * graph carries no recognised handshake subject.
 */
export declare function handshakeFromRdf(input: readonly Quad[] | DatasetCore | string, contentType?: string): Promise<HandshakeMessage | undefined>;
//# sourceMappingURL=handshake.d.ts.map