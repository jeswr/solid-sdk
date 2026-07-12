// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { DiscourseFeedSource } from "../src/discourse.js";
import { CommunityFeed } from "../src/feed.js";
import { MatrixFeedSource } from "../src/matrix.js";
import {
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
    { match: (u) => u.includes("/t/9856.json"), body: DISCOURSE_TOPIC_9856 },
    { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
  ]);
}

describe("CommunityFeed.getFeed", () => {
  it("merges Matrix + Discourse threads newest-first across sources", async () => {
    const { fetch } = combinedStub();
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed({
      matrixRooms: [ROOM],
      discourseTopicIds: [9856],
      includeDiscourseLatest: true,
    });
    expect(result.errors).toHaveLength(0);
    // Sources present: matrix room, discourse topic 9856 (full), discourse latest (6590 extra)
    const ids = result.threads.map((t) => t.id);
    expect(ids).toContain(ROOM);
    expect(ids).toContain("discourse:t:9856");
    expect(ids).toContain("discourse:t:6590");
    // 9856 pulled in full is NOT duplicated by the latest list
    expect(ids.filter((i) => i === "discourse:t:9856")).toHaveLength(1);
    // newest-first global ordering (descending lastActivityAt)
    const ts = result.threads.map((t) => t.lastActivityAt);
    expect([...ts].sort((a, b) => b.localeCompare(a))).toEqual(ts);
  });

  it("aggregates unread counts using the read marker", async () => {
    const { fetch } = combinedStub();
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed(
      { matrixRooms: [ROOM], discourseTopicIds: [9856], includeDiscourseLatest: false },
      { [ROOM]: "1780000100000", "discourse:t:9856": "1" },
    );
    // matrix: 1 unread (newer event), discourse: 1 unread (post #9) → total 2
    expect(result.totalUnread).toBe(2);
  });

  it("collects per-source errors without blanking the other source", async () => {
    // Matrix fails; Discourse latest succeeds.
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/directory/room/"), status: 500, statusText: "boom" },
      { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
    ]);
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed({
      matrixRooms: [ROOM],
      includeDiscourseLatest: true,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toBe("matrix");
    // forum still populated
    expect(result.threads.some((t) => t.source === "discourse")).toBe(true);
  });

  it("works with only a Discourse source configured", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/latest.json"), body: DISCOURSE_LATEST },
    ]);
    const feed = new CommunityFeed({
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed({ includeDiscourseLatest: true });
    expect(result.threads.length).toBeGreaterThan(0);
    expect(result.threads.every((t) => t.source === "discourse")).toBe(true);
  });

  it("treats a non-numeric read marker as 'no marker' (no NaN unread)", async () => {
    const { fetch } = combinedStub();
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
      discourse: new DiscourseFeedSource({ baseUrl: FORUM }, { fetch }),
    });
    const result = await feed.getFeed(
      { matrixRooms: [ROOM], discourseTopicIds: [9856], includeDiscourseLatest: false },
      // garbage markers (e.g. a stale event-id string) → unread left uncomputed
      { [ROOM]: "$some-event-id", "discourse:t:9856": "not-a-number" },
    );
    expect(result.totalUnread).toBe(0);
    expect(result.threads.every((t) => t.unreadCount === undefined)).toBe(true);
  });

  it("resolves a Matrix alias so a marker keyed by the resolved room id applies", async () => {
    const Alias = "#solid_project:matrix.org";
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/directory/room/"), body: MATRIX_DIRECTORY_SOLID_PROJECT },
      { match: (u) => u.includes("/state/m.room.name/"), body: MATRIX_ROOM_NAME },
      { match: (u) => u.includes("/state/m.room.topic/"), body: MATRIX_ROOM_TOPIC },
      { match: (u) => u.includes("/messages"), body: MATRIX_MESSAGES },
    ]);
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
    });
    // Subscribe by ALIAS, persist the marker by the RESOLVED room id.
    const result = await feed.getFeed(
      { matrixRooms: [Alias], includeDiscourseLatest: false },
      { [ROOM]: "1780000100000" },
    );
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe(ROOM);
    expect(result.totalUnread).toBe(1); // one event newer than the marker
  });

  it("does nothing when no sources match the subscriptions", async () => {
    const { fetch } = combinedStub();
    const feed = new CommunityFeed({
      matrix: new MatrixFeedSource({ homeserverUrl: HS, accessToken: "t" }, { fetch }),
    });
    // Only discourse latest requested but no discourse source → empty, no error
    const result = await feed.getFeed({ matrixRooms: [], includeDiscourseLatest: true });
    expect(result.threads).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
