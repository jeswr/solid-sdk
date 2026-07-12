// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Golden-master / characterization tests.
 *
 * Unlike the per-module unit tests (which assert individual PROPERTIES), these
 * snapshot the COMPLETE observable output shape of the package's two
 * output-producing surfaces — the unified `CommunityFeed.getFeed` result and the
 * ActivityStreams projection — exactly as an external consumer (the Pod Manager
 * "Solid Community" view) binds to them. Their purpose is to PIN behaviour before
 * a structural refactor: if a refactor changes the emitted feed/AS2 shape at all,
 * an inline snapshot here changes, which is stop-the-line.
 *
 * The fixtures are deterministic (fixed timestamps / ids), so no normalisation of
 * non-deterministic fields is needed; the snapshots are stable as written.
 *
 * NEVER `--update` these to make a red test green mid-refactor — that would
 * launder a behaviour change. A diff here means the refactor changed behaviour.
 */

import { describe, expect, it } from "vitest";
import {
  CommunityFeed,
  channelToAs2,
  DiscourseFeedSource,
  MatrixFeedSource,
  messageToAs2,
  threadToAs2,
} from "../src/index.js";
import {
  DISCOURSE_CATEGORIES,
  DISCOURSE_LATEST,
  DISCOURSE_TOPIC_9856,
  MATRIX_DIRECTORY_SOLID_PROJECT,
  MATRIX_MESSAGES,
  MATRIX_ROOM_NAME,
  MATRIX_ROOM_TOPIC,
  stubFetch,
} from "./fixtures.js";

const HS = "https://matrix.org";
const FORUM = "https://forum.solidproject.org";
const ROOM = "!vUYWTYtHqQmtlhthvy:matrix.org";

function combinedStub() {
  return stubFetch([
    { match: (u) => u.includes("/directory/room/"), body: MATRIX_DIRECTORY_SOLID_PROJECT },
    { match: (u) => u.includes("/state/m.room.name/"), body: MATRIX_ROOM_NAME },
    { match: (u) => u.includes("/state/m.room.topic/"), body: MATRIX_ROOM_TOPIC },
    { match: (u) => u.includes("/messages"), body: MATRIX_MESSAGES },
    { match: (u) => u.includes("/categories.json"), body: DISCOURSE_CATEGORIES },
    { match: (u) => u.includes("/t/9856.json"), body: DISCOURSE_TOPIC_9856 },
    { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
  ]);
}

describe("GOLDEN: CommunityFeed.getFeed full output shape", () => {
  it("matrix + discourse-topic + discourse-latest, with a read marker", async () => {
    const { fetch } = combinedStub();
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed(
      { matrixRooms: [ROOM], discourseTopicIds: [9856], includeDiscourseLatest: true },
      { [ROOM]: "1780000100000", "discourse:t:9856": "1" },
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "errors": [],
        "threads": [
          {
            "channelId": "discourse:1",
            "id": "discourse:t:9856",
            "lastActivityAt": "2026-06-16T14:39:56.373Z",
            "messageCount": 9,
            "messages": [
              {
                "author": "alice",
                "authorId": "alice",
                "body": "Latest reply here.

      Second paragraph.",
                "bodyHtml": "<p>Latest reply here.</p><p>Second paragraph.</p>",
                "createdAt": "2026-06-16T14:39:56.373Z",
                "id": "discourse:p:26400",
                "permalink": "https://forum.solidproject.org/t/solid-info-app/9856/9",
                "source": "discourse",
              },
              {
                "author": "Matthias Evering",
                "authorId": "ewingson",
                "body": "Hello & welcome to the Solid Info App thread.",
                "bodyHtml": "<p>Hello &amp; welcome to the <b>Solid Info App</b> thread.</p>",
                "createdAt": "2025-08-22T16:05:47.566Z",
                "id": "discourse:p:26358",
                "permalink": "https://forum.solidproject.org/t/solid-info-app/9856/1",
                "source": "discourse",
              },
            ],
            "permalink": "https://forum.solidproject.org/t/solid-info-app/9856",
            "source": "discourse",
            "title": "Solid Info App",
            "unreadCount": 1,
          },
          {
            "channelId": "!vUYWTYtHqQmtlhthvy:matrix.org",
            "id": "!vUYWTYtHqQmtlhthvy:matrix.org",
            "lastActivityAt": "2026-05-28T20:30:00.000Z",
            "messageCount": 2,
            "messages": [
              {
                "author": "alice",
                "authorId": "@alice:matrix.org",
                "body": "newer message",
                "createdAt": "2026-05-28T20:30:00.000Z",
                "id": "$evt2",
                "permalink": "https://matrix.to/#/!vUYWTYtHqQmtlhthvy%3Amatrix.org/%24evt2",
                "source": "matrix",
              },
              {
                "author": "bob",
                "authorId": "@bob:matrix.org",
                "body": "older message with formatting",
                "bodyHtml": "<p>older message <b>with formatting</b></p>",
                "createdAt": "2026-05-28T20:28:20.000Z",
                "id": "$evt1",
                "permalink": "https://matrix.to/#/!vUYWTYtHqQmtlhthvy%3Amatrix.org/%24evt1",
                "source": "matrix",
              },
            ],
            "permalink": "https://matrix.to/#/!vUYWTYtHqQmtlhthvy%3Amatrix.org",
            "source": "matrix",
            "title": "Solid Project",
            "unreadCount": 1,
          },
          {
            "channelId": "discourse:1",
            "id": "discourse:t:6590",
            "lastActivityAt": "2024-01-05T10:00:00.000Z",
            "messageCount": 4,
            "permalink": "https://forum.solidproject.org/t/solid-pod-with-api/6590",
            "source": "discourse",
            "title": "Solid Pod with API",
          },
        ],
        "totalUnread": 2,
      }
    `);
  });

  it("discourse-only feed (no matrix source configured)", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
    ]);
    const feed = new CommunityFeed({
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed({ includeDiscourseLatest: true });
    expect(result).toMatchInlineSnapshot(`
      {
        "errors": [],
        "threads": [
          {
            "channelId": "discourse:1",
            "id": "discourse:t:9856",
            "lastActivityAt": "2026-06-16T14:39:56.373Z",
            "messageCount": 9,
            "permalink": "https://forum.solidproject.org/t/solid-info-app/9856",
            "source": "discourse",
            "title": "Solid Info App",
          },
          {
            "channelId": "discourse:1",
            "id": "discourse:t:6590",
            "lastActivityAt": "2024-01-05T10:00:00.000Z",
            "messageCount": 4,
            "permalink": "https://forum.solidproject.org/t/solid-pod-with-api/6590",
            "source": "discourse",
            "title": "Solid Pod with API",
          },
        ],
        "totalUnread": 0,
      }
    `);
  });
});

describe("GOLDEN: ActivityStreams projection", () => {
  it("messageToAs2 — text-only message", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/t/9856.json"), body: DISCOURSE_TOPIC_9856 },
    ]);
    const thread = await new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }).getThread(9856);
    const textMsg = thread.messages?.find((m) => m.bodyHtml === undefined);
    // (Discourse posts always carry HTML; build a text-only message explicitly.)
    const message = {
      id: "x",
      source: "matrix" as const,
      author: "Alice",
      authorId: "@alice:matrix.org",
      body: "hello world",
      createdAt: "2026-06-16T00:00:00.000Z",
      permalink: "https://matrix.to/#/!r/$e",
    };
    expect(textMsg).toBeUndefined();
    expect(messageToAs2(message)).toMatchInlineSnapshot(`
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "attributedTo": {
          "name": "Alice",
          "preferredUsername": "@alice:matrix.org",
          "type": "Person",
        },
        "content": "hello world",
        "https://w3id.org/jeswr/community#source": "matrix",
        "id": "https://matrix.to/#/!r/$e",
        "published": "2026-06-16T00:00:00.000Z",
        "type": "Note",
        "url": "https://matrix.to/#/!r/$e",
      }
    `);
  });

  it("threadToAs2 + channelToAs2 — full HTML thread under a channel", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/t/9856.json"), body: DISCOURSE_TOPIC_9856 },
    ]);
    const thread = await new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }).getThread(9856);
    expect(threadToAs2(thread)).toMatchInlineSnapshot(`
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/jeswr/community#source": "discourse",
        "id": "https://forum.solidproject.org/t/solid-info-app/9856",
        "items": [
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            "attributedTo": {
              "name": "alice",
              "preferredUsername": "alice",
              "type": "Person",
            },
            "content": "<p>Latest reply here.</p><p>Second paragraph.</p>",
            "https://w3id.org/jeswr/community#source": "discourse",
            "id": "https://forum.solidproject.org/t/solid-info-app/9856/9",
            "mediaType": "text/html",
            "published": "2026-06-16T14:39:56.373Z",
            "summary": "Latest reply here.

      Second paragraph.",
            "type": "Note",
            "url": "https://forum.solidproject.org/t/solid-info-app/9856/9",
          },
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            "attributedTo": {
              "name": "Matthias Evering",
              "preferredUsername": "ewingson",
              "type": "Person",
            },
            "content": "<p>Hello &amp; welcome to the <b>Solid Info App</b> thread.</p>",
            "https://w3id.org/jeswr/community#source": "discourse",
            "id": "https://forum.solidproject.org/t/solid-info-app/9856/1",
            "mediaType": "text/html",
            "published": "2025-08-22T16:05:47.566Z",
            "summary": "Hello & welcome to the Solid Info App thread.",
            "type": "Note",
            "url": "https://forum.solidproject.org/t/solid-info-app/9856/1",
          },
        ],
        "name": "Solid Info App",
        "published": "2026-06-16T14:39:56.373Z",
        "totalItems": 9,
        "type": "Collection",
        "url": "https://forum.solidproject.org/t/solid-info-app/9856",
      }
    `);
    const channel = {
      id: "discourse:1",
      source: "discourse" as const,
      name: "General Discussion",
      topic: "Topics that don't fit elsewhere.",
      permalink: "https://forum.solidproject.org/c/general-discussion/1",
      threads: [thread],
    };
    const as2 = channelToAs2(channel);
    expect(as2.type).toBe("Collection");
    expect(as2.summary).toBe("Topics that don't fit elsewhere.");
    expect((as2.items as unknown[]).length).toBe(1);
  });
});
