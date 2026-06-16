/**
 * The UNIFIED community-feed model.
 *
 * Both sources — Matrix rooms and Discourse forum topics — normalize onto one
 * shape so the Pod Manager renders a single "Solid Community" surface without
 * caring which backend a message came from:
 *
 *     CommunityChannel  (a Matrix room OR a Discourse category)
 *       └─ CommunityThread   (a Matrix room is one implicit thread; a Discourse
 *                             topic is a thread)
 *            └─ CommunityMessage  (a Matrix m.room.message; a Discourse post)
 *
 * Every message carries author, timestamp, body and a `permalink` back to the
 * source so click-through always lands on the canonical web view. `source`
 * discriminates the backend.
 */
export type FeedSourceKind = "matrix" | "discourse";
/** A community message — a chat line (Matrix) or a forum post (Discourse). */
export interface CommunityMessage {
    /** Stable id within its source (Matrix event_id / Discourse post id). */
    id: string;
    source: FeedSourceKind;
    /** Display name of the author, best-effort (Matrix display name / Discourse name||username). */
    author: string;
    /** Stable author handle (Matrix user id `@user:hs` / Discourse username). */
    authorId: string;
    /** Plain-text body. HTML is stripped to text for the unified view. */
    body: string;
    /** Original HTML body when the source provides one (Discourse `cooked`, Matrix `formatted_body`). */
    bodyHtml?: string;
    /** ISO-8601 timestamp (from origin_server_ts / created_at). */
    createdAt: string;
    /** Canonical web permalink to this message. */
    permalink: string;
}
/** A thread: a Discourse topic, or the (single implicit) timeline of a Matrix room. */
export interface CommunityThread {
    id: string;
    source: FeedSourceKind;
    title: string;
    /** Channel (room/category) this thread belongs to. */
    channelId: string;
    /** ISO-8601 of the most recent activity. */
    lastActivityAt: string;
    /** Total message/post count if known. */
    messageCount?: number;
    /** Unread count relative to the caller's last-seen marker, if computable. */
    unreadCount?: number;
    /** Canonical web permalink to the thread. */
    permalink: string;
    /** The messages of this thread, newest-first, when fetched. */
    messages?: CommunityMessage[];
}
/** A channel: a Matrix room, or a Discourse category. */
export interface CommunityChannel {
    /** Stable channel id (Matrix room id `!…:hs` / `discourse:<categoryId>`). */
    id: string;
    source: FeedSourceKind;
    /** Human label (Matrix room name / Discourse category name). */
    name: string;
    /** Optional topic / description. */
    topic?: string;
    /** Canonical web permalink to the channel. */
    permalink: string;
    /** Newest-first threads in this channel when listed. */
    threads?: CommunityThread[];
    /** Aggregate unread across the channel's threads, if computable. */
    unreadCount?: number;
}
/** A read-only marker the caller persists to compute unread counts. */
export interface ReadMarker {
    /**
     * Per-thread last-seen position, as a NUMERIC string (so the whole marker is
     * JSON-stringifiable uniformly):
     *  - Matrix → the latest seen `origin_server_ts` in **milliseconds** (e.g.
     *    `"1780000100000"`). Event ids are deliberately NOT supported here (they
     *    are not orderable without a server round-trip); use the ms timestamp.
     *  - Discourse → the highest seen `post_number` (e.g. `"9"`).
     *
     * A non-numeric value is treated as "no marker" (unread is left uncomputed)
     * rather than silently coerced to NaN. For Matrix the marker may be keyed by
     * the resolved room id (`!…:hs`) and/or the subscription alias (`#…`); the
     * resolved room id takes precedence.
     */
    [threadId: string]: string;
}
/** A normalized error from any feed source. */
export declare class CommunityFeedError extends Error {
    readonly source: FeedSourceKind;
    readonly cause?: unknown;
    constructor(source: FeedSourceKind, message: string, cause?: unknown);
}
//# sourceMappingURL=types.d.ts.map