// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Message, type Room } from "../src/apps/chat/lib/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const NOW = new Date("2026-11-03T12:00:00Z");
const room = (index = 0): Room => ({
  url: `${ROOT}chat/rooms/${index}/`,
  name: `Room ${index}`,
  members: [ME],
  creator: ME,
  created: NOW.toISOString(),
  isDirect: false,
});
const message = (index = 0, url = room().url): Message => ({
  id: `${url}2026/11/03.ttl#m-${index}`,
  author: ME,
  content: "hello garden",
  published: NOW.toISOString(),
  mediaType: "text/plain",
  updated: undefined,
  deleted: false,
  edited: false,
  tombstone: false,
  reactions: [],
});
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

it("drops hostile identifiers, dates and oversized records individually and repairs Unicode", async () => {
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room()]);
  const hostile: Partial<Message>[] = [
    { id: "urn:uuid:1" },
    { id: "not a URL" },
    { id: "https://foreign.example/day#one" },
    { id: `${ROOT}chat/rooms/00/day#one` },
    { id: `${room().url}${"x".repeat(2048)}` },
    { id: `${room().url}day#\ud800` },
    { published: "+010000-01-01T00:00:00Z" },
    { published: "0000-12-31T23:59:59Z" },
    { published: "invalid" },
    { content: "x".repeat(1_000_001) },
    { author: "x".repeat(2049) },
    { author: " " },
  ];
  const good = { ...message(100), content: "hello \ud800 garden", author: "person\ud800" };
  vi.spyOn(client, "messages").mockResolvedValue({
    messages: [...hostile.map((changes, i) => ({ ...message(i), ...changes })), good],
    next: null,
  });
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.results.map(({ message }) => message)).toEqual([good]);
  expect(result.results[0]?.snippet.text).toBe("hello \ufffd garden");
  expect(result.droppedRecords).toBe(hostile.length);
  expect(result.skipped).toEqual([]);
});

it("accepts RDF NamedNodes without letting a URN note break the HTTP message result", async () => {
  const pod = createDemoPod({ root: ROOT });
  client = new ChatClient(pod.fetch, ROOT, ME);
  const joined = await client.createRoom({ name: "Foreign notes", members: [] });
  const valid = await client.send(joined.url, "hello garden");
  const url = valid.id.split("#")[0] as string;
  const current = await pod.fetch(url);
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `${await current.text()}\n<urn:uuid:1> a <https://www.w3.org/ns/activitystreams#Note>; <https://www.w3.org/ns/activitystreams#content> "hello hostile".`,
  });
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.results.map(({ message }) => message.id)).toEqual([valid.id]);
  expect(result.droppedRecords).toBe(1);
});

it("uses resolved names only, truncates repaired names and seeds the session display name", async () => {
  const never = new Promise<Response>(() => {});
  client = new ChatClient(
    () => never,
    ROOT,
    ME,
    () => never,
    `Alice\ud800${"x".repeat(2041)}😀`,
  );
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room()]);
  const other = "https://bob.example/#me";
  vi.spyOn(client, "messages").mockResolvedValue({
    messages: [message(), { ...message(1), author: other }],
    next: null,
  });
  void client.profile(other);
  const result = await client.search("from:alice", { timeZone: "UTC" });
  expect(result.results).toHaveLength(1);
  expect(result.results[0]?.message.author).toBe(ME);
  expect((await client.search(`from:${other}`, { timeZone: "UTC" })).results).toHaveLength(1);
});

it("loads only positive in: rooms beyond the cap, validates rewrites before message reads", async () => {
  const joined = Array.from({ length: 55 }, (_, i) => room(i));
  vi.spyOn(client, "joinedRooms").mockResolvedValue(joined);
  const loads = vi
    .spyOn(client, "messages")
    .mockImplementation(async (url) => ({ messages: [message(0, url)], next: null }));
  for (const query of ['in:"ROOM 54"', `in:${room(54).url}`]) {
    const result = await client.search(query, { maxRooms: 1, timeZone: "UTC" });
    expect(result.results[0]?.room.url).toBe(room(54).url);
    expect(result.truncationReasons).toEqual([]);
  }
  expect(loads).toHaveBeenCalledTimes(2);
  loads.mockClear();
  await client.search('in:"Room 54" in:"Room 53"', { timeZone: "UTC" });
  expect(loads).not.toHaveBeenCalled();
  vi.mocked(client.joinedRooms).mockResolvedValue([
    { ...room(), name: "Big", url: `${ROOT}${"x".repeat(1001)}/` },
  ]);
  await expect(client.search("in:Big", { timeZone: "UTC" })).rejects.toMatchObject({
    code: "QUERY_TOO_LARGE",
  });
  vi.mocked(client.joinedRooms).mockResolvedValue([
    { ...room(), name: "Bad", url: `${ROOT}room\ud800/` },
  ]);
  await expect(client.search("in:Bad", { timeZone: "UTC" })).rejects.toMatchObject({
    code: "INVALID_QUERY",
  });
  expect(loads).not.toHaveBeenCalled();
});

it("bounds day requests by creation and reports only real omitted history", async () => {
  const pod = createDemoPod({ root: ROOT });
  const requests = vi.fn(pod.fetch);
  client = new ChatClient(requests, ROOT, ME);
  const joined = await client.createRoom({ name: "Today", members: [] });
  requests.mockClear();
  const result = await client.search("hello", { days: 1000, timeZone: "UTC" });
  expect(
    requests.mock.calls.filter(([url]) => /\/\d{4}\/\d{2}\/\d{2}\.ttl$/.test(String(url))),
  ).toHaveLength(1);
  expect(result.truncated).toBe(false);
  vi.spyOn(client, "joinedRooms").mockResolvedValue([
    { ...joined, created: "2020-01-01T00:00:00Z" },
    room(1),
  ]);
  const loads = vi
    .spyOn(client, "messages")
    .mockResolvedValue({ messages: [], next: new Date("2026-10-04") });
  expect(
    (await client.search("hello", { maxRooms: 1, timeZone: "UTC" })).truncationReasons,
  ).toEqual(["rooms", "days"]);
  for (const created of [undefined, "garbage", "0000-01-01", "+010000-01-01"]) {
    vi.mocked(client.joinedRooms).mockResolvedValue([{ ...room(), created }]);
    await client.search("hello", { timeZone: "UTC" });
    expect(loads).toHaveBeenLastCalledWith(
      room().url,
      expect.objectContaining({ since: undefined }),
    );
  }
});

it("chooses the owning container deterministically and reports failures in listed order", async () => {
  const outer = { ...room(), url: `${ROOT}chat/` };
  const nested = room();
  const first = room(1);
  const second = room(2);
  vi.spyOn(client, "joinedRooms").mockResolvedValue([
    outer,
    nested,
    first,
    second,
    { url: room(3).url, error: "offline" },
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(client, "messages").mockImplementation(async (url) => {
    if (url === first.url) {
      await gate;
      throw new Error("offline first");
    }
    if (url === second.url) {
      release();
      throw new Error("offline second");
    }
    if (url === outer.url) await gate;
    return {
      messages: [{ ...message(), content: url === nested.url ? "hello owner" : "hello copy" }],
      next: null,
    };
  });
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.results[0]?.room.url).toBe(nested.url);
  expect(result.results[0]?.message.content).toBe("hello owner");
  expect(result.skipped.map(({ url }) => url)).toEqual([first.url, second.url, room(3).url]);
  vi.mocked(client.joinedRooms).mockResolvedValue([nested, outer, nested]);
  expect((await client.search("hello", { timeZone: "UTC" })).results[0]?.message.content).toBe(
    "hello owner",
  );
});

it("bounds room metadata concurrency and reuses resolved metadata while refreshing membership", async () => {
  const pod = createDemoPod({ root: ROOT });
  client = new ChatClient(pod.fetch, ROOT, ME);
  const joined: Room[] = [];
  for (let i = 0; i < 9; i++)
    joined.push(await client.createRoom({ name: `Room ${i}`, members: [] }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const loads = vi.spyOn(client, "room").mockImplementation(async (url) => {
    peak = Math.max(peak, ++active);
    if (active === 4) started();
    await gate;
    active--;
    return joined.find((room) => room.url === url) as Room;
  });
  const pending = client.joinedRooms();
  await ready;
  expect(loads).toHaveBeenCalledTimes(4);
  release();
  await pending;
  expect(peak).toBe(4);
  loads.mockClear();
  vi.spyOn(client, "messages").mockResolvedValue({ messages: [], next: null });
  await client.search("hello", { maxRooms: 1, timeZone: "UTC" });
  expect(loads).not.toHaveBeenCalled();
  await client.leave((joined[0] as Room).url);
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.searchedRooms).toBe(8);
});

it("propagates aborts through discovery, metadata and day fetches without reporting skipped rooms", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    client.search("hello", { timeZone: "UTC", signal: aborted.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(client.joinedRooms({ signal: aborted.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(client.room(room().url, { signal: aborted.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  const pod = createDemoPod({ root: ROOT });
  const owner = new ChatClient(pod.fetch, ROOT, ME);
  const joined = await owner.createRoom({ name: "Abort", members: [] });
  for (const suffix of ["chat/rooms.ttl", "index.ttl", "2026/11/03.ttl"]) {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(input).endsWith(suffix)) {
        controller.abort();
        expect(init?.signal?.aborted).toBe(true);
        throw controller.signal.reason;
      }
      return pod.fetch(input, init);
    });
    const cancellable = new ChatClient(fetch, ROOT, ME);
    await expect(
      cancellable.search("hello", { timeZone: "UTC", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.mock.calls.filter(([input]) => String(input).includes(joined.url))).toHaveLength(
      suffix === "chat/rooms.ttl" ? 0 : suffix === "index.ttl" ? 1 : 2,
    );
  }
  const controller = new AbortController();
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room()]);
  vi.spyOn(client, "messages").mockImplementation(async () => {
    controller.abort();
    return { messages: [], next: null };
  });
  await expect(
    client.search("hello", { timeZone: "UTC", signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("drops invalid room identifiers without failing the rest of the snapshot", async () => {
  vi.spyOn(client, "joinedRooms").mockResolvedValue([
    room(),
    { ...room(1), url: `${ROOT}${"x".repeat(2049)}/` },
    { ...room(2), url: `${ROOT}room\ud800/` },
  ]);
  vi.spyOn(client, "messages").mockResolvedValue({ messages: [message()], next: null });
  const result = await client.search("hello", { timeZone: "UTC" });
  expect(result.results).toHaveLength(1);
  expect(result.droppedRecords).toBe(2);
});

it("bounds the engine snapshot and reports results omitted at its record limit", async () => {
  vi.spyOn(client, "joinedRooms").mockResolvedValue([room()]);
  vi.spyOn(client, "messages").mockResolvedValue({
    messages: Array.from({ length: 100_001 }, (_, i) => ({ ...message(i), content: "" })),
    next: null,
  });
  const result = await client.search("absent", { timeZone: "UTC" });
  expect(result.results).toEqual([]);
  expect(result.truncationReasons).toEqual(["records"]);
  expect(result.droppedRecords).toBe(1);
});
