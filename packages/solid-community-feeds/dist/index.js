// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
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
export { channelToAs2, messageToAs2, threadToAs2, } from "./activitystreams.js";
export { DiscourseFeedSource } from "./discourse.js";
export { CommunityFeed } from "./feed.js";
export { htmlToText } from "./htmlText.js";
export { MatrixFeedSource } from "./matrix.js";
export { assertSafeUrl, SafeFetchError, safeFetch, safeFetchJson, } from "./safeFetch.js";
export { CommunityFeedError, } from "./types.js";
/**
 * Well-known Solid community channel addresses (verified 2026-06).
 * These are convenience constants; any homeserver/forum is configurable.
 */
export const SOLID_CHANNELS = {
    /** The Solid Project Matrix room (linked from solidproject.org/community). */
    matrixRoom: "#solid_project:matrix.org",
    /** The historical Gitter `#solid` room, bridged onto Matrix. */
    matrixGitterRoom: "#solid:matrix.org",
    /** matrix.org public homeserver base. */
    matrixHomeserver: "https://matrix.org",
    /** The Solid community forum (Discourse). */
    forumBaseUrl: "https://forum.solidproject.org",
};
//# sourceMappingURL=index.js.map