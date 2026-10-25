import type { PodFetch } from "../config.js";
/** An owner confirmation, content-locked to a specific proposal body. */
export interface Confirmation {
    /** The proposal id this confirmation authorizes. */
    readonly proposalId: string;
    /** The `sha256:<hex>` content digest the approval is bound to. */
    readonly contentDigest: string;
    /** When the owner confirmed (ISO-8601). */
    readonly confirmedAt: string;
}
/** The in-pod resource URL for a confirmation of a proposal id. */
export declare function confirmationUrl(container: string, proposalId: string): string | undefined;
/** Serialise a confirmation to Turtle. Throws (fail-closed) on an unsafe id/digest. */
export declare function serializeConfirmation(confirmation: Confirmation, resourceUrl: string): Promise<string>;
/** Parse a confirmation from a store, fail-closed (`undefined` unless well-formed). */
export declare function parseConfirmation(store: import("@rdfjs/types").DatasetCore): Confirmation | undefined;
/** Write an owner confirmation (ACL-first, overwrite — a re-confirm updates the digest). */
export declare function writeConfirmation(fetchFn: PodFetch, container: string, ownerWebId: string, confirmation: Confirmation): Promise<string>;
/** Read the confirmation for a proposal id (or `undefined` if none / malformed). */
export declare function readConfirmation(fetchFn: PodFetch, container: string, proposalId: string): Promise<Confirmation | undefined>;
//# sourceMappingURL=confirmation-store.d.ts.map