/**
 * `@jeswr/solid-community-feeds` — a framework-agnostic, read-first client that
 * normalizes the Solid community's communication channels into ONE unified feed:
 *
 *   - {@link MatrixFeedSource}   — Solid chat rooms over the Matrix Client-Server API
 *                                  (e.g. `#solid_project:matrix.org`).
 *   - {@link DiscourseFeedSource} — the Solid forum (forum.solidproject.org) over
 *                                  the Discourse JSON API.
 *   - {@link CommunityFeed}      — aggregates both into a unified
 *                                  channel→thread→message model, newest-first,
 *                                  with unread counts against a {@link ReadMarker}.
 *
 * SSRF-safe: all outbound requests go through {@link safeFetch} (https-only,
 * blocked-host check, no auto-redirect, timeout + body cap). The `fetch` is
 * injectable (auth-fetch seam / tests). Credentials (Matrix access token,
 * optional Discourse user API key) are passed via config and never logged.
 *
 * Optional AS2/JSON-LD projection ({@link messageToAs2} et al.) maps the model
 * onto ActivityStreams for RDF-native consumers.
 *
 * Read-first by design — posting/replying is a deliberately later phase.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */
export type { As2Object } from "./activitystreams.js";
export { channelToAs2, messageToAs2, threadToAs2, } from "./activitystreams.js";
export type { DiscourseConfig } from "./discourse.js";
export { DiscourseFeedSource } from "./discourse.js";
export type { CommunityFeedSources, FeedResult, FeedSubscriptions, } from "./feed.js";
export { CommunityFeed } from "./feed.js";
export { htmlToText } from "./htmlText.js";
export type { MatrixConfig } from "./matrix.js";
export { MatrixFeedSource } from "./matrix.js";
export type { BodyChunk, FetchLike, SafeFetchOptions, SafeFetchResponse, } from "./safeFetch.js";
export { assertSafeUrl, SafeFetchError, safeFetch, safeFetchJson, } from "./safeFetch.js";
export { type CommunityChannel, CommunityFeedError, type CommunityMessage, type CommunityThread, type FeedSourceKind, type ReadMarker, } from "./types.js";
/**
 * Well-known Solid community channel addresses (verified 2026-06).
 * These are convenience constants; any homeserver/forum is configurable.
 */
export declare const SOLID_CHANNELS: {
    /** The Solid Project Matrix room (linked from solidproject.org/community). */
    readonly matrixRoom: "#solid_project:matrix.org";
    /** The historical Gitter `#solid` room, bridged onto Matrix. */
    readonly matrixGitterRoom: "#solid:matrix.org";
    /** matrix.org public homeserver base. */
    readonly matrixHomeserver: "https://matrix.org";
    /** The Solid community forum (Discourse). */
    readonly forumBaseUrl: "https://forum.solidproject.org";
};
//# sourceMappingURL=index.d.ts.map