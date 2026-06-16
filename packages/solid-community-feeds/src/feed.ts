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

export class CommunityFeed {
  private readonly matrix?: MatrixFeedSource;
  private readonly discourse?: DiscourseFeedSource;

  constructor(sources: CommunityFeedSources) {
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
  async getFeed(subscriptions: FeedSubscriptions, marker: ReadMarker = {}): Promise<FeedResult> {
    const threads: CommunityThread[] = [];
    const errors: CommunityFeedError[] = [];

    // --- Matrix rooms (each as one thread) ---
    if (this.matrix && subscriptions.matrixRooms?.length) {
      const matrix = this.matrix;
      for (const room of subscriptions.matrixRooms) {
        try {
          // Resolve the alias FIRST so the read marker can be looked up under
          // the resolved room id (which is also `thread.id`, what a caller
          // persists), falling back to the subscription string. This keeps
          // unread counts working whether the caller keyed by alias or room id.
          const roomId = await matrix.resolveAlias(room);
          const seen = numericMarker(marker[roomId]) ?? numericMarker(marker[room]);
          const thread = await matrix.getRoomThread(roomId, {
            ...(subscriptions.matrixLimit !== undefined
              ? { limit: subscriptions.matrixLimit }
              : {}),
            ...(seen !== undefined ? { lastSeenTs: seen } : {}),
          });
          threads.push(thread);
        } catch (err) {
          errors.push(asFeedError("matrix", err));
        }
      }
    }

    // --- Discourse topics (each as one thread) ---
    if (this.discourse && subscriptions.discourseTopicIds?.length) {
      for (const topicId of subscriptions.discourseTopicIds) {
        try {
          const key = `discourse:t:${topicId}`;
          const seenNum = numericMarker(marker[key]);
          const thread = await this.discourse.getThread(topicId, seenNum);
          threads.push(thread);
        } catch (err) {
          errors.push(asFeedError("discourse", err));
        }
      }
    }

    // --- Discourse latest (thread headers, no messages) ---
    if (this.discourse && subscriptions.includeDiscourseLatest !== false) {
      try {
        const latest = await this.discourse.listThreads();
        // Don't duplicate topics already pulled in full above.
        const have = new Set(threads.map((t) => t.id));
        for (const t of latest) {
          if (!have.has(t.id)) {
            threads.push(t);
          }
        }
      } catch (err) {
        errors.push(asFeedError("discourse", err));
      }
    }

    threads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

    const totalUnread = threads.reduce((acc, t) => acc + (t.unreadCount ?? 0), 0);
    return { threads, totalUnread, errors };
  }
}

/**
 * Parse a {@link ReadMarker} value as a finite non-negative number, or return
 * `undefined` if it is absent / non-numeric (so a bad marker leaves unread
 * UNCOMPUTED rather than silently coercing to NaN — which would make every
 * comparison false and report zero unread).
 */
function numericMarker(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function asFeedError(source: "matrix" | "discourse", err: unknown): CommunityFeedError {
  if (err instanceof CommunityFeedError) {
    return err;
  }
  return new CommunityFeedError(source, err instanceof Error ? err.message : String(err), err);
}
