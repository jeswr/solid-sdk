/**
 * `importRoom` — the (thin) orchestration that pages a Matrix room's history and
 * writes each message into a Solid pod as an owner-private SolidOS LongChat
 * resource readable by PM `/chat` and any LongChat reader.
 *
 * The VALUE of this package is the pure {@link matrixEventToCanonical} transform;
 * this module is deliberately thin: page → transform → stitch edits/redactions →
 * write. It does TWO kinds of fetch, with different trust postures:
 *
 *  - **Homeserver reads** go through `@jeswr/guarded-fetch`'s NODE pinning fetch
 *    ({@link createNodeGuardedFetch}). The Matrix homeserver URL is a
 *    USER-CONFIGURED REMOTE (a classic SSRF surface), so every homeserver request
 *    is https-only, blocks private/loopback/link-local/cloud-metadata addresses,
 *    DNS-pins to close the rebinding window, caps the response size + time, and
 *    does NOT auto-follow redirects. The Matrix access token rides ONLY on the
 *    guarded homeserver request as a `Bearer` header; it is never written to the
 *    pod, never logged, never placed in a URL.
 *  - **Pod writes** go through the caller's INJECTABLE authed `writeFetch` (a
 *    DPoP/Bearer Solid fetch). The pod is the user's own trusted origin, so it is
 *    NOT routed through the SSRF guard — the caller owns that fetch and its auth.
 *
 * Imported chat is THIRD-PARTY data landing in the user's pod, so the default ACL
 * is OWNER-ONLY (never auto-shared) — see {@link writeOwnerOnlyAcl}. Edits and
 * redactions from the source are honoured on re-sync (an edit rewrites the target
 * resource + sets `dct:isReplacedBy`; a redaction stamps `schema:dateDeleted`).
 */
import { type NodePinningOptions } from "@jeswr/guarded-fetch/node";
/** Options for {@link importRoom}. */
export interface ImportRoomOptions {
    /**
     * The Matrix homeserver base URL (e.g. `https://matrix.example.org`). A
     * user-configured remote → all reads against it are SSRF-guarded. Must be https.
     */
    readonly homeserverUrl: string;
    /**
     * The Matrix access token (a runtime secret). Sent ONLY as a `Bearer` header on
     * the guarded homeserver request. NEVER logged, persisted, or written to the pod.
     */
    readonly accessToken: string;
    /** The Matrix room id to import (`!room:server`). */
    readonly roomId: string;
    /**
     * An authenticated Solid `fetch` for the POD writes (DPoP/Bearer). Injectable so
     * the importer is unit-testable without a live server; the caller owns its auth.
     */
    readonly writeFetch: typeof globalThis.fetch;
    /**
     * The pod container the imported messages are written into (must end with `/`).
     * Each message becomes `${container}<eventid-slug>.ttl`.
     */
    readonly container: string;
    /**
     * Map a Matrix `event_id` to the in-pod resource URL it is written at. Defaults
     * to a deterministic slug under {@link container}. Override to control layout.
     */
    readonly messageUrlFor?: (eventId: string) => string;
    /** Resolve a Matrix sender to a real WebID (see {@link MatrixContext.webIdFor}). */
    readonly webIdFor?: (matrixUserId: string) => string | undefined;
    /** Page size for the Matrix `/messages` request (default 100, capped at 1000). */
    readonly pageSize?: number;
    /** Max number of pages to fetch (default 200) — a runaway-import guard. */
    readonly maxPages?: number;
    /**
     * Write a default OWNER-ONLY ACL alongside the container. Default `true`.
     * Requires {@link ownerWebId}. Set `false` if the container already has the
     * intended ACL (the importer never widens an existing ACL).
     */
    readonly writeAcl?: boolean;
    /** The owner WebID granted full control by the default ACL (required if `writeAcl`). */
    readonly ownerWebId?: string;
    /**
     * The guarded-fetch instance for homeserver reads. Injectable for tests;
     * production uses {@link createNodeGuardedFetch} with strict defaults.
     */
    readonly guardedFetch?: typeof globalThis.fetch;
    /** Extra guarded-fetch options (e.g. a body cap / timeout); merged with defaults. */
    readonly guardOptions?: NodePinningOptions;
}
/** The outcome of an {@link importRoom} run. */
export interface ImportRoomResult {
    /** Number of messages (incl. edits applied) written to the pod. */
    readonly written: number;
    /** Number of redactions (tombstones) applied. */
    readonly redacted: number;
    /** Number of events skipped (non-message / unmappable / hostile). */
    readonly skipped: number;
    /** Number of pages fetched from the homeserver. */
    readonly pages: number;
}
/**
 * Build an owner-only WAC ACL Turtle document for `container`, granting the owner
 * `acl:Read`/`acl:Write`/`acl:Control` over the container AND its descendants
 * (`acl:accessTo` + `acl:default`). Built with `n3.Writer` + typed quads — never
 * hand-concatenated triples (house rule). Exported for testing.
 */
export declare function buildOwnerOnlyAclTurtle(container: string, ownerWebId: string): Promise<string>;
/**
 * Import a Matrix room's history into a Solid pod (owner-private, READ/import-only).
 *
 * Pages `GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b` (backwards) through
 * the SSRF-guarded homeserver fetch, transforms each event with the pure
 * {@link matrixEventToCanonical}, stitches edits/redactions onto their target
 * resources, and writes each message as an owner-private LongChat resource via the
 * injectable {@link ImportRoomOptions.writeFetch}.
 *
 * Re-running is idempotent at the resource level (each event id maps to a stable
 * resource URL, so a re-sync overwrites in place and applies new edits/redactions).
 *
 * @throws if `homeserverUrl` is not https, `container` does not end with `/`,
 *   `writeAcl` is set without an `ownerWebId`, or a homeserver/pod request fails.
 */
export declare function importRoom(options: ImportRoomOptions): Promise<ImportRoomResult>;
//# sourceMappingURL=import.d.ts.map