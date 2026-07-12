// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
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

import { htmlToText } from "./htmlText.js";
import { type SafeFetchOptions, safeFetchJson } from "./safeFetch.js";
import {
  type CommunityChannel,
  CommunityFeedError,
  type CommunityMessage,
  type CommunityThread,
} from "./types.js";

export interface DiscourseConfig {
  /** Forum base URL, e.g. https://forum.solidproject.org (https only, validated). */
  baseUrl: string;
  /** Optional Discourse user API key (credential seam). Sent as `User-Api-Key`. */
  userApiKey?: string;
  /** Optional client id paired with the user API key (`User-Api-Client-Id`). */
  userApiClientId?: string;
}

// --- Raw Discourse JSON shapes (only the fields we read) ---

interface RawCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  topic_count?: number;
  read_restricted?: boolean;
}
interface RawCategoryList {
  category_list?: { categories?: RawCategory[] };
}
interface RawTopic {
  id: number;
  title: string;
  slug: string;
  posts_count?: number;
  reply_count?: number;
  last_posted_at?: string | null;
  created_at?: string;
  bumped_at?: string | null;
  category_id?: number;
  highest_post_number?: number;
}
interface RawTopicList {
  topic_list?: { topics?: RawTopic[] };
}
interface RawPost {
  id: number;
  username: string;
  name?: string | null;
  created_at: string;
  cooked: string;
  post_number: number;
}
interface RawTopicDetail {
  id: number;
  title: string;
  slug: string;
  category_id?: number;
  posts_count?: number;
  post_stream?: { posts?: RawPost[] };
}

export class DiscourseFeedSource {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly fetchOpts: SafeFetchOptions;

  constructor(config: DiscourseConfig, fetchOpts: SafeFetchOptions = {}) {
    // Normalise: drop any trailing slash so path joins are clean.
    this.base = config.baseUrl.replace(/\/+$/, "");
    this.fetchOpts = fetchOpts;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.userApiKey) {
      headers["User-Api-Key"] = config.userApiKey;
      if (config.userApiClientId) {
        headers["User-Api-Client-Id"] = config.userApiClientId;
      }
    }
    this.headers = headers;
  }

  private async getJson<T>(path: string): Promise<T> {
    try {
      return await safeFetchJson<T>(
        `${this.base}${path}`,
        { method: "GET", headers: this.headers },
        this.fetchOpts,
      );
    } catch (err) {
      throw new CommunityFeedError("discourse", `GET ${path} failed`, err);
    }
  }

  /** List public (non read-restricted) categories as unified channels. */
  async listChannels(): Promise<CommunityChannel[]> {
    const raw = await this.getJson<RawCategoryList>("/categories.json");
    const cats = raw.category_list?.categories ?? [];
    return cats.filter((c) => c.read_restricted !== true).map((c) => this.toChannel(c));
  }

  private toChannel(c: RawCategory): CommunityChannel {
    return {
      id: `discourse:${c.id}`,
      source: "discourse",
      name: c.name,
      ...(c.description ? { topic: htmlToText(c.description) } : {}),
      permalink: `${this.base}/c/${encodeURIComponent(c.slug)}/${c.id}`,
    };
  }

  /**
   * List threads (topics). With no `categoryId`, uses /latest.json (site-wide
   * newest-first). With a `categoryId` (+ its `slug`), uses the per-category
   * listing. Returns threads newest-first by last activity.
   */
  async listThreads(opts?: {
    categoryId?: number;
    categorySlug?: string;
  }): Promise<CommunityThread[]> {
    let path: string;
    let channelId: string;
    if (opts?.categoryId !== undefined && opts.categorySlug !== undefined) {
      path = `/c/${encodeURIComponent(opts.categorySlug)}/${opts.categoryId}.json`;
      channelId = `discourse:${opts.categoryId}`;
    } else {
      path = "/latest.json";
      channelId = "discourse:latest";
    }
    const raw = await this.getJson<RawTopicList>(path);
    const topics = raw.topic_list?.topics ?? [];
    return topics
      .map((t) => this.toThread(t, channelId))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  private toThread(t: RawTopic, channelId: string): CommunityThread {
    const last = t.bumped_at ?? t.last_posted_at ?? t.created_at ?? "";
    const cid = t.category_id !== undefined ? `discourse:${t.category_id}` : channelId;
    const thread: CommunityThread = {
      id: `discourse:t:${t.id}`,
      source: "discourse",
      title: t.title,
      channelId: cid,
      lastActivityAt: last,
      permalink: `${this.base}/t/${encodeURIComponent(t.slug)}/${t.id}`,
    };
    if (t.posts_count !== undefined) {
      thread.messageCount = t.posts_count;
    }
    return thread;
  }

  /**
   * Fetch a single topic with its posts, newest-first. `lastSeenPostNumber`
   * (from a {@link ReadMarker}) yields an `unreadCount` = posts with a higher
   * post_number.
   */
  async getThread(topicId: number, lastSeenPostNumber?: number): Promise<CommunityThread> {
    const raw = await this.getJson<RawTopicDetail>(`/t/${topicId}.json`);
    const posts = raw.post_stream?.posts ?? [];
    const messages: CommunityMessage[] = posts
      .map((p) => this.toMessage(p, raw.slug, raw.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const last = posts.reduce(
      (acc, p) => (p.created_at > acc ? p.created_at : acc),
      raw.post_stream?.posts?.[0]?.created_at ?? "",
    );
    const thread: CommunityThread = {
      id: `discourse:t:${raw.id}`,
      source: "discourse",
      title: raw.title,
      channelId:
        raw.category_id !== undefined ? `discourse:${raw.category_id}` : "discourse:latest",
      lastActivityAt: last,
      permalink: `${this.base}/t/${encodeURIComponent(raw.slug)}/${raw.id}`,
      messages,
    };
    if (raw.posts_count !== undefined) {
      thread.messageCount = raw.posts_count;
    }
    if (lastSeenPostNumber !== undefined) {
      thread.unreadCount = posts.filter((p) => p.post_number > lastSeenPostNumber).length;
    }
    return thread;
  }

  private toMessage(p: RawPost, slug: string, topicId: number): CommunityMessage {
    const text = htmlToText(p.cooked);
    const msg: CommunityMessage = {
      id: `discourse:p:${p.id}`,
      source: "discourse",
      author: p.name && p.name.trim() !== "" ? p.name : p.username,
      authorId: p.username,
      body: text,
      bodyHtml: p.cooked,
      createdAt: p.created_at,
      permalink: `${this.base}/t/${encodeURIComponent(slug)}/${topicId}/${p.post_number}`,
    };
    return msg;
  }
}
