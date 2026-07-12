// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
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
import { CommunityFeedError } from "./types.js";
export class CommunityFeed {
    matrix;
    discourse;
    constructor(sources) {
        if (sources.matrix) {
            this.matrix = sources.matrix;
        }
        if (sources.discourse) {
            this.discourse = sources.discourse;
        }
    }
    /**
     * Build the unified feed for a user's subscriptions. Each subscribed Matrix
     * room becomes a thread (its timeline) and each subscribed Discourse topic
     * becomes a thread; optionally the forum's latest topics are folded in as
     * message-less thread headers. Failures in one source are collected in
     * `errors` rather than thrown, so a Matrix outage never blanks the forum feed.
     */
    async getFeed(subscriptions, marker = {}) {
        const threads = [];
        const errors = [];
        // Each source block appends to the shared accumulators IN ORDER (matrix →
        // discourse topics → discourse latest); the latest block dedupes against the
        // threads already accumulated above, so the order is load-bearing.
        await this.collectMatrixRooms(subscriptions, marker, threads, errors);
        await this.collectDiscourseTopics(subscriptions, marker, threads, errors);
        await this.collectDiscourseLatest(subscriptions, threads, errors);
        threads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
        const totalUnread = threads.reduce((acc, t) => acc + (t.unreadCount ?? 0), 0);
        return { threads, totalUnread, errors };
    }
    /** Each subscribed Matrix room → one thread (its timeline). */
    async collectMatrixRooms(subscriptions, marker, threads, errors) {
        const matrix = this.matrix;
        if (!matrix || !subscriptions.matrixRooms?.length) {
            return;
        }
        for (const room of subscriptions.matrixRooms) {
            try {
                // Resolve the alias FIRST so the read marker can be looked up under the
                // resolved room id (which is also `thread.id`, what a caller persists),
                // falling back to the subscription string. This keeps unread counts
                // working whether the caller keyed by alias or room id.
                const roomId = await matrix.resolveAlias(room);
                const seen = numericMarker(marker[roomId]) ?? numericMarker(marker[room]);
                const thread = await matrix.getRoomThread(roomId, {
                    ...(subscriptions.matrixLimit !== undefined ? { limit: subscriptions.matrixLimit } : {}),
                    ...(seen !== undefined ? { lastSeenTs: seen } : {}),
                });
                threads.push(thread);
            }
            catch (err) {
                errors.push(asFeedError("matrix", err));
            }
        }
    }
    /** Each subscribed Discourse topic → one thread (with its posts). */
    async collectDiscourseTopics(subscriptions, marker, threads, errors) {
        const discourse = this.discourse;
        if (!discourse || !subscriptions.discourseTopicIds?.length) {
            return;
        }
        for (const topicId of subscriptions.discourseTopicIds) {
            try {
                const seenNum = numericMarker(marker[`discourse:t:${topicId}`]);
                threads.push(await discourse.getThread(topicId, seenNum));
            }
            catch (err) {
                errors.push(asFeedError("discourse", err));
            }
        }
    }
    /**
     * The forum's site-wide latest topics, folded in as message-less thread
     * headers — skipping any topic already pulled in full by an earlier block.
     */
    async collectDiscourseLatest(subscriptions, threads, errors) {
        const discourse = this.discourse;
        if (!discourse || subscriptions.includeDiscourseLatest === false) {
            return;
        }
        try {
            const latest = await discourse.listThreads();
            const have = new Set(threads.map((t) => t.id));
            for (const t of latest) {
                if (!have.has(t.id)) {
                    threads.push(t);
                }
            }
        }
        catch (err) {
            errors.push(asFeedError("discourse", err));
        }
    }
}
/**
 * Parse a {@link ReadMarker} value as a finite non-negative number, or return
 * `undefined` if it is absent / non-numeric (so a bad marker leaves unread
 * UNCOMPUTED rather than silently coercing to NaN — which would make every
 * comparison false and report zero unread).
 */
function numericMarker(value) {
    if (value === undefined) {
        return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function asFeedError(source, err) {
    if (err instanceof CommunityFeedError) {
        return err;
    }
    return new CommunityFeedError(source, err instanceof Error ? err.message : String(err), err);
}
//# sourceMappingURL=feed.js.map