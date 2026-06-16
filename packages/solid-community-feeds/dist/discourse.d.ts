/**
 * DiscourseFeedSource — reads the Solid forum (Discourse) over its JSON API.
 *
 * Verified against the live Solid forum (forum.solidproject.org), 2026-06:
 *   - GET /categories.json         → { category_list: { categories: [...] } }
 *   - GET /latest.json             → { topic_list: { topics: [...] }, users: [...] }
 *   - GET /c/{slug}/{id}.json      → { topic_list: { topics: [...] } } (per category)
 *   - GET /t/{id}.json             → { post_stream: { posts: [...] }, id, title, … }
 *
 * Auth: PUBLIC categories/topics need NO credentials. A per-user `User-Api-Key`
 * header (Discourse's user-API-key flow) unlocks the user's own notifications /
 * restricted categories; it is OPTIONAL and supplied via the credential seam —
 * never logged, never embedded in URLs.
 *
 * Discourse permalinks: a topic is `/t/{slug}/{id}`, a post is
 * `/t/{slug}/{id}/{post_number}`, a category is `/c/{slug}/{id}`.
 */
import { type SafeFetchOptions } from "./safeFetch.js";
import { type CommunityChannel, type CommunityThread } from "./types.js";
export interface DiscourseConfig {
    /** Forum base URL, e.g. https://forum.solidproject.org (https only, validated). */
    baseUrl: string;
    /** Optional Discourse user API key (credential seam). Sent as `User-Api-Key`. */
    userApiKey?: string;
    /** Optional client id paired with the user API key (`User-Api-Client-Id`). */
    userApiClientId?: string;
}
export declare class DiscourseFeedSource {
    private readonly base;
    private readonly headers;
    private readonly fetchOpts;
    constructor(config: DiscourseConfig, fetchOpts?: SafeFetchOptions);
    private getJson;
    /** List public (non read-restricted) categories as unified channels. */
    listChannels(): Promise<CommunityChannel[]>;
    private toChannel;
    /**
     * List threads (topics). With no `categoryId`, uses /latest.json (site-wide
     * newest-first). With a `categoryId` (+ its `slug`), uses the per-category
     * listing. Returns threads newest-first by last activity.
     */
    listThreads(opts?: {
        categoryId?: number;
        categorySlug?: string;
    }): Promise<CommunityThread[]>;
    private toThread;
    /**
     * Fetch a single topic with its posts, newest-first. `lastSeenPostNumber`
     * (from a {@link ReadMarker}) yields an `unreadCount` = posts with a higher
     * post_number.
     */
    getThread(topicId: number, lastSeenPostNumber?: number): Promise<CommunityThread>;
    private toMessage;
}
//# sourceMappingURL=discourse.d.ts.map