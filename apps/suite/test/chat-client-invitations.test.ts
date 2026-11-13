// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";

// Public IPs exercise the real pod-access guards without DNS or live networking.
const ROOT = "https://8.8.8.8/";
const ME = `${ROOT}profile#me`;
const BOB = "https://8.8.4.4/profile#me";
const INBOX = `${ROOT}inbox/`;
const ttl = (body: string) => new Response(body, { headers: { "content-type": "text/turtle" } });
function fixture() {
  const pod = createDemoPod({ root: ROOT });
  const posts: Record<string, unknown>[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST" && !url.startsWith(ROOT)) {
      const resources = pod.snapshot().resources;
      for (const suffix of ["/index.ttl", "/rooms.ttl", "/.acl"])
        expect(resources.some(([url]) => url.endsWith(suffix))).toBe(true);
      posts.push(JSON.parse(init.body as string));
      return new Response(null, { status: 201 });
    }
    if (!url.startsWith(ROOT))
      return ttl(`<${url}#me> <http://www.w3.org/ns/ldp#inbox> <${new URL("inbox/", url)}>.`);
    return pod.fetch(input, init);
  });
  return { pod, fetch, posts, client: new ChatClient(fetch, ROOT, ME, fetch, "Alice") };
}
async function inboxFixture(items: string[], status = 200) {
  const { pod, client, fetch } = fixture();
  await pod.fetch(`${ROOT}profile`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `<${ME}> <http://www.w3.org/ns/ldp#inbox> <${INBOX}>.`,
  });
  await pod.fetch(INBOX, { method: "PUT" });
  for (const [index, body] of items.entries())
    await pod.fetch(`${INBOX}${index}.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body,
    });
  const transport: typeof globalThis.fetch = (input, init) =>
    String(input) === INBOX && status !== 200
      ? Promise.resolve(new Response(null, { status }))
      : fetch(input, init);
  return { pod, client: status === 200 ? client : new ChatClient(transport, ROOT, ME), fetch };
}
const FOREIGN = "https://8.8.4.4/";
/** Replace the inbox's members after the fixture has written rooms. */
async function writeInbox(client: ChatClient, items: string[]) {
  for (const [index, body] of items.entries())
    await client.fetch(`${INBOX}${index}.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body,
    });
}
const offer = (object?: string, extra = "", kind = "Offer") =>
  `@prefix as: <https://www.w3.org/ns/activitystreams#>. <#it> a as:${kind}${object ? `; as:object <${object}>` : ""}${extra}.`;

it("sends a pod-access Offer to every distinct non-creator member after writes succeed", async () => {
  const { client, posts } = fixture();
  const members = [ME, BOB, "https://1.1.1.1/profile#me", BOB];
  const room = await client.createRoom({ name: "Book club", members });
  expect(room.invitations).toEqual([
    { webId: members[2], delivered: true },
    { webId: BOB, delivered: true },
  ]);
  expect(posts).toHaveLength(2);
  for (const post of posts)
    expect(post).toMatchObject({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Offer",
      actor: ME,
      object: room.url,
      summary: "Alice invited you to Book club",
      published: expect.any(String),
    });
});
it("reports missing, forbidden and down inboxes without failing creation", async () => {
  const { fetch } = fixture();
  const members = [BOB, "https://1.1.1.1/profile#me", "https://9.9.9.9/profile#me"];
  const transport: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === BOB.split("#")[0]) return ttl("");
    if (init?.method === "POST")
      return new Response(null, { status: url.includes("1.1.1.1") ? 403 : 503 });
    return fetch(input, init);
  };
  const client = new ChatClient(transport, ROOT, ME);
  const room = await client.createRoom({ name: "Failures", members });
  expect(room.invitations).toEqual(
    expect.arrayContaining(
      members.map((webId, i) => ({
        webId,
        delivered: false,
        reason: ["no-inbox", "forbidden", "network"][i],
      })),
    ),
  );
  expect((await client.joinedRooms()).map((room) => room.url)).toEqual([room.url]);
});
it("sends nothing on failed creation, failed join or pre-abort", async () => {
  const { fetch, posts } = fixture();
  for (const failAt of ["index.ttl", "rooms.ttl"]) {
    const transport: typeof globalThis.fetch = (input, init) =>
      String(input).endsWith(failAt) && init?.method === "PUT"
        ? Promise.resolve(new Response(null, { status: 503 }))
        : fetch(input, init);
    await expect(
      new ChatClient(transport, ROOT, ME).createRoom({ name: failAt, members: [BOB] }),
    ).rejects.toMatchObject({ status: 503 });
  }
  const client = new ChatClient(fetch, ROOT, ME);
  const signal = AbortSignal.abort();
  await expect(
    client.createRoom({ name: "Aborted", members: [BOB], signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(client.createDirect(BOB, { signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(posts).toEqual([]);
});
it("invites to a DM only when this client creates it", async () => {
  const { client, posts } = fixture();
  const room = await client.createDirect(BOB, { signal: new AbortController().signal });
  expect(room.invitations).toEqual([{ webId: BOB, delivered: true }]);
  expect(posts[0]?.summary).toBe("Alice started a conversation with you");
  expect((await client.createDirect(BOB)).invitations).toEqual([]);
  await client.leave(room.url);
  expect((await client.createDirect(BOB)).invitations).toEqual([]);
  expect(posts).toHaveLength(1);
});
it("bounds delivery to four and aborts without failing a completed creation", async () => {
  const { fetch } = fixture();
  const controller = new AbortController();
  const members = Array.from({ length: 9 }, (_, i) => `https://8.8.4.4/p${i}#me`);
  let active = 0;
  let peak = 0;
  const transport: typeof globalThis.fetch = async (input, init) => {
    if (init?.method !== "POST") return fetch(input, init);
    active++;
    peak = Math.max(active, peak);
    await new Promise<void>((resolve) => {
      init.signal?.addEventListener("abort", () => resolve(), { once: true });
      if (active === 4) controller.abort();
    });
    active--;
    throw new DOMException("Aborted", "AbortError");
  };
  const result = await new ChatClient(transport, ROOT, ME).createRoom({
    name: "Abort",
    members,
    signal: controller.signal,
  });
  expect(peak).toBe(4);
  expect(result.invitations).toEqual(
    members.map((webId) => ({ webId, delivered: false, reason: "aborted" })),
  );
});
it("filters kinds, unsafe objects and joined rooms, deduplicating newest first", async () => {
  const joined = `${ROOT}chat/rooms/joined/`;
  const { client, fetch } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "New", members: [BOB] });
  await client.leave(room);
  await writeInbox(client, [
    offer(
      room,
      `; as:actor <${BOB}>; as:published "2026-11-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
    ),
    offer(
      `${room}index.ttl#it`,
      `; as:actor <${ME}>; as:published "2026-11-02T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
    ),
    offer(joined),
    offer("https://elsewhere.example/chat/", "", "Announce"),
    offer(),
    ...[
      "urn:room:1",
      "javascript:alert(1)",
      "https://pod.example/file",
      `${ROOT}private/x/`,
      `${ROOT}nested/chat/rooms/evil/`,
      `${ROOT}chat/rooms/nested/evil/`,
      `${room}index.ttl#other`,
      `${room}?secret=1`,
      `${room}index.ttl?secret=1`,
    ].map((url) => offer(url)),
    offer("http://pod.example/chat/rooms/other/index.ttl"),
  ]);
  await client.join(joined);
  expect(await client.invitations()).toEqual([
    { room, actor: ME, name: "New" },
    { room: "http://pod.example/chat/rooms/other/" },
  ]);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("elsewhere"))).toBe(false);
});
it("caps invitations at 50 and bounds inbox reads", async () => {
  const { client, fetch } = await inboxFixture(
    Array.from({ length: 210 }, (_, i) => offer(`${FOREIGN}chat/rooms/r${i}/`)),
  );
  expect(await client.invitations()).toHaveLength(50);
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith("index.ttl"))).toBe(false);
  expect(
    fetch.mock.calls.filter(([url]) => /^https:\/\/8\.8\.8\.8\/inbox\/\d+\.ttl$/.test(String(url))),
  ).toHaveLength(100);
});
it("handles missing inboxes, surfaces read errors and cancels reads", async () => {
  expect(await fixture().client.invitations()).toEqual([]);
  expect(await (await inboxFixture([], 404)).client.invitations()).toEqual([]);
  await expect((await inboxFixture([], 503)).client.invitations()).rejects.toMatchObject({
    status: 503,
  });
  const { client } = await inboxFixture([offer(`${FOREIGN}chat/rooms/new/`)]);
  await expect(client.invitations({ signal: AbortSignal.abort() })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(await client.invitations({ signal: new AbortController().signal })).toHaveLength(1);
});

it("finishes all bounded deliveries and exposes cancellation during inbox discovery", async () => {
  const { fetch, posts } = fixture();
  const members = Array.from({ length: 7 }, (_, i) => `https://8.8.4.4/member${i}#me`);
  const result = await new ChatClient(fetch, ROOT, ME).createRoom({ name: "Many", members });
  expect(result.invitations.every((item) => item.delivered)).toBe(true);
  expect(posts).toHaveLength(7);
  const controller = new AbortController();
  const transport: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === `${ROOT}profile`) controller.abort();
    return fetch(input, init);
  };
  await expect(
    new ChatClient(transport, ROOT, ME).invitations({ signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("reuses one inbox reader and discovery cache across refreshes", async () => {
  const { client, fetch } = await inboxFixture([offer(`${ROOT}chat/rooms/new/`)]);
  await client.invitations();
  await client.invitations();
  expect(fetch.mock.calls.filter(([url]) => String(url) === `${ROOT}profile`)).toHaveLength(1);
});

it("finishes room ACL, index and owner join after cancellation once writes have started", async () => {
  const { fetch } = fixture();
  const controller = new AbortController();
  const transport: typeof globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (String(input).endsWith("/.acl") && init?.method === "PUT") controller.abort();
    return response;
  };
  const client = new ChatClient(transport, ROOT, ME);
  const room = await client.createRoom({
    name: "Finish writes",
    members: [BOB],
    signal: controller.signal,
  });
  expect(room.invitations).toEqual([{ webId: BOB, delivered: false, reason: "aborted" }]);
  expect((await client.joinedRooms()).map((room) => room.url)).toEqual([room.url]);
});

it("invites the peer when resuming an interrupted DM", async () => {
  const { client, pod, posts } = fixture();
  const room = await client.createDirect(BOB);
  await client.leave(room.url);
  await pod.fetch(`${room.url}index.ttl`, { method: "DELETE" });
  const resumed = await client.createDirect(BOB);
  expect(resumed.invitations).toEqual([{ webId: BOB, delivered: true }]);
  expect(posts).toHaveLength(2);
});

const dated = (actor: string, day: number) =>
  `; as:actor <${actor}>; as:published "2026-11-${String(day).padStart(2, "0")}T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;

it("ignores own-pod Offers for rooms whose index fails with a 4xx, and checks each room once", async () => {
  const { client, fetch } = await inboxFixture([]);
  const { url: real } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(real);
  const spam = Array.from({ length: 4 }, (_, i) => `${ROOT}chat/rooms/spam-${i}/`);
  const statuses: Record<string, number> = {
    [`${ROOT}chat/rooms/forbidden/index.ttl`]: 403,
    [`${ROOT}chat/rooms/gone/index.ttl`]: 410,
    [`${ROOT}chat/rooms/down/index.ttl`]: 503,
    [`${ROOT}chat/rooms/expired/index.ttl`]: 401,
    [`${ROOT}chat/rooms/slow/index.ttl`]: 429,
  };
  let down = true;
  const transport: typeof globalThis.fetch = (input, init) => {
    if (String(input) === `${ROOT}chat/rooms/offline/index.ttl`)
      return Promise.reject(new TypeError("Network down"));
    const status = statuses[String(input)];
    return status && (status !== 503 || down)
      ? Promise.resolve(new Response(null, { status }))
      : fetch(input, init);
  };
  const reader = new ChatClient(transport, ROOT, ME);
  await reader.fetch(`${ROOT}chat/rooms/empty/index.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: "",
  });
  await writeInbox(reader, [
    ...spam.map((room, i) => offer(room, dated(BOB, 20 + i))),
    ...["forbidden", "gone", "empty", "down", "expired", "slow"].map((slug, i) =>
      offer(`${ROOT}chat/rooms/${slug}/`, dated(BOB, 10 + i)),
    ),
    offer(`${FOREIGN}chat/rooms/far/`, dated(BOB, 5)),
    offer(real, dated(BOB, 1)),
    offer(`${ROOT}chat/rooms/offline/`),
  ]);
  const rooms = (calls: typeof fetch.mock.calls) =>
    calls.filter(([url, init]) => String(url).endsWith("/index.ttl") && !init?.method).length;
  const before = rooms(fetch.mock.calls);
  expect(await reader.invitations()).toEqual([
    { room: `${ROOT}chat/rooms/slow/`, actor: BOB },
    { room: `${ROOT}chat/rooms/expired/`, actor: BOB },
    { room: `${ROOT}chat/rooms/down/`, actor: BOB },
    { room: `${FOREIGN}chat/rooms/far/`, actor: BOB },
    { room: real, actor: BOB, name: "Real" },
    { room: `${ROOT}chat/rooms/offline/` },
  ]);
  const first = rooms(fetch.mock.calls) - before;
  // Missing and loaded rooms stay cached; unreachable ones are retried on the next scan.
  down = false;
  expect((await reader.invitations()).map((invitation) => invitation.room)).toEqual([
    `${ROOT}chat/rooms/slow/`,
    `${ROOT}chat/rooms/expired/`,
    `${FOREIGN}chat/rooms/far/`,
    real,
    `${ROOT}chat/rooms/offline/`,
  ]);
  expect(rooms(fetch.mock.calls) - before - first).toBe(1);
});

it("checks membership per claimed sender before de-duplicating own-pod rooms", async () => {
  const { client, pod } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Club", members: [BOB] });
  const { url: alone } = await client.createRoom({ name: "Alone", members: [] });
  await client.leave(room);
  await client.leave(alone);
  await writeInbox(client, [
    offer(room, dated("https://forged.example/#me", 9)),
    offer(room, dated(BOB, 2)),
    offer(alone, dated("https://forged.example/#me", 3)),
    offer(alone),
  ]);
  expect(await client.invitations()).toEqual([{ room, actor: BOB, name: "Club" }]);
  // Rooms the inbox no longer offers leave the check cache.
  for (const index of [2, 3])
    expect((await pod.fetch(`${INBOX}${index}.ttl`, { method: "DELETE" })).ok).toBe(true);
  expect(await client.invitations()).toEqual([{ room, actor: BOB, name: "Club" }]);
});

it("shares one scan between concurrent callers, isolating each caller's cancellation", async () => {
  const room = `${FOREIGN}chat/rooms/shared/`;
  const { fetch } = await inboxFixture([offer(room)]);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signals: AbortSignal[] = [];
  let waiting = false;
  const transport: typeof globalThis.fetch = async (input, init) => {
    if (init?.signal) signals.push(init.signal);
    if (String(input) === INBOX) {
      waiting = true;
      await gate;
    }
    return fetch(input, init);
  };
  const client = new ChatClient(transport, ROOT, ME);
  const a = new AbortController();
  const first = client.invitations({ signal: a.signal });
  const second = client.invitations({ signal: new AbortController().signal });
  const third = client.invitations();
  await vi.waitFor(() => expect(waiting).toBe(true));
  a.abort();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  release();
  expect(await second).toEqual([{ room }]);
  expect(await third).toEqual([{ room }]);
  expect(signals.some((signal) => signal.aborted)).toBe(false);
  expect(fetch.mock.calls.filter(([url]) => String(url) === `${ROOT}profile`)).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => String(url) === INBOX)).toHaveLength(1);
});

it("aborts the shared scan once every caller leaves, then starts a fresh one", async () => {
  const room = `${FOREIGN}chat/rooms/fresh/`;
  const { fetch } = await inboxFixture([offer(room)]);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listed: AbortSignal[] = [];
  const transport: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === INBOX && listed.length === 0) {
      listed.push(init?.signal as AbortSignal);
      await gate;
    }
    return fetch(input, init);
  };
  const client = new ChatClient(transport, ROOT, ME);
  const a = new AbortController();
  const b = new AbortController();
  const first = client.invitations({ signal: a.signal });
  const second = client.invitations({ signal: b.signal });
  await vi.waitFor(() => expect(listed).toHaveLength(1));
  a.abort();
  expect(listed[0]?.aborted).toBe(false);
  b.abort();
  expect(listed[0]?.aborted).toBe(true);
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  const next = client.invitations();
  release();
  expect(await next).toEqual([{ room }]);
});
