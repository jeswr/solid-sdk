// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Mocked Matrix + Discourse responses, shaped from the VERIFIED live API
 * responses (forum.solidproject.org + matrix.org, 2026-06). No live network is
 * ever hit in tests; a stub fetch returns these.
 */

import type { FetchLike } from "../src/safeFetch.js";

/** Build a stub FetchLike from a map of (url-substring → JSON body | thrower). */
export function stubFetch(
  routes: Array<{
    match: (url: string, init?: { headers?: Record<string, string> }) => boolean;
    status?: number;
    body?: unknown;
    bodyText?: string;
    throwNetwork?: boolean;
    statusText?: string;
    responseHeaders?: Record<string, string>;
  }>,
): { fetch: FetchLike; calls: Array<{ url: string; headers?: Record<string, string> }> } {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
    const route = routes.find((r) => r.match(url, init));
    if (!route) {
      throw new Error(`no stub route for ${url}`);
    }
    if (route.throwNetwork) {
      throw new Error("simulated network failure");
    }
    const status = route.status ?? 200;
    const text = route.bodyText !== undefined ? route.bodyText : JSON.stringify(route.body ?? {});
    const respHeaders = route.responseHeaders ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: route.statusText ?? "OK",
      headers: {
        get: (name: string) => respHeaders[name.toLowerCase()] ?? null,
      },
      text: async () => text,
    };
  };
  return { fetch, calls };
}

// --- Discourse fixtures (shape verified against the live Solid forum) ---

export const DISCOURSE_CATEGORIES = {
  category_list: {
    can_create_category: false,
    can_create_topic: true,
    categories: [
      {
        id: 1,
        name: "General Discussion",
        slug: "general-discussion",
        description: "Topics that don't fit elsewhere.",
        topic_count: 1003,
        post_count: 5977,
        read_restricted: false,
        color: "F7941D",
      },
      {
        id: 7,
        name: "Staff",
        slug: "staff",
        description: "Private staff area.",
        topic_count: 3,
        read_restricted: true,
      },
    ],
  },
};

export const DISCOURSE_LATEST = {
  users: [{ id: 42, username: "ewingson", name: "Matthias Evering" }],
  topic_list: {
    can_create_topic: true,
    per_page: 30,
    topics: [
      {
        id: 9856,
        title: "Solid Info App",
        slug: "solid-info-app",
        posts_count: 9,
        reply_count: 2,
        created_at: "2025-08-22T16:05:47.502Z",
        last_posted_at: "2026-06-16T14:39:56.373Z",
        bumped_at: "2026-06-16T14:39:56.373Z",
        category_id: 1,
      },
      {
        id: 6590,
        title: "Solid Pod with API",
        slug: "solid-pod-with-api",
        posts_count: 4,
        reply_count: 3,
        created_at: "2024-01-02T10:00:00.000Z",
        last_posted_at: "2024-01-05T10:00:00.000Z",
        bumped_at: "2024-01-05T10:00:00.000Z",
        category_id: 1,
      },
    ],
  },
};

export const DISCOURSE_TOPIC_9856 = {
  id: 9856,
  title: "Solid Info App",
  slug: "solid-info-app",
  posts_count: 9,
  category_id: 1,
  post_stream: {
    posts: [
      {
        id: 26358,
        username: "ewingson",
        name: "Matthias Evering",
        created_at: "2025-08-22T16:05:47.566Z",
        cooked: "<p>Hello &amp; welcome to the <b>Solid Info App</b> thread.</p>",
        post_number: 1,
      },
      {
        id: 26400,
        username: "alice",
        name: "",
        created_at: "2026-06-16T14:39:56.373Z",
        cooked: "<p>Latest reply here.</p><p>Second paragraph.</p>",
        post_number: 9,
      },
    ],
  },
};

// --- Matrix fixtures (shape verified against the CS API spec + matrix.org) ---

export const MATRIX_DIRECTORY_SOLID_PROJECT = {
  room_id: "!vUYWTYtHqQmtlhthvy:matrix.org",
  servers: ["matrix.org", "gitter.im"],
};

export const MATRIX_ROOM_NAME = { name: "Solid Project" };
export const MATRIX_ROOM_TOPIC = { topic: "Everything Solid related." };

export const MATRIX_MESSAGES = {
  start: "t1-start",
  end: "t1-end",
  chunk: [
    {
      type: "m.room.message",
      event_id: "$evt2",
      sender: "@alice:matrix.org",
      origin_server_ts: 1_780_000_200_000,
      content: { msgtype: "m.text", body: "newer message" },
    },
    {
      type: "m.room.message",
      event_id: "$evt1",
      sender: "@bob:matrix.org",
      origin_server_ts: 1_780_000_100_000,
      content: {
        msgtype: "m.text",
        body: "older message with formatting",
        format: "org.matrix.custom.html",
        formatted_body: "<p>older message <b>with formatting</b></p>",
      },
    },
    // Non-message events that must be filtered out:
    {
      type: "m.room.member",
      event_id: "$state1",
      sender: "@carol:matrix.org",
      origin_server_ts: 1_780_000_050_000,
      content: { membership: "join" },
    },
    {
      type: "m.reaction",
      event_id: "$react1",
      sender: "@dave:matrix.org",
      origin_server_ts: 1_780_000_150_000,
      content: {},
    },
  ],
};
