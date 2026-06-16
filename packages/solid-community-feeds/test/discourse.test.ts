// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { DiscourseFeedSource } from "../src/discourse.js";
import { CommunityFeedError } from "../src/types.js";
import {
  DISCOURSE_CATEGORIES,
  DISCOURSE_LATEST,
  DISCOURSE_TOPIC_9856,
  stubFetch,
} from "./fixtures.js";

const BASE = "https://forum.solidproject.org";

describe("DiscourseFeedSource.listChannels", () => {
  it("maps public categories and filters read_restricted", async () => {
    const { fetch, calls } = stubFetch([
      { match: (u) => u.includes("/categories.json"), body: DISCOURSE_CATEGORIES },
    ]);
    const src = new DiscourseFeedSource({ baseUrl: BASE }, { fetch });
    const channels = await src.listChannels();
    expect(channels).toHaveLength(1); // Staff (read_restricted) filtered
    expect(channels[0]).toMatchObject({
      id: "discourse:1",
      source: "discourse",
      name: "General Discussion",
      permalink: `${BASE}/c/general-discussion/1`,
    });
    expect(calls[0]?.url).toBe(`${BASE}/categories.json`);
  });

  it("sends no auth header when no user API key", async () => {
    const { fetch, calls } = stubFetch([{ match: () => true, body: DISCOURSE_CATEGORIES }]);
    await new DiscourseFeedSource({ baseUrl: BASE }, { fetch }).listChannels();
    expect(calls[0]?.headers?.["User-Api-Key"]).toBeUndefined();
  });

  it("sends User-Api-Key + client id when configured", async () => {
    const { fetch, calls } = stubFetch([{ match: () => true, body: DISCOURSE_CATEGORIES }]);
    await new DiscourseFeedSource(
      { baseUrl: BASE, userApiKey: "secret-key", userApiClientId: "client-1" },
      { fetch },
    ).listChannels();
    expect(calls[0]?.headers?.["User-Api-Key"]).toBe("secret-key");
    expect(calls[0]?.headers?.["User-Api-Client-Id"]).toBe("client-1");
  });

  it("strips a trailing slash from the base URL", async () => {
    const { fetch, calls } = stubFetch([{ match: () => true, body: DISCOURSE_CATEGORIES }]);
    await new DiscourseFeedSource({ baseUrl: `${BASE}/` }, { fetch }).listChannels();
    expect(calls[0]?.url).toBe(`${BASE}/categories.json`);
  });
});

describe("DiscourseFeedSource.listThreads", () => {
  it("uses /latest.json with no category and sorts newest-first", async () => {
    const { fetch, calls } = stubFetch([
      { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
    ]);
    const threads = await new DiscourseFeedSource({ baseUrl: BASE }, { fetch }).listThreads();
    expect(calls[0]?.url).toBe(`${BASE}/latest.json`);
    expect(threads.map((t) => t.id)).toEqual(["discourse:t:9856", "discourse:t:6590"]);
    expect(threads[0]).toMatchObject({
      title: "Solid Info App",
      channelId: "discourse:1",
      messageCount: 9,
      permalink: `${BASE}/t/solid-info-app/9856`,
      lastActivityAt: "2026-06-16T14:39:56.373Z",
    });
  });

  it("uses the per-category endpoint when given a category", async () => {
    const { fetch, calls } = stubFetch([
      { match: (u) => u.includes("/c/general-discussion/1.json"), body: DISCOURSE_LATEST },
    ]);
    await new DiscourseFeedSource({ baseUrl: BASE }, { fetch }).listThreads({
      categoryId: 1,
      categorySlug: "general-discussion",
    });
    expect(calls[0]?.url).toBe(`${BASE}/c/general-discussion/1.json`);
  });
});

describe("DiscourseFeedSource.getThread", () => {
  it("returns a topic with messages newest-first and HTML→text", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/t/9856.json"), body: DISCOURSE_TOPIC_9856 },
    ]);
    const thread = await new DiscourseFeedSource({ baseUrl: BASE }, { fetch }).getThread(9856);
    expect(thread.id).toBe("discourse:t:9856");
    expect(thread.messageCount).toBe(9);
    expect(thread.messages).toHaveLength(2);
    // newest-first
    expect(thread.messages?.[0]?.id).toBe("discourse:p:26400");
    expect(thread.messages?.[0]?.body).toBe("Latest reply here.\n\nSecond paragraph.");
    // author falls back to username when name is blank
    expect(thread.messages?.[0]?.author).toBe("alice");
    expect(thread.messages?.[0]?.authorId).toBe("alice");
    expect(thread.messages?.[0]?.permalink).toBe(`${BASE}/t/solid-info-app/9856/9`);
    // name used when present; entity decoded in text
    const first = thread.messages?.[1];
    expect(first?.author).toBe("Matthias Evering");
    expect(first?.body).toBe("Hello & welcome to the Solid Info App thread.");
    expect(first?.bodyHtml).toContain("&amp;");
  });

  it("computes unreadCount from lastSeenPostNumber", async () => {
    const { fetch } = stubFetch([{ match: () => true, body: DISCOURSE_TOPIC_9856 }]);
    const thread = await new DiscourseFeedSource({ baseUrl: BASE }, { fetch }).getThread(9856, 1);
    // posts at post_number 1 and 9; seen up to 1 → one unread (#9)
    expect(thread.unreadCount).toBe(1);
  });
});

describe("DiscourseFeedSource error handling", () => {
  it("wraps a transport failure in CommunityFeedError(discourse)", async () => {
    const { fetch } = stubFetch([{ match: () => true, status: 500, statusText: "err" }]);
    const src = new DiscourseFeedSource({ baseUrl: BASE }, { fetch });
    await expect(src.listChannels()).rejects.toBeInstanceOf(CommunityFeedError);
    try {
      await src.listChannels();
    } catch (e) {
      expect((e as CommunityFeedError).source).toBe("discourse");
    }
  });
});
