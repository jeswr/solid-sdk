// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
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
import { htmlToText } from "./htmlText.js";
import { safeFetchJson } from "./safeFetch.js";
import { CommunityFeedError, } from "./types.js";
const CSAPI = "/_matrix/client/v3";
export class MatrixFeedSource {
    base;
    headers;
    fetchOpts;
    constructor(config, fetchOpts = {}) {
        this.base = config.homeserverUrl.replace(/\/+$/, "");
        this.fetchOpts = fetchOpts;
        this.headers = {
            Accept: "application/json",
            Authorization: `Bearer ${config.accessToken}`,
        };
    }
    async getJson(path) {
        try {
            return await safeFetchJson(`${this.base}${path}`, { method: "GET", headers: this.headers }, this.fetchOpts);
        }
        catch (err) {
            // Never include the path's query (could carry tokens elsewhere); the path
            // itself carries no secret. The injected error keeps the cause for callers.
            throw new CommunityFeedError("matrix", "Matrix CS API request failed", err);
        }
    }
    /** Resolve a room alias (e.g. `#solid_project:matrix.org`) to a room id. */
    async resolveAlias(alias) {
        if (alias.startsWith("!")) {
            return alias; // already a room id
        }
        const raw = await this.getJson(`${CSAPI}/directory/room/${encodeURIComponent(alias)}`);
        if (!raw.room_id) {
            throw new CommunityFeedError("matrix", `alias did not resolve: ${alias}`);
        }
        return raw.room_id;
    }
    /**
     * Describe a room as a unified channel (name + topic + permalink). Accepts a
     * room id (`!…`) or an alias (`#…`); an alias is also used for the permalink.
     */
    async getChannel(roomIdOrAlias) {
        const roomId = await this.resolveAlias(roomIdOrAlias);
        const name = await this.getStateName(roomId);
        const topic = await this.getStateTopic(roomId);
        const permalinkTarget = roomIdOrAlias.startsWith("#") ? roomIdOrAlias : roomId;
        const channel = {
            id: roomId,
            source: "matrix",
            name: name ?? roomIdOrAlias,
            permalink: `https://matrix.to/#/${encodeURIComponent(permalinkTarget)}`,
        };
        if (topic) {
            channel.topic = topic;
        }
        return channel;
    }
    async getStateName(roomId) {
        try {
            const raw = await this.getJson(`${CSAPI}/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`);
            return raw.name;
        }
        catch {
            return undefined; // no name state / not readable → caller falls back
        }
    }
    async getStateTopic(roomId) {
        try {
            const raw = await this.getJson(`${CSAPI}/rooms/${encodeURIComponent(roomId)}/state/m.room.topic/`);
            return raw.topic;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Read a room's recent timeline as ONE unified thread, newest-first.
     * `limit` caps events fetched (default 50). `lastSeenTs` (ms epoch, from a
     * {@link ReadMarker}) yields an `unreadCount` = messages strictly newer.
     *
     * Only `m.room.message` events with a textual body become messages; other
     * event types (state, reactions, redactions) are skipped.
     */
    async getRoomThread(roomIdOrAlias, opts) {
        const roomId = await this.resolveAlias(roomIdOrAlias);
        const limit = clampLimit(opts?.limit ?? 50);
        // dir=b walks BACKWARDS from the most recent — newest events first.
        const raw = await this.getJson(`${CSAPI}/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}`);
        const events = raw.chunk ?? [];
        const messages = events
            .filter(isTextMessage)
            .map((e) => this.toMessage(e, roomId))
            // dir=b is already newest-first, but sort defensively for determinism.
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const lastTs = events.reduce((acc, e) => Math.max(acc, e.origin_server_ts ?? 0), 0);
        const thread = {
            id: roomId,
            source: "matrix",
            title: (await this.getStateName(roomId)) ?? roomIdOrAlias,
            channelId: roomId,
            lastActivityAt: lastTs > 0 ? new Date(lastTs).toISOString() : "",
            messageCount: messages.length,
            permalink: `https://matrix.to/#/${encodeURIComponent(roomId)}`,
            messages,
        };
        if (opts?.lastSeenTs !== undefined) {
            const seen = opts.lastSeenTs;
            thread.unreadCount = events.filter((e) => isTextMessage(e) && (e.origin_server_ts ?? 0) > seen).length;
        }
        return thread;
    }
    toMessage(e, roomId) {
        const html = e.content?.format === "org.matrix.custom.html" ? e.content.formatted_body : undefined;
        const text = html ? htmlToText(html) : (e.content?.body ?? "");
        const msg = {
            id: e.event_id,
            source: "matrix",
            author: localpart(e.sender),
            authorId: e.sender,
            body: text,
            createdAt: new Date(e.origin_server_ts).toISOString(),
            permalink: `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(e.event_id)}`,
        };
        if (html) {
            msg.bodyHtml = html;
        }
        return msg;
    }
}
/** A textual room message we surface (m.room.message with a non-empty body). */
function isTextMessage(e) {
    return (e.type === "m.room.message" && typeof e.content?.body === "string" && e.content.body.length > 0);
}
/** `@alice:matrix.org` → `alice`; non-matrix-id senders pass through. */
function localpart(userId) {
    if (userId.startsWith("@")) {
        const colon = userId.indexOf(":");
        return colon > 1 ? userId.slice(1, colon) : userId.slice(1);
    }
    return userId;
}
/** Clamp the message page size to the Matrix-reasonable range [1, 100]. */
function clampLimit(n) {
    if (!Number.isFinite(n)) {
        return 50;
    }
    return Math.max(1, Math.min(100, Math.floor(n)));
}
//# sourceMappingURL=matrix.js.map