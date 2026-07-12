// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { MatrixFeedSource } from "../src/matrix.js";
import { CommunityFeedError } from "../src/types.js";
import {
  MATRIX_DIRECTORY_SOLID_PROJECT,
  MATRIX_MESSAGES,
  MATRIX_ROOM_NAME,
  MATRIX_ROOM_TOPIC,
  stubFetch,
} from "./fixtures.js";

const HS = "https://matrix.org";
const TOKEN = "syt_secret_token";
const ROOM_ID = "!vUYWTYtHqQmtlhthvy:matrix.org";

function fullStub() {
  return stubFetch([
    {
      match: (u) => u.includes("/directory/room/"),
      body: MATRIX_DIRECTORY_SOLID_PROJECT,
    },
    {
      match: (u) => u.includes("/state/m.room.name/"),
      body: MATRIX_ROOM_NAME,
    },
    {
      match: (u) => u.includes("/state/m.room.topic/"),
      body: MATRIX_ROOM_TOPIC,
    },
    {
      match: (u) => u.includes("/messages"),
      body: MATRIX_MESSAGES,
    },
  ]);
}

describe("MatrixFeedSource.resolveAlias", () => {
  it("resolves an alias to a room id", async () => {
    const { fetch, calls } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    expect(await src.resolveAlias("#solid_project:matrix.org")).toBe(ROOM_ID);
    expect(calls[0]?.url).toContain("/_matrix/client/v3/directory/room/");
    expect(calls[0]?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("passes a room id through unchanged (no HTTP)", async () => {
    const { fetch, calls } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    expect(await src.resolveAlias(ROOM_ID)).toBe(ROOM_ID);
    expect(calls).toHaveLength(0);
  });
});

describe("MatrixFeedSource.getChannel", () => {
  it("builds a channel with name, topic and matrix.to permalink", async () => {
    const { fetch } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    const channel = await src.getChannel("#solid_project:matrix.org");
    expect(channel).toMatchObject({
      id: ROOM_ID,
      source: "matrix",
      name: "Solid Project",
      topic: "Everything Solid related.",
    });
    expect(channel.permalink).toBe("https://matrix.to/#/%23solid_project%3Amatrix.org");
  });

  it("falls back to the alias when name state is unavailable", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/directory/room/"), body: MATRIX_DIRECTORY_SOLID_PROJECT },
      { match: (u) => u.includes("/state/m.room.name/"), status: 404, statusText: "nf" },
      { match: (u) => u.includes("/state/m.room.topic/"), status: 404, statusText: "nf" },
    ]);
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    const channel = await src.getChannel("#solid_project:matrix.org");
    expect(channel.name).toBe("#solid_project:matrix.org");
    expect(channel.topic).toBeUndefined();
  });
});

describe("MatrixFeedSource.getRoomThread", () => {
  it("returns only text messages, newest-first, HTML→text, with event permalinks", async () => {
    const { fetch, calls } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    const thread = await src.getRoomThread(ROOM_ID, { limit: 50 });

    // m.room.member + m.reaction filtered out → 2 text messages
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages?.[0]?.id).toBe("$evt2"); // newest first
    expect(thread.messages?.[0]?.author).toBe("alice");
    expect(thread.messages?.[0]?.authorId).toBe("@alice:matrix.org");
    expect(thread.messages?.[0]?.body).toBe("newer message");

    // older one had formatted_body → text derived from HTML, html preserved
    const older = thread.messages?.[1];
    expect(older?.body).toBe("older message with formatting");
    expect(older?.bodyHtml).toContain("<b>with formatting</b>");
    expect(older?.permalink).toBe(`https://matrix.to/#/${encodeURIComponent(ROOM_ID)}/%24evt1`);

    expect(thread.source).toBe("matrix");
    expect(thread.lastActivityAt).toBe(new Date(1_780_000_200_000).toISOString());
    // dir=b backwards pagination requested
    const msgCall = calls.find((c) => c.url.includes("/messages"));
    expect(msgCall?.url).toContain("dir=b");
    expect(msgCall?.url).toContain("limit=50");
  });

  it("clamps an out-of-range limit", async () => {
    const { fetch, calls } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    await src.getRoomThread(ROOM_ID, { limit: 9999 });
    const msgCall = calls.find((c) => c.url.includes("/messages"));
    expect(msgCall?.url).toContain("limit=100");
  });

  it("computes unreadCount from lastSeenTs", async () => {
    const { fetch } = fullStub();
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    // seen up to the older message ts → one unread (the newer)
    const thread = await src.getRoomThread(ROOM_ID, { lastSeenTs: 1_780_000_100_000 });
    expect(thread.unreadCount).toBe(1);
  });
});

describe("MatrixFeedSource error handling", () => {
  it("wraps a failure in CommunityFeedError(matrix) without leaking the token", async () => {
    const { fetch } = stubFetch([
      { match: (u) => u.includes("/directory/room/"), status: 401, statusText: "unauth" },
    ]);
    const src = new MatrixFeedSource({ homeserverUrl: HS, accessToken: TOKEN }, { fetch });
    try {
      await src.resolveAlias("#solid_project:matrix.org");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CommunityFeedError);
      expect((e as CommunityFeedError).source).toBe("matrix");
      expect((e as Error).message).not.toContain(TOKEN);
    }
  });
});
