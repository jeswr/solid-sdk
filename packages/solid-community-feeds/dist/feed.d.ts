/**
 * CommunityFeed — the unified aggregator the Pod Manager consumes.
 *
 * Holds an optional MatrixFeedSource + an optional DiscourseFeedSource and a
 * user-selected list of subscriptions (which Matrix rooms / Discourse topics the
 * user cares about). Produces ONE newest-first, deduplicated feed across both
 * backends, and computes unread counts against a caller-persisted {@link ReadMarker}.
 *
 * The host app (PM) persists the read marker (e.g. in the user's pod); this
 * client is stateless beyond the sources it was constructed with.
 */
import type { DiscourseFeedSource } from "./discourse.js";
import type { MatrixFeedSource } from "./matrix.js";
import { CommunityFeedError, type CommunityThread, type ReadMarker } from "./types.js";
/** A user's selected subscriptions across the two backends. */
export interface FeedSubscriptions {
    /** Matrix rooms (ids `!…` or aliases `#…`) the user follows. */
    matrixRooms?: string[];
    /** Discourse topic ids the user follows directly. */
    discourseTopicIds?: number[];
    /** If true (default), also include the forum's site-wide latest topics as headers. */
    includeDiscourseLatest?: boolean;
    /** Per-room message page size (default 50). */
    matrixLimit?: number;
}
export interface CommunityFeedSources {
    matrix?: MatrixFeedSource;
    discourse?: DiscourseFeedSource;
}
export interface FeedResult {
    /** Threads newest-first by last activity, across both sources. */
    threads: CommunityThread[];
    /** Sum of per-thread unread counts (only threads where unread was computable). */
    totalUnread: number;
    /** Non-fatal per-source errors (one source failing must not blank the feed). */
    errors: CommunityFeedError[];
}
export declare class CommunityFeed {
    private readonly matrix?;
    private readonly discourse?;
    constructor(sources: CommunityFeedSources);
    /**
     * Build the unified feed for a user's subscriptions. Each subscribed Matrix
     * room becomes a thread (its timeline) and each subscribed Discourse topic
     * becomes a thread; optionally the forum's latest topics are folded in as
     * message-less thread headers. Failures in one source are collected in
     * `errors` rather than thrown, so a Matrix outage never blanks the forum feed.
     */
    getFeed(subscriptions: FeedSubscriptions, marker?: ReadMarker): Promise<FeedResult>;
}
//# sourceMappingURL=feed.d.ts.map