/**
 * MatrixFeedSource — reads Solid community Matrix rooms over the Client-Server API.
 *
 * Verified against the Matrix CS API spec (spec.matrix.org/latest/client-server-api)
 * and matrix.org live, 2026-06. The Solid chat is `#solid_project:matrix.org`
 * (linked from solidproject.org/community) and the bridged historical Gitter room
 * `#solid:matrix.org` (its server list includes `gitter.im`).
 *
 * Endpoints used (all under the homeserver base, e.g. https://matrix.org):
 *   - GET  /_matrix/client/v3/directory/room/{alias}     resolve #alias → room_id
 *   - GET  /_matrix/client/v3/rooms/{roomId}/messages    historical messages
 *                                                         (?dir=b&from=&limit=)
 *   - GET  /_matrix/client/v3/rooms/{roomId}/state/m.room.name/   room name
 *   - GET  /_matrix/client/v3/rooms/{roomId}/state/m.room.topic/  room topic
 *
 * Auth: a USER access token (the user logs into their Matrix/Gitter account; the
 * token is obtained out-of-band, e.g. via POST /_matrix/client/v3/login by the
 * host app, or pasted by the user). It is supplied via the credential seam and
 * sent as `Authorization: Bearer <token>` — never logged, never in a URL.
 *
 * A Matrix room maps onto ONE implicit thread in the unified model (its timeline).
 * (Matrix `m.thread` relations exist but are out of scope for this read-first
 * client; the whole room reads as a single newest-first thread.)
 *
 * Permalinks use matrix.to (the canonical Matrix permalink service):
 *   room  → https://matrix.to/#/{roomIdOrAlias}
 *   event → https://matrix.to/#/{roomId}/{eventId}
 */
import { type SafeFetchOptions } from "./safeFetch.js";
import { type CommunityChannel, type CommunityThread } from "./types.js";
export interface MatrixConfig {
    /** Homeserver base URL, e.g. https://matrix.org (https only, validated). */
    homeserverUrl: string;
    /** User access token (credential seam). Sent as `Authorization: Bearer …`. */
    accessToken: string;
}
export declare class MatrixFeedSource {
    private readonly base;
    private readonly headers;
    private readonly fetchOpts;
    constructor(config: MatrixConfig, fetchOpts?: SafeFetchOptions);
    private getJson;
    /** Resolve a room alias (e.g. `#solid_project:matrix.org`) to a room id. */
    resolveAlias(alias: string): Promise<string>;
    /**
     * Describe a room as a unified channel (name + topic + permalink). Accepts a
     * room id (`!…`) or an alias (`#…`); an alias is also used for the permalink.
     */
    getChannel(roomIdOrAlias: string): Promise<CommunityChannel>;
    private getStateName;
    private getStateTopic;
    /**
     * Read a room's recent timeline as ONE unified thread, newest-first.
     * `limit` caps events fetched (default 50). `lastSeenTs` (ms epoch, from a
     * {@link ReadMarker}) yields an `unreadCount` = messages strictly newer.
     *
     * Only `m.room.message` events with a textual body become messages; other
     * event types (state, reactions, redactions) are skipped.
     */
    getRoomThread(roomIdOrAlias: string, opts?: {
        limit?: number;
        lastSeenTs?: number;
    }): Promise<CommunityThread>;
    private toMessage;
}
//# sourceMappingURL=matrix.d.ts.map