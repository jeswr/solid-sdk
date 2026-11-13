// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Message, type Room } from "../src/apps/chat/lib/client";
import { SearchError } from "../src/apps/chat/lib/search";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const NOW = new Date("2026-11-03T12:00:00Z");
let client: ChatClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  client = new ChatClient(createDemoPod({ root: ROOT }).fetch, ROOT, ME);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function room(index = 0): Room {
  return {
    url: `${ROOT}chat/rooms/room-${index}/`,
    name: `Room ${index}`,
    members: [ME],
    creator: ME,
    created: NOW.toISOString(),
    isDirect: false,
  };
}
function message(index = 0): Message {
  return {
    id: `${room().url}2026/11/03.ttl#m-${index}`,
    content: "Hello garden https://example.org/plan",
    author: ME,
    published: new Date(NOW.getTime() - index).toISOString(),
    mediaType: "text/plain",
    updated: undefined,
    tombstone: false,
    deleted: false,
    edited: false,
    reactions: [],
  };
}
it("searches only joined rooms, excludes deletions and skips unavailable rooms", async () => {
  const joined = await client.createRoom({ name: "Book club", members: [] });
  const first = await client.send(joined.url, "Garden plans");
  const deleted = await client.send(joined.url, "Garden deleted");
  await client.remove(joined.url, deleted.id);
  const unjoined = await client.createRoom({ name: "Private", members: [] });
  await client.send(unjoined.url, "Garden unjoined");
  await client.leave(unjoined.url);
  const unavailable = `${ROOT}chat/rooms/missing/`;
  await client.join(unavailable);
  const result = await client.search('garden in:"BOOK CLUB"', { timeZone: "UTC" });
  expect(result.results).toEqual([
    {
      room: { url: joined.url, name: joined.name, isDirect: false, members: joined.members },
      message: first,
      score: 2,
      snippet: { text: "Garden plans", ranges: [[0, 6]] },
    },
  ]);
  expect(result.searchedRooms).toBe(1);
  expect(result.skipped).toEqual([]);
  expect(result.truncated).toBe(false);
  expect(
    (await client.search(`in:${joined.url} garden`, { timeZone: "UTC" })).results,
  ).toHaveLength(1);
  expect((await client.search('-in:"book club" garden', { timeZone: "UTC" })).results).toEqual([]);
});
it("limits room loads to four at once and reports a failed day without losing other results", async () => {
  const rooms = Array.from({ length: 7 }, (_, index) => room(index));
  vi.spyOn(client, "joinedRooms").mockResolvedValue(rooms);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  const loads = vi.spyOn(client, "messages").mockImplementation(async (url) => {
    peak = Math.max(peak, ++active);
    await gate;
    active--;
    if (url === rooms[1]?.url) throw new TypeError("offline");
    return { messages: [{ ...message(), id: `${url}2026/11/03.ttl#one` }], next: null };
  });
  const pending = client.search("hello", { timeZone: "UTC" });
  await Promise.resolve();
  expect(loads).toHaveBeenCalledTimes(4);
  release();
  const result = await pending;
  expect(peak).toBe(4);
  expect(loads).toHaveBeenCalledTimes(7);
  expect(result.searchedRooms).toBe(6);
  expect(result.results).toHaveLength(6);
  expect(result.skipped).toEqual([
    { url: rooms[1]?.url, name: "Room 1", isDirect: false, members: [ME] },
  ]);
  expect(result.truncated).toBe(false);
  expect(loads).toHaveBeenCalledWith(rooms[0]?.url, {
    before: NOW,
    days: 30,
    since: NOW,
    signal: undefined,
    background: true,
  });
});
it("caps rooms and days, respects explicit budgets and limits results to the best 200", async () => {
  vi.spyOn(client, "joinedRooms").mockResolvedValue(Array.from({ length: 51 }, (_, i) => room(i)));
  const loads = vi.spyOn(client, "messages").mockResolvedValue({ messages: [], next: null });
  expect((await client.search("hello", { timeZone: "UTC" })).truncated).toBe(true);
  expect(loads).toHaveBeenCalledTimes(50);
  expect(loads).toHaveBeenCalledWith(room().url, {
    before: NOW,
    days: 30,
    since: NOW,
    signal: undefined,
    background: true,
  });
  loads.mockClear();
  expect(
    (await client.search("hello", { days: 60, maxRooms: 51, timeZone: "UTC" })).truncated,
  ).toBe(false);
  expect(loads).toHaveBeenCalledTimes(51);
  expect(loads).toHaveBeenCalledWith(room().url, {
    before: NOW,
    days: 60,
    since: NOW,
    signal: undefined,
    background: true,
  });
  loads.mockClear();
  expect(
    (await client.search("hello", { days: 1000, maxRooms: 1000, timeZone: "UTC" })).truncated,
  ).toBe(false);
  expect(loads).toHaveBeenCalledTimes(51);
  expect(loads).toHaveBeenCalledWith(room().url, {
    before: NOW,
    days: 366,
    since: NOW,
    signal: undefined,
    background: true,
  });
  loads.mockClear();
  expect((await client.search("hello", { days: 2, maxRooms: 1, timeZone: "UTC" })).truncated).toBe(
    true,
  );
  expect(loads).toHaveBeenCalledTimes(1);
  expect(loads).toHaveBeenCalledWith(room().url, {
    before: NOW,
    days: 2,
    since: NOW,
    signal: undefined,
    background: true,
  });
  vi.mocked(client.joinedRooms).mockResolvedValue([room()]);
  loads.mockResolvedValue({
    messages: Array.from({ length: 205 }, (_, i) => message(i)),
    next: null,
  });
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.results).toHaveLength(200);
  expect(result.results[0]?.message.id).toBe(message().id);
  expect(result.results[199]?.message.id).toBe(message(199).id);
  expect(result.truncated).toBe(true);
});
it("uses cached profile names without fetching other profiles and preserves safe text flags", async () => {
  const named = new ChatClient(
    async () =>
      new Response(`<${ME}> <http://xmlns.com/foaf/0.1/name> "Alice".`, {
        headers: { "content-type": "text/turtle" },
      }),
    ROOT,
    ME,
  );
  await named.profile(ME);
  vi.spyOn(named, "joinedRooms").mockResolvedValue([room()]);
  vi.spyOn(named, "messages").mockResolvedValue({ messages: [message()], next: null });
  const profiles = vi.spyOn(named, "profile");
  expect((await named.search("from:alice has:link", { timeZone: "UTC" })).results).toHaveLength(1);
  expect((await named.search("has:attachment", { timeZone: "UTC" })).results).toEqual([]);
  expect((await named.search("is:thread", { timeZone: "UTC" })).results).toEqual([]);
  expect(profiles).not.toHaveBeenCalled();
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room()]);
  const timeless = message(3);
  delete timeless.author;
  delete timeless.published;
  vi.spyOn(client, "messages").mockResolvedValue({
    messages: [
      message(),
      { ...message(1), tombstone: true },
      { ...message(2), deletedAt: NOW.toISOString() },
      timeless,
    ],
    next: null,
  });
  expect((await client.search(`from:${ME}`, { timeZone: "UTC" })).results).toHaveLength(1);
  expect((await client.search("hello", { timeZone: "UTC" })).results).toHaveLength(2);
});
it("validates queries, time zones and budgets before loading rooms and propagates discovery errors", async () => {
  const joined = vi.spyOn(client, "joinedRooms").mockResolvedValue([]);
  for (const [source, timeZone, code] of [
    ["has:nope", "UTC", "INVALID_QUERY"],
    ["hello", "Invalid/Zone", "INVALID_TIME_ZONE"],
    ['"hello', "UTC", "UNTERMINATED_PHRASE"],
  ]) {
    const error = await client
      .search(source as string, { timeZone: timeZone as string })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect(error).toMatchObject({ code });
  }
  for (const value of [0, -1, 1.5, Number.NaN, Infinity]) {
    await expect(client.search("hello", { days: value, timeZone: "UTC" })).rejects.toThrow();
    await expect(client.search("hello", { maxRooms: value, timeZone: "UTC" })).rejects.toThrow();
  }
  expect(joined).not.toHaveBeenCalled();
  expect(await client.search("hello", { timeZone: "UTC" })).toEqual({
    results: [],
    searchedRooms: 0,
    skipped: [],
    truncated: false,
    truncationReasons: [],
    searchedDays: 30,
    droppedRecords: 0,
  });
  expect((await client.search("hello", { maxRooms: 100, timeZone: "UTC" })).truncated).toBe(false);
  joined.mockRejectedValue(new TypeError("offline"));
  await expect(client.search("hello", { timeZone: "UTC" })).rejects.toThrow("offline");
});
it("names direct messages by their members and lets in: target a DM by the other person's name", async () => {
  const Bob = "https://bob.example/profile#me";
  const dm: Room = { ...room(9), name: "", members: [ME, Bob], isDirect: true };
  const broken = { url: `${ROOT}chat/rooms/broken/`, error: new Error("gone") };
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room(0), dm, broken]);
  vi.spyOn(client, "messages").mockImplementation(async (url) => ({
    messages: url === dm.url ? [{ ...message(1), id: `${dm.url}2026/11/03.ttl#m-1` }] : [],
    next: null,
  }));
  (client as unknown as { resolvedNames: Map<string, string> }).resolvedNames.set(
    Bob,
    "Bob Builder",
  );
  const result = await client.search('garden in:"bob builder"', { timeZone: "UTC" });
  expect(result.results.map(({ room }) => room)).toEqual([
    { url: dm.url, name: "", isDirect: true, members: [ME, Bob] },
  ]);
  const all = await client.search("garden", { timeZone: "UTC" });
  expect(all.skipped).toEqual([
    { url: broken.url, name: broken.url, isDirect: false, members: [] },
  ]);
  // Only the other member's name selects a DM; the reader's own name does not.
  (client as unknown as { resolvedNames: Map<string, string> }).resolvedNames.set(ME, "Alice");
  expect((await client.search('garden in:"alice"', { timeZone: "UTC" })).results).toEqual([]);
});
