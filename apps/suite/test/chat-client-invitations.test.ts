// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
import { Parser } from "n3";
import { expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import { MAX_SCAN_REQUESTS } from "../src/apps/chat/lib/client/invitations";
import { createDemoPod } from "../src/lib/demo-pod/pod";

// Public IPs exercise the real pod-access guards without DNS or live networking.
const ROOT = "https://8.8.8.8/";
const ME = `${ROOT}profile#me`;
const BOB = "https://8.8.4.4/profile#me";
const INBOX = `${ROOT}inbox/`;
const AS = "https://www.w3.org/ns/activitystreams#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** Project a delivered Turtle activity (<#it>, relative to the inbox) onto its AS terms. */
function activity(body: string, inbox: string): Record<string, unknown> {
  const quads = new Parser({ baseIRI: inbox }).parse(body);
  const subject = `${inbox}#it`;
  const fields: Record<string, unknown> = {};
  for (const { subject: s, predicate, object } of quads) {
    expect(s.value).toBe(subject);
    const key = predicate.value === RDF_TYPE ? "type" : predicate.value.slice(AS.length);
    fields[key] = predicate.value === RDF_TYPE ? object.value.slice(AS.length) : object.value;
  }
  return fields;
}
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
      expect(new Headers(init.headers).get("content-type")).toBe("text/turtle");
      posts.push(activity(init.body as string, url));
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
/** The rows of one scan. */
const rows = async (client: ChatClient) => (await client.invitations()).invitations;
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
  expect(await rows(client)).toEqual([
    { room, actor: ME, name: "New", verified: true },
    { room: "http://pod.example/chat/rooms/other/", verified: false },
  ]);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("elsewhere"))).toBe(false);
});
it("applies no row cap, reports a cut-off scan and bounds inbox reads", async () => {
  const { client, fetch } = await inboxFixture(
    Array.from({ length: 410 }, (_, i) => offer(`${FOREIGN}chat/rooms/r${i}/`)),
  );
  // Changed: the client returns every candidate the scan read (no unverified cap); `truncated`
  // means only that the scan itself was cut off. The scan reads at most 300 children.
  const scanned = await client.invitations();
  expect(scanned.invitations).toHaveLength(300);
  expect(scanned.truncated).toBe(true);
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith("index.ttl"))).toBe(false);
  expect(
    fetch.mock.calls.filter(([url]) => /^https:\/\/8\.8\.8\.8\/inbox\/\d+\.ttl$/.test(String(url))),
  ).toHaveLength(300);
});
const published = (day: number) =>
  `; as:published "2026-11-${String(day).padStart(2, "0")}T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
it("finds a genuine invitation behind more than 100 junk inbox items", async () => {
  const { client } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(room);
  // Genuine Offer is listed last and is the oldest, so it falls beyond the first 100 children.
  await writeInbox(client, [
    ...Array.from({ length: 150 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/junk${i}/`, published(20)),
    ),
    offer(room, `; as:actor <${BOB}>${published(1)}`),
  ]);
  expect(await rows(client)).toContainEqual({ room, actor: BOB, name: "Real", verified: true });
});
it("does not let a flood of newer foreign Offers hide a verified invitation", async () => {
  const { client } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(room);
  const spammer = "https://6.6.6.6/profile#me";
  await writeInbox(client, [
    offer(room, `; as:actor <${BOB}>${published(1)}`),
    ...Array.from({ length: 60 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/spam${i}/`, `; as:actor <${spammer}>${published(10)}`),
    ),
  ]);
  const found = await client.invitations();
  expect(found.invitations).toContainEqual({ room, actor: BOB, name: "Real", verified: true });
  // Changed: no unverified cap in the client; every forged row is returned after the verified one.
  expect(found.invitations.filter((item) => item.actor === spammer)).toHaveLength(60);
  expect(found.invitations[0]).toEqual({ room, actor: BOB, name: "Real", verified: true });
  expect(found.truncated).toBe(false);
});
it("keys no limit on the claimed actor: varied or spoofed actors hide no genuine invitation", async () => {
  const { client, fetch } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(room);
  const real = await client.createRoom({ name: "Mine", members: [BOB] });
  await client.leave(real.url);
  const Bob2 = "https://5.5.5.5/profile#me";
  const foreignReal = `${FOREIGN}chat/rooms/genuine/`;
  await writeInbox(client, [
    // Genuine and oldest: an own-pod room and a cross-pod invitation from BOB.
    offer(room, `; as:actor <${BOB}>${published(1)}`),
    offer(foreignReal, `; as:actor <${Bob2}>${published(1)}`),
    // 1: newer foreign Offers, each with a different made-up actor (within the global cap).
    ...Array.from({ length: 5 }, (_, i) =>
      offer(
        `${FOREIGN}chat/rooms/vary${i}/`,
        `; as:actor <https://7.7.7.${i}/p#me>${published(10)}`,
      ),
    ),
    // 2: newer foreign Offers spoofing BOB2, whose genuine Offer is the oldest.
    ...Array.from({ length: 8 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/spoof${i}/`, `; as:actor <${Bob2}>${published(11)}`),
    ),
    // 3: 25 newer own-pod claims for non-existent rooms spoofing BOB.
    ...Array.from({ length: 25 }, (_, i) =>
      offer(`${ROOT}chat/rooms/forged${i}/`, `; as:actor <${BOB}>${published(12)}`),
    ),
    // 4: 120 newer own-pod claims with distinct slugs and distinct actors.
    ...Array.from({ length: 120 }, (_, i) =>
      offer(
        `${ROOT}chat/rooms/fake${i}/`,
        `; as:actor <https://4.4.${i % 250}.1/p#me>${published(13)}`,
      ),
    ),
  ]);
  const before = fetch.mock.calls.length;
  const found = await client.invitations();
  expect(found.invitations).toContainEqual({ room, actor: BOB, name: "Real", verified: true });
  expect(found.invitations.map((item) => item.room)).toContain(foreignReal);
  // Forged claims for rooms that do not exist cost no room check.
  const indexReads = fetch.mock.calls
    .slice(before)
    .filter(([url]) => String(url).endsWith("/index.ttl"));
  expect(indexReads).toHaveLength(1);
  expect(indexReads[0]?.[0]).toBe(`${room}index.ttl`);
});
it("lists a verified invitation first among many unverified Offers", async () => {
  const { client } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(room);
  await writeInbox(client, [
    offer(room, `; as:actor <${BOB}>${published(1)}`),
    ...Array.from({ length: 40 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/n${i}/`, `; as:actor <https://3.3.3.${i}/p#me>${published(10)}`),
    ),
  ]);
  const found = await client.invitations();
  expect(found.invitations).toContainEqual({ room, actor: BOB, name: "Real", verified: true });
  // Changed: all 40 unverified rows are returned (the UI folds them), after the verified row.
  expect(found.invitations).toHaveLength(41);
  expect(found.invitations[0]?.verified).toBe(true);
  expect(found.truncated).toBe(false);
});
it("bounds room checks by the user's own existing rooms and the scan's total requests", async () => {
  const { client, fetch } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "Real", members: [BOB] });
  await client.leave(room);
  await writeInbox(client, [
    offer(room, `; as:actor <${BOB}>${published(1)}`),
    ...Array.from({ length: 150 }, (_, i) =>
      offer(`${ROOT}chat/rooms/ghost${i}/`, `; as:actor <${BOB}>${published(10)}`),
    ),
    ...Array.from({ length: 200 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/f${i}/`, `; as:actor <${BOB}>${published(11)}`),
    ),
  ]);
  const before = fetch.mock.calls.length;
  const found = await client.invitations();
  expect(found.invitations).toContainEqual({ room, actor: BOB, name: "Real", verified: true });
  // Final bound per scan: joined rooms (1) + rooms listing (1) + inbox listing (1) + at most
  // INBOX_SCAN_LIMIT inbox children + at most MAX_ROOM_CHECKS room indexes, plus discovery (<= 2).
  const requests = fetch.mock.calls.length - before;
  expect(requests).toBeLessThanOrEqual(MAX_SCAN_REQUESTS + 2);
  expect(
    fetch.mock.calls.slice(before).filter(([url]) => String(url).endsWith("/index.ttl")),
  ).toHaveLength(1);
});
it("returns every verified row and reports the room-check budget as truncated", async () => {
  const { client, fetch } = await inboxFixture([]);
  const real: string[] = [];
  for (let i = 0; i < 51; i++) {
    const { url } = await client.createRoom({ name: `R${i}`, members: [BOB] });
    await client.leave(url);
    real.push(url);
  }
  const empty = Array.from({ length: 60 }, (_, i) => `${ROOT}chat/rooms/empty${i}/`);
  for (const url of empty)
    await client.fetch(`${url}index.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
  await writeInbox(client, [
    ...real.map((url) => offer(url, `; as:actor <${BOB}>${published(20)}`)),
    ...empty.map((url) => offer(url, `; as:actor <${BOB}>${published(10)}`)),
  ]);
  const before = fetch.mock.calls.length;
  const found = await client.invitations();
  // Changed: no 50-row cap on verified rows; all 51 genuine rooms are returned, and the room-check
  // budget (100 of 111 listed rooms) still reports a cut-off scan, and the 11 unchecked rooms
  // are returned as unverified rows after the verified ones.
  expect(found.invitations).toHaveLength(62);
  expect(found.invitations.filter((item) => item.verified)).toHaveLength(51);
  expect(found.invitations.slice(0, 51).every((item) => item.verified)).toBe(true);
  expect(found.truncated).toBe(true);
  // 111 existing claimed rooms, but only 100 indexes are read.
  expect(
    fetch.mock.calls.slice(before).filter(([url]) => String(url).endsWith("/index.ttl")),
  ).toHaveLength(100);
});
it("reports an inbox with more children than the scan reads as truncated", async () => {
  const { client } = await inboxFixture(
    Array.from({ length: 301 }, (_, i) => offer(`${FOREIGN}chat/rooms/t${i}/`)),
  );
  expect((await client.invitations()).truncated).toBe(true);
  const small = await inboxFixture([offer(`${FOREIGN}chat/rooms/one/`)]);
  expect((await small.client.invitations()).truncated).toBe(false);
});
it("handles missing inboxes, surfaces read errors and cancels reads", async () => {
  expect(await rows(fixture().client)).toEqual([]);
  expect(await rows((await inboxFixture([], 404)).client)).toEqual([]);
  await expect((await inboxFixture([], 503)).client.invitations()).rejects.toMatchObject({
    status: 503,
  });
  const { client } = await inboxFixture([offer(`${FOREIGN}chat/rooms/new/`)]);
  await expect(client.invitations({ signal: AbortSignal.abort() })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(
    (await client.invitations({ signal: new AbortController().signal })).invitations,
  ).toHaveLength(1);
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
  // Rooms must exist in the owner's listing to be checked; their indexes are faked above.
  for (const slug of ["forbidden", "gone", "down", "expired", "slow", "offline"])
    await client.fetch(`${ROOT}chat/rooms/${slug}/index.ttl`, {
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
  expect(await rows(reader)).toEqual([
    // Changed: verified rows first; unverified own-pod rows, then foreign ones, by room URL.
    { room: real, actor: BOB, name: "Real", verified: true },
    { room: `${ROOT}chat/rooms/down/`, actor: BOB, verified: false },
    { room: `${ROOT}chat/rooms/expired/`, actor: BOB, verified: false },
    { room: `${ROOT}chat/rooms/offline/`, verified: false },
    { room: `${ROOT}chat/rooms/slow/`, actor: BOB, verified: false },
    { room: `${FOREIGN}chat/rooms/far/`, actor: BOB, verified: false },
  ]);
  const first = rooms(fetch.mock.calls) - before;
  // Missing and loaded rooms stay cached; unreachable ones are retried on the next scan.
  down = false;
  expect((await rows(reader)).map((invitation) => invitation.room)).toEqual([
    real,
    `${ROOT}chat/rooms/expired/`,
    `${ROOT}chat/rooms/offline/`,
    `${ROOT}chat/rooms/slow/`,
    `${FOREIGN}chat/rooms/far/`,
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
  expect(await rows(client)).toEqual([{ room, actor: BOB, name: "Club", verified: true }]);
  // Rooms the inbox no longer offers leave the check cache.
  for (const index of [2, 3])
    expect((await pod.fetch(`${INBOX}${index}.ttl`, { method: "DELETE" })).ok).toBe(true);
  expect(await rows(client)).toEqual([{ room, actor: BOB, name: "Club", verified: true }]);
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
  expect((await second).invitations).toEqual([{ room, verified: false }]);
  expect((await third).invitations).toEqual([{ room, verified: false }]);
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
  expect((await next).invitations).toEqual([{ room, verified: false }]);
});

it("returns a genuine foreign invitation hidden by 25 newer forged ones, and keeps all of them", async () => {
  const { client } = await inboxFixture([]);
  const genuine = `${FOREIGN}chat/rooms/genuine/`;
  await writeInbox(client, [
    offer(genuine, `; as:actor <${BOB}>${published(1)}`),
    ...Array.from({ length: 25 }, (_, i) =>
      offer(`${FOREIGN}chat/rooms/forged${i}/`, `; as:actor <${BOB}>${published(20)}`),
    ),
  ]);
  const found = await client.invitations();
  expect(found.invitations).toHaveLength(26);
  expect(found.invitations).toContainEqual({ room: genuine, actor: BOB, verified: false });
  expect(found.invitations.every((item) => !item.verified)).toBe(true);
  expect(found.truncated).toBe(false);
  expect(found.ownUnchecked).toBe(false);
  // Unverified rows are ordered by room URL, not by the poster's date.
  const order = found.invitations.map((item) => item.room);
  expect(order).toEqual([...order].sort());
});

it("keeps a verified invitation with an empty room name verified", async () => {
  const { client } = await inboxFixture([]);
  const { url: room } = await client.createRoom({ name: "", members: [BOB] });
  await client.leave(room);
  await writeInbox(client, [
    offer(room, `; as:actor <${BOB}>${published(1)}`),
    ...Array.from({ length: 30 }, (_, i) => offer(`${FOREIGN}chat/rooms/e${i}/`, published(10))),
  ]);
  const found = await client.invitations();
  expect(found.invitations[0]).toEqual({ room, actor: BOB, name: "", verified: true });
  expect(found.invitations).toHaveLength(31);
});

const LISTING = `${ROOT}chat/rooms/`;
it.each([
  ["403", () => new Response(null, { status: 403 })],
  ["503", () => new Response(null, { status: 503 })],
  ["non-RDF", () => new Response("<html></html>", { headers: { "content-type": "text/html" } })],
  [
    "oversized",
    () =>
      new Response(`# ${"x".repeat(1024 * 1024 + 10)}\n`, {
        headers: { "content-type": "text/turtle" },
      }),
  ],
])("degrades when the own rooms listing fails (%s): foreign rows stay, own claims are unverified", async (_name, failure) => {
  const { client: owner } = await inboxFixture([]);
  const { url: real } = await owner.createRoom({ name: "Real", members: [BOB] });
  await owner.leave(real);
  const foreign = `${FOREIGN}chat/rooms/far/`;
  const ghost = `${ROOT}chat/rooms/ghost/`;
  await writeInbox(owner, [
    offer(real, `; as:actor <${BOB}>${published(1)}`),
    offer(ghost, published(2)),
    offer(foreign, `; as:actor <${BOB}>${published(3)}`),
  ]);
  const transport: typeof globalThis.fetch = (input, init) =>
    String(input) === LISTING && (init?.method ?? "GET") === "GET"
      ? Promise.resolve(failure())
      : owner.fetch(input, init);
  const found = await new ChatClient(transport, ROOT, ME).invitations();
  expect(found.ownUnchecked).toBe(true);
  expect(found.invitations.find((item) => item.room === ghost)).toStrictEqual({
    room: ghost,
    verified: false,
  });
  expect(found.invitations.every((item) => !item.verified)).toBe(true);
  expect(found.invitations.map((item) => item.room).sort()).toEqual([ghost, real, foreign].sort());
});

it("builds the rooms listing URL from a storage root without a trailing slash", async () => {
  const { client, fetch } = await inboxFixture([]);
  const storage = `${ROOT}pod`;
  await writeInbox(client, [offer(`${storage}/chat/rooms/x/`, `; as:actor <${BOB}>`)]);
  const found = await new ChatClient(fetch, storage, ME).invitations();
  expect(found.ownUnchecked).toBe(false);
  expect(fetch.mock.calls.some(([url]) => String(url) === `${storage}/chat/rooms/`)).toBe(true);
});
