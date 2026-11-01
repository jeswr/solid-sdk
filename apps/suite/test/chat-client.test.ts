// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { DataFactory, Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, ChatClientError } from "../src/apps/chat/lib/client";
import {
  buildRoom,
  ChatNode,
  leaveRoom,
  loadChat,
  NS,
  readDate,
  readJoinedRooms,
  readRoom,
  removeJoinedRoom,
  saveChat,
} from "../src/apps/chat/lib/model";
import { copyMessageTask, loadProfileName, loadRoomFiles } from "../src/apps/chat/lib/model/extras";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
const ME = `${ROOT}profile/card#me`;
const BOB = "https://bob.example.org/profile/card#me";
const NOW = new Date("2026-11-01T23:59:58Z");
let pod: ReturnType<typeof createDemoPod>;
let client: ChatClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  pod = createDemoPod({ root: ROOT });
  client = new ChatClient(pod.fetch, ROOT, ME);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("creates, joins, lists and leaves rooms without touching their contents", async () => {
  expect(await client.joinedRooms()).toEqual([]);
  await client.leave(`${ROOT}chat/rooms/absent/`);
  const room = await client.createRoom({ name: "Café & books", members: [BOB] });
  expect(room).toMatchObject({
    name: "Café & books",
    url: `${ROOT}chat/rooms/cafe-books/`,
    members: [ME, BOB],
    isDirect: false,
    creator: ME,
  });
  await client.join(room.url);
  expect(await client.joinedRooms()).toEqual([room]);
  await client.leave(room.url);
  expect(await client.joinedRooms()).toEqual([]);
  expect(await client.room(room.url)).toEqual(room);
  await client.leave(room.url);
  const dataset = new Store();
  expect(leaveRoom(`${ROOT}chat/rooms.ttl`, dataset, room.url).size).toBe(0);
  expect(await removeJoinedRoom(pod.fetch, ROOT, room.url)).toBeUndefined();
});
it("returns failed indexes as room rows, while collection failures still propagate", async () => {
  const url = `${ROOT}chat/rooms/missing/`;
  await client.join(url);
  expect(await client.joinedRooms()).toEqual([{ url, error: expect.any(Error) }]);
  await saveChat(pod.fetch, ROOT, `${url}index.ttl`, new Store(), { ifNoneMatch: "*" });
  await expect(client.room(url)).rejects.toMatchObject({ code: "invalid-input" });
  const bad = new ChatClient(async () => new Response(null, { status: 503 }), ROOT, ME);
  await expect(bad.joinedRooms()).rejects.toMatchObject({ status: 503 });
});
it("uses stable IDs, UTC day shards, PATCH append, latest edits, task due dates and tombstones", async () => {
  const room = await client.createRoom({ name: "Night", members: [] });
  const fetch = vi.fn(pod.fetch);
  client = new ChatClient(fetch, ROOT, ME);
  const first = await client.send(room.url, "First", { id: "one", at: NOW });
  expect(first.id).toBe(`${room.url}2026/11/01.ttl#one`);
  const second = await client.send(room.url, "Second", {
    id: "two",
    at: new Date("2026-11-01T23:59:59Z"),
  });
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true);
  vi.setSystemTime(new Date("2026-11-02T00:00:01Z"));
  const third = await client.send(room.url, "Third");
  expect(third.id).toMatch(/2026\/11\/02.ttl#[a-f\d-]{36}$/);
  await client.edit(room.url, first.id, "Revised");
  await client.toTask(room.url, first.id, { title: "Read", due: new Date("2026-11-03T12:00:00Z") });
  const doc = await loadChat(pod.fetch, room.url, first.id.split("#")[0] as string);
  expect(readDate(doc.dataset, first.id, `${NS.WF}dateDue`)).toBe("2026-11-03T12:00:00.000Z");
  await client.toTask(room.url, first.id, { title: "Read again" });
  await client.remove(room.url, second.id);
  const page = await client.messages(room.url);
  expect(page.messages.map((m) => [m.content, m.edited, m.deleted])).toEqual([
    ["Revised", true, false],
    ["Message deleted", false, true],
    ["Third", false, false],
  ]);
  expect(page.messages[0]?.task).toMatchObject({ title: "Read again", state: "open" });
  expect((await client.messages(room.url, { before: NOW, since: NOW, days: 1 })).next).toBeNull();
  await client.remove(room.url, first.id);
  const deleted = await loadChat(pod.fetch, room.url, first.id.split("#")[0] as string);
  expect(readDate(deleted.dataset, first.id, `${NS.WF}dateDue`)).toBeUndefined();
});
it("re-reads and retries a commutative append exactly once on a real stale validator", async () => {
  const room = await client.createRoom({ name: "Races", members: [] });
  await client.send(room.url, "Seed");
  let raced = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method === "PATCH" && !raced) {
      raced = true;
      await client.send(room.url, "Concurrent", { id: "other" });
    }
    return pod.fetch(input, init);
  };
  const racing = new ChatClient(fetch, ROOT, ME);
  expect((await racing.send(room.url, "Retried", { id: "stable" })).content).toBe("Retried");
  expect((await client.messages(room.url)).messages).toHaveLength(3);
  const alwaysConflict = vi.fn<typeof globalThis.fetch>(async (input, init) =>
    init?.method === "PATCH" ? new Response(null, { status: 412 }) : pod.fetch(input, init),
  );
  await expect(
    new ChatClient(alwaysConflict, ROOT, ME).send(room.url, "No", { id: "no" }),
  ).rejects.toMatchObject({ status: 412 });
  expect(alwaysConflict.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  const unavailable: typeof globalThis.fetch = async (input, init) =>
    init?.method === "PATCH" ? new Response(null, { status: 500 }) : pod.fetch(input, init);
  await expect(new ChatClient(unavailable, ROOT, ME).send(room.url, "No")).rejects.toMatchObject({
    status: 500,
  });
});
it("rejects non-own and unknown edits/deletes before any fetch; others become linked personal tasks", async () => {
  const room = await client.createRoom({ name: "Team", members: [BOB] });
  const own = await client.send(room.url, "Do a thing");
  const fetch = vi.fn(pod.fetch);
  const bob = new ChatClient(fetch, ROOT, BOB);
  await bob.messages(room.url);
  fetch.mockClear();
  await expect(bob.edit(room.url, own.id, "Bad")).rejects.toMatchObject({
    code: "not-own-message",
  });
  await expect(bob.remove(room.url, own.id)).rejects.toBeInstanceOf(ChatClientError);
  await expect(bob.edit(room.url, "unknown", "Bad")).rejects.toMatchObject({
    code: "not-own-message",
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(bob.toTask(room.url, "unknown", { title: "Unknown" })).rejects.toMatchObject({
    code: "missing-message",
  });
  await bob.toTask(room.url, own.id, { title: "Personal", due: NOW });
  await bob.toTask(room.url, own.id, { title: "Personal without date" });
  expect((await client.messages(room.url)).messages[0]?.task).toBeUndefined();
  const tasks = pod.snapshot().resources.filter(([url]) => url.startsWith(`${ROOT}tasks/`));
  expect(tasks).toHaveLength(2);
  const task = await loadChat(pod.fetch, ROOT, tasks[0]?.[0] as string);
  expect(
    [...task.dataset].some(
      (q) => q.predicate.value === `${NS.DCT}source` && q.object.value === own.id,
    ),
  ).toBe(true);
});
it("deduplicates direct rooms regardless of member order and respects broken rows and named pairs", async () => {
  const group = await client.createRoom({ name: "A pair", members: [BOB] });
  expect(group.isDirect).toBe(false);
  await client.join(`${ROOT}chat/rooms/broken/`);
  const dm = await client.createDirect(BOB);
  expect(dm.url).toMatch(/\/dm-[a-f\d]{16}\/$/);
  expect(dm).toMatchObject({ name: "", isDirect: true, members: [ME, BOB] });
  expect(await client.createDirect(BOB)).toEqual(dm);
  expect((await client.joinedRooms()).length).toBe(3);
  await expect(client.createDirect(ME)).rejects.toMatchObject({ code: "invalid-input" });
  const legacy = await client.createRoom({ name: "dm:legacy", members: [BOB] });
  expect(legacy.isDirect).toBe(true);
});
it("resolves slug collisions, folds to ASCII, caps the slug and propagates noncollision failures", async () => {
  const one = await client.createRoom({ name: "Same", members: [] });
  const two = await client.createRoom({ name: "Same", members: [] });
  const three = await client.createRoom({ name: "Same", members: [] });
  expect([one.url, two.url, three.url]).toEqual(
    ["same", "same-2", "same-3"].map((slug) => `${ROOT}chat/rooms/${slug}/`),
  );
  expect((await client.createRoom({ name: "💬", members: [] })).url).toBe(
    `${ROOT}chat/rooms/room/`,
  );
  expect(
    (await client.createRoom({ name: `${"a".repeat(47)}-${"a".repeat(20)}`, members: [] })).url,
  ).toBe(`${ROOT}chat/rooms/${"a".repeat(47)}/`);
  await client.createRoom({ name: "b".repeat(60), members: [] });
  expect((await client.createRoom({ name: "b".repeat(60), members: [] })).url).toBe(
    `${ROOT}chat/rooms/${"b".repeat(46)}-2/`,
  );
  const failed = new ChatClient(async () => new Response(null, { status: 500 }), ROOT, ME);
  await expect(failed.createRoom({ name: "Fail", members: [] })).rejects.toMatchObject({
    status: 500,
  });
});
it("counts the live newest page, excludes tombstones, and advances read markers monotonically", async () => {
  const room = await client.createRoom({ name: "Unread", members: [] });
  const first = await client.send(room.url, "one");
  vi.setSystemTime(new Date(NOW.getTime() + 1));
  const second = await client.send(room.url, "two");
  expect(await client.unreadCounts([room])).toEqual({ [room.url]: 2 });
  await client.preferences.markRead(room.url, NOW);
  expect(await client.unreadCounts([room])).toEqual({ [room.url]: 1 });
  await client.edit(room.url, first.id, "An edit isn't a new unread");
  expect(await client.unreadCounts([room])).toEqual({ [room.url]: 1 });
  await client.remove(room.url, second.id);
  expect(await client.unreadCounts([room])).toEqual({ [room.url]: 0 });
  await client.preferences.markRead(room.url, new Date(NOW.getTime() - 100));
  expect((await client.preferences.read()).data[0]?.lastRead).toBe(NOW.getTime());
});
it("reads a SolidOS LongChat day via interop and supports authorless, timeless and deleted foreign notes", async () => {
  const room = `${ROOT}chat/rooms/longchat/`;
  const fixture = readFileSync(
    new URL("./chat-model/fixtures/longchat.ttl", import.meta.url),
    "utf8",
  );
  await pod.fetch(`${room}index.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `@prefix meeting: <http://www.w3.org/ns/pim/meeting#>. <#it> a meeting:LongChat.`,
  });
  await pod.fetch(`${room}2026/10/26.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body:
      fixture +
      "@prefix meeting: <http://www.w3.org/ns/pim/meeting#>. <> a meeting:LongChat; meeting:message <#m1>, <#m2>.\n" +
      '\n<#no-author> a sioc:Note; sioc:content "No author"; dct:created "2026-10-26T11:02:00Z".\n<#no-time> a sioc:Note; sioc:content "No time"; foaf:maker <https://alice.example/profile#me>.\n<#deleted> a as:Note; as:content "Hidden"; <https://schema.org/dateDeleted> "2026-10-26T12:00:00Z".',
  });
  await client.join(room);
  expect(await client.room(room)).toMatchObject({ name: "", creator: undefined, isDirect: false });
  const page = await client.messages(room, {
    before: new Date("2026-10-26T12:00:00Z"),
    days: 1,
    since: new Date("2026-10-26T00:00:00Z"),
  });
  expect(page.messages.some((m) => m.content === "Meet at noon")).toBe(true);
  expect(page.messages.find((m) => m.id.endsWith("#deleted"))?.content).toBe("Message deleted");
  expect(await client.unreadCounts([{ url: room }])).toEqual({ [room]: 2 });
});
it("encodes share links and caches parsed profile names, including vcard and host/path fallback", async () => {
  const room = await client.createRoom({ name: "Links", members: [] });
  expect(client.inviteLink(room.url, "https://suite.example.org/some/path")).toMatch(
    /^https:\/\/suite.example.org\/chat\/r\/aHR0/,
  );
  const profiles = new Store();
  new ChatNode(ME, profiles, DataFactory).setText(`${NS.FOAF}name`, "Alice");
  await saveChat(pod.fetch, ROOT, `${ROOT}profile/card`, profiles, { ifNoneMatch: "*" });
  const fetch = vi.fn(pod.fetch);
  const cached = new ChatClient(fetch, ROOT, ME);
  expect(await cached.profile(ME)).toBe("Alice");
  expect(await cached.profile(ME)).toBe("Alice");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await cached.profile(BOB)).toBe("bob.example.org/profile/card#me");
  const vcard = `${ROOT}profile/other#me`;
  const dataset = new Store();
  new ChatNode(vcard, dataset, DataFactory).setText(`${NS.FOAF}name`, "   ");
  new ChatNode(vcard, dataset, DataFactory).setText(`${NS.VCARD}fn`, "Other");
  await saveChat(pod.fetch, ROOT, vcard.split("#")[0] as string, dataset, { ifNoneMatch: "*" });
  expect(await loadProfileName(pod.fetch, vcard)).toBe("Other");
  expect(await loadProfileName(pod.fetch, `${room.url}index.ttl`)).toBe(
    "alice.demo.pod/chat/rooms/links/index.ttl",
  );
});
it("lists only safe room files for Drive without fetching link previews", async () => {
  const room = await client.createRoom({ name: "Files", members: [] });
  await pod.fetch(`${room.url}picture.png`, { method: "PUT", body: "image" });
  await pod.fetch(`${room.url}subdir/`, { method: "PUT" });
  await pod.fetch(`${room.url}data.ttl`, { method: "PUT" });
  expect(await client.files(room.url)).toEqual([`${room.url}picture.png`]);
  const malicious = new Store();
  const members = new ChatNode(room.url, malicious, DataFactory).refs(`${NS.LDP}contains`);
  for (const url of [
    "https://other.example/file.png",
    `${room.url}good.png`,
    `${room.url}index.ttl`,
    `${room.url}.acl`,
    `${room.url}subdir/`,
  ])
    members.add(url);
  const { serializeChat } = await import("../src/apps/chat/lib/model");
  const body = await serializeChat(malicious);
  expect(
    await loadRoomFiles(
      async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
      room.url,
    ),
  ).toEqual([`${room.url}good.png`]);
});
it("allows the empty DM name while preserving invalid-name and leave validation", async () => {
  const room = `${ROOT}chat/rooms/dm/`;
  const dataset = buildRoom(room, { name: "", creator: ME, created: NOW, members: [BOB] });
  expect(readRoom(room, dataset)?.name).toBe("");
  expect(() => buildRoom(room, { name: "", creator: ME, created: NOW, members: [] })).toThrow();
  expect(() => buildRoom(room, { name: "   ", creator: ME, created: NOW, members: [] })).toThrow();
  expect(() => leaveRoom("not a URL", dataset, room)).toThrow();
  expect(readJoinedRooms(`${ROOT}chat/rooms.ttl`, new Store())).toEqual([]);
  await expect(
    copyMessageTask(
      pod.fetch,
      ROOT,
      ME,
      {
        id: `${room}2026/11/01.ttl#one`,
        content: "x",
        mediaType: "text/plain",
        updated: undefined,
        tombstone: false,
      },
      { title: "Task", due: new Date("bad") },
    ),
  ).rejects.toThrow();
});
