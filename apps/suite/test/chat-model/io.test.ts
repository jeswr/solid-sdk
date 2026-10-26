// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { expect, it } from "vitest";
import {
  appendMessage,
  ChatIoError,
  ChatModelError,
  createRoom,
  dayUrl,
  deleteOwnMessage,
  joinedRoomsUrl,
  loadChat,
  loadMessages,
  loadRoom,
  loadRooms,
  messageSubject,
  NS,
  parseChat,
  readJoinedRooms,
  readMessages,
  readRoom,
  roomIndex,
  saveChat,
  saveJoinedRoom,
  saveMessageEdit,
  saveMessageTask,
  sendMessage,
  serializeChat,
  type WriteCondition,
} from "../../src/apps/chat/lib/model";

const storage = "https://alice.example/pod/";
const room = `${storage}chat/rooms/team/`;
const alice = "https://alice.example/profile#me";
const bob = "https://bob.example/profile#me";
const at = new Date("2026-10-26T11:00:00Z");
const input = { id: "m1", author: alice, content: "hello", at };
const subject = messageSubject(room, at, "m1");
const roomInput = { name: "Team", creator: alice, created: at, members: [bob] };
type Fault = (url: string, method: string, init: RequestInit) => Response | undefined;
/** In-memory HTTP fixture enforces every write precondition and applies insert-only RDF patches. */
function pod() {
  const files = new Map<string, { body: string; etag: string | null }>();
  const calls: { url: string; method: string; init: RequestInit }[] = [];
  let fault: Fault | undefined;
  let version = 0;
  const fetch: typeof globalThis.fetch = async (target, init = {}) => {
    const url = String(target);
    const method = init.method ?? "GET";
    calls.push({ url, method, init });
    expect(init.redirect).toBe("manual");
    const overridden = fault?.(url, method, init);
    if (overridden) return overridden;
    const headers = new Headers(init.headers);
    const existing = files.get(url);
    if (method === "GET")
      return existing
        ? new Response(existing.body, {
            headers: {
              "content-type": "text/turtle",
              ...(existing.etag === null ? {} : { etag: existing.etag }),
            },
          })
        : new Response(null, { status: 404 });
    if (headers.get("if-none-match") === "*") {
      if (existing)
        return new Response(null, { status: 412, headers: { etag: existing.etag ?? '"server"' } });
    } else if (headers.has("if-match")) {
      if (headers.get("if-match") !== existing?.etag)
        return new Response(null, { status: 412, headers: { etag: '"current"' } });
    } else throw new Error("Unconditional write");
    let body = String(init.body);
    if (method === "PATCH") {
      expect(headers.get("content-type")).toBe("application/sparql-update");
      expect(body.startsWith("INSERT DATA {\n")).toBe(true);
      const delta = await parseChat(
        body.slice("INSERT DATA {\n".length, -2),
        url,
        "application/n-triples",
      );
      const original = await parseChat(existing?.body ?? "", url);
      expect([...delta].every((q) => q.subject.value === messageSubject(room, at, "m2"))).toBe(
        true,
      );
      original.addQuads([...delta]);
      body = await serializeChat(original);
    } else expect(method).toBe("PUT");
    if (url.endsWith("/")) body = `<${url}> a <${NS.LDP}BasicContainer>, <${NS.LDP}Container>.`;
    const etag = `"${++version}"`;
    files.set(url, { body, etag });
    return new Response(null, { status: 201, headers: { etag, link: '<.acl>; rel="acl"' } });
  };
  return {
    fetch,
    files,
    calls,
    setFault(value: Fault | undefined) {
      fault = value;
    },
  };
}
async function seedDay(p: ReturnType<typeof pod>, etag: string | null = '"seed"') {
  p.files.set(dayUrl(room, at), {
    body: await serializeChat(appendMessage(new Store(), room, input)),
    etag,
  });
}

it("creates a room's container, advertised ACL, and descriptor without public or member Write grants", async () => {
  const p = pod();
  const result = await createRoom(p.fetch, storage, "team", roomInput);
  expect(result.url).toBe(roomIndex(room));
  expect(readRoom(room, result.dataset)?.members).toEqual([alice, bob]);
  expect(p.calls.map((call) => call.url)).toEqual([
    `${storage}chat/`,
    `${storage}chat/rooms/`,
    room,
    `${room}.acl`,
    roomIndex(room),
  ]);
  expect(p.files.get(`${room}.acl`)?.body).toContain(`${NS.ACL}Append`);
  expect(p.files.get(`${room}.acl`)?.body).not.toContain(`${NS.FOAF}Agent`);
  expect(new Headers(p.calls.at(-1)?.init.headers).get("if-none-match")).toBe("*");
  const loaded = await loadRoom(p.fetch, room);
  expect(loaded.room?.name).toBe("Team");
  expect(loaded.etag).toBe(result.etag);
  await expect(createRoom(p.fetch, storage, "team", roomInput)).rejects.toMatchObject({
    status: 412,
  });
  // Existing parent containers are read and verified, not replaced.
  expect(p.calls.some((call) => call.method === "GET" && call.url === `${storage}chat/`)).toBe(
    true,
  );
});

it("fails closed on missing, empty or escaping ACL links and propagates ACL/descriptor errors", async () => {
  for (const link of [
    undefined,
    '<.acl>; rel="acl"',
    '<https://evil.example/.acl>; rel="acl"',
    '<>; rel="acl"',
  ]) {
    const p = pod();
    p.setFault((url, method) =>
      url === room && method === "PUT"
        ? new Response(null, { status: 201, headers: link === undefined ? {} : { link } })
        : undefined,
    );
    if (link === '<.acl>; rel="acl"') {
      p.setFault((url, method) =>
        url === `${room}.acl` && method === "PUT" ? new Response(null, { status: 403 }) : undefined,
      );
      await expect(createRoom(p.fetch, storage, "team", roomInput)).rejects.toMatchObject({
        status: 403,
      });
    } else await expect(createRoom(p.fetch, storage, "team", roomInput)).rejects.toThrow();
    expect(p.files.has(roomIndex(room))).toBe(false);
  }
  const p = pod();
  p.setFault((url) => (url === roomIndex(room) ? new Response(null, { status: 507 }) : undefined));
  await expect(createRoom(p.fetch, storage, "team", roomInput)).rejects.toMatchObject({
    status: 507,
  });
  const invalid = pod();
  await expect(createRoom(invalid.fetch, storage, "../x", roomInput)).rejects.toThrow();
  expect(invalid.calls).toHaveLength(0);
});

it("uses absolute or relative advertised ACL URLs and preserves an existing ACL on 412", async () => {
  const p = pod();
  const acl = `${storage}chat/room-policy.ttl`;
  p.setFault((url) =>
    url === room
      ? new Response(null, {
          status: 201,
          headers: { link: `<${acl}>; rel=acl; type="text/turtle"` },
        })
      : undefined,
  );
  await createRoom(p.fetch, storage, "team", roomInput);
  expect(p.files.has(acl)).toBe(true);
  const denied = pod();
  denied.files.set(`${room}.acl`, { body: "existing", etag: '"old"' });
  await expect(createRoom(denied.fetch, storage, "team", roomInput)).rejects.toMatchObject({
    status: 412,
  });
  expect(denied.files.get(`${room}.acl`)?.body).toBe("existing");
});

it("rejects a non-container at an existing parent URL", async () => {
  const p = pod();
  p.files.set(`${storage}chat/`, { body: "", etag: '"old"' });
  await expect(createRoom(p.fetch, storage, "team", roomInput)).rejects.toThrow(ChatModelError);
  const failure = pod();
  failure.setFault((url) =>
    url === `${storage}chat/` ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(createRoom(failure.fetch, storage, "team", roomInput)).rejects.toMatchObject({
    status: 403,
  });
});

it("joins rooms locally with create/If-Match, keeps other joins, and makes repeated joins idempotent", async () => {
  const p = pod();
  expect((await loadRooms(p.fetch, storage)).rooms).toEqual([]);
  const first = await saveJoinedRoom(p.fetch, storage, room);
  expect(readJoinedRooms(first.url, first.dataset)).toEqual([room]);
  const remote = "https://bob.example/chat/rooms/shared/";
  const second = await saveJoinedRoom(p.fetch, storage, remote);
  expect(readJoinedRooms(second.url, second.dataset)).toEqual([room, remote]);
  expect((await loadRooms(p.fetch, storage)).rooms).toEqual([room, remote]);
  const writes = p.calls.filter((call) => call.method === "PUT").length;
  await saveJoinedRoom(p.fetch, storage, remote);
  expect(p.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
  expect(p.calls.every((call) => call.url.startsWith(storage))).toBe(true);
  p.files.set(joinedRoomsUrl(storage), { body: "", etag: null });
  await expect(saveJoinedRoom(p.fetch, storage, remote)).rejects.toThrow("missing-etag");
});

it("creates today's resource and dated parents, then appends only the new message with a strong If-Match", async () => {
  const p = pod();
  const first = await sendMessage(p.fetch, room, input);
  expect(readMessages(first.dataset)[0]?.content).toBe("hello");
  expect(p.files.has(`${room}2026/`)).toBe(true);
  expect(p.files.has(`${room}2026/10/`)).toBe(true);
  const second = await sendMessage(p.fetch, room, {
    ...input,
    id: "m2",
    author: bob,
    content: "reply",
  });
  const patch = p.calls.find((call) => call.method === "PATCH");
  expect(new Headers(patch?.init.headers).get("if-match")).toBe(first.etag);
  expect(readMessages(second.dataset)).toHaveLength(2);
  expect(readMessages((await loadChat(p.fetch, room, dayUrl(room, at))).dataset)).toHaveLength(2);
  expect(second.etag).not.toBe(first.etag);
  const count = p.calls.length;
  await expect(sendMessage(p.fetch, room, { ...input, content: " " })).rejects.toThrow();
  expect(p.calls).toHaveLength(count);
  await expect(sendMessage(p.fetch, room, input)).rejects.toThrow("duplicate");
});

it("validates existing dated parents and never overwrites conflicting creations or appends", async () => {
  const p = pod();
  for (const url of [`${room}2026/`, `${room}2026/10/`])
    p.files.set(url, { body: `<${url}> a <${NS.LDP}Container>.`, etag: '"old"' });
  await sendMessage(p.fetch, room, input);
  p.setFault((url, method) =>
    url === dayUrl(room, at) && method === "PATCH"
      ? new Response(null, { status: 412, headers: { etag: '"current"' } })
      : undefined,
  );
  await expect(sendMessage(p.fetch, room, { ...input, id: "m2" })).rejects.toMatchObject({
    status: 412,
    etag: '"current"',
  });
  expect(p.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  const create = pod();
  create.setFault((url, method) =>
    url === dayUrl(room, at) && method === "PUT" ? new Response(null, { status: 412 }) : undefined,
  );
  await expect(sendMessage(create.fetch, room, input)).rejects.toMatchObject({
    status: 412,
    etag: null,
  });
  const noTag = pod();
  await seedDay(noTag, null);
  await expect(sendMessage(noTag.fetch, room, { ...input, id: "m2" })).rejects.toThrow(
    "missing-etag",
  );
  expect(noTag.calls).toHaveLength(1);
});

it("conditionally saves own edits, task overlays and tombstones in their original day", async () => {
  const p = pod();
  await seedDay(p);
  const later = new Date("2026-10-28T10:00:00Z");
  const edited = await saveMessageEdit(p.fetch, room, subject, alice, "edited", later);
  expect(readMessages(edited.dataset)[0]?.updated).toBe(later.toISOString());
  expect(edited.url).toBe(dayUrl(room, at));
  const task = await saveMessageTask(
    p.fetch,
    room,
    subject,
    alice,
    { state: "open", title: "Do it" },
    later,
  );
  expect(readMessages(task.dataset)[0]?.task?.title).toBe("Do it");
  const deleted = await deleteOwnMessage(p.fetch, room, subject, alice, later);
  expect(readMessages(deleted.dataset)[0]?.tombstone).toBe(true);
  expect(readMessages((await loadChat(p.fetch, room, edited.url)).dataset)[0]?.content).toBe("");
  const writes = p.calls.filter((call) => call.method === "PUT");
  expect(writes).toHaveLength(3);
  expect(writes.every((call) => new Headers(call.init.headers).has("if-match"))).toBe(true);
});

it("enforces author, validator and scope checks before any mutation write", async () => {
  const p = pod();
  await seedDay(p);
  await expect(saveMessageEdit(p.fetch, room, subject, bob, "forged", at)).rejects.toThrow(
    "not-author",
  );
  expect(p.calls).toHaveLength(1);
  const entry = p.files.get(dayUrl(room, at)) as { body: string; etag: string | null };
  entry.etag = null;
  await expect(deleteOwnMessage(p.fetch, room, subject, alice, at)).rejects.toThrow("missing-etag");
  const count = p.calls.length;
  await expect(
    deleteOwnMessage(p.fetch, room, "https://evil.example/2026/10/26.ttl#it", alice, at),
  ).rejects.toThrow();
  expect(p.calls).toHaveLength(count);
  entry.etag = '"old"';
  p.setFault((url, method) =>
    url === dayUrl(room, at) && method === "PUT" ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(saveMessageEdit(p.fetch, room, subject, alice, "edited", at)).rejects.toMatchObject({
    status: 403,
  });
  expect(readMessages(await parseChat(entry.body, dayUrl(room, at)))[0]?.content).toBe("hello");
});

it("pages backwards across missing days and sorts the messages chronologically", async () => {
  const p = pod();
  await seedDay(p);
  const yesterday = new Date("2026-10-24T11:00Z");
  p.files.set(dayUrl(room, yesterday), {
    body: await serializeChat(appendMessage(new Store(), room, { ...input, at: yesterday })),
    etag: '"older"',
  });
  const page = await loadMessages(p.fetch, room, at, yesterday, 2);
  expect(page.documents).toHaveLength(2);
  expect(page.messages).toHaveLength(1);
  expect(page.next?.toISOString()).toBe("2026-10-24T00:00:00.000Z");
  const all = await loadMessages(p.fetch, room, at, yesterday, 3);
  expect(all.messages.map((m) => m.published)).toEqual([yesterday.toISOString(), at.toISOString()]);
  expect(all.next).toBeNull();
  expect(all.documents[0]?.etag).toBe('"seed"');
  // Multiple messages in one day exercise equal-time ID ordering too.
  p.files.set(dayUrl(room, at), {
    body: await serializeChat(
      appendMessage(appendMessage(new Store(), room, input), room, { ...input, id: "m2" }),
    ),
    etag: '"two"',
  });
  expect((await loadMessages(p.fetch, room, at, at, 1)).messages.map((m) => m.id)).toEqual([
    subject,
    `${dayUrl(room, at)}#m2`,
  ]);
});

it("propagates read, parse, network and permission errors rather than treating them as empty", async () => {
  for (const status of [401, 403, 500]) {
    const p = pod();
    p.setFault(() => new Response(null, { status }));
    await expect(loadRooms(p.fetch, storage)).rejects.toMatchObject({ status });
    await expect(loadMessages(p.fetch, room, at, at, 1)).rejects.toMatchObject({ status });
    await expect(sendMessage(p.fetch, room, input)).rejects.toMatchObject({ status });
  }
  const p = pod();
  p.files.set(dayUrl(room, at), { body: "invalid turtle !", etag: '"x"' });
  await expect(loadMessages(p.fetch, room, at, at, 1)).rejects.toThrow();
  const network: typeof fetch = async () => {
    throw new TypeError("network unavailable");
  };
  await expect(sendMessage(network, room, input)).rejects.toThrow();
});

it("refuses cross-scope requests, redirects and invalid preconditions without write side effects", async () => {
  const p = pod();
  await expect(loadChat(p.fetch, room, "https://evil.example/a")).rejects.toThrow();
  await expect(
    saveChat(p.fetch, room, `${room}x.ttl`, new Store(), { ifMatch: "*" }),
  ).rejects.toThrow("missing-etag");
  await expect(
    saveChat(p.fetch, room, `${room}x.ttl`, new Store(), {
      ifNoneMatch: "no",
    } as unknown as WriteCondition),
  ).rejects.toThrow("invalid-input");
  expect(p.calls).toHaveLength(0);
  p.setFault(
    () => new Response(null, { status: 302, headers: { location: "https://evil.example/a" } }),
  );
  await expect(loadChat(p.fetch, room, roomIndex(room))).rejects.toThrow();
  expect(p.calls).toHaveLength(1);
  expect(p.calls[0]?.url).toBe(roomIndex(room));
  expect(new ChatIoError(412, '"tag"').message).toBe("Chat request failed (412)");
});

it("sorts undated imported messages by ID before dated messages", async () => {
  const p = pod();
  p.files.set(dayUrl(room, at), {
    body: `<#z> a <${NS.AS}Note>. <#a> a <${NS.AS}Note>.`,
    etag: '"import"',
  });
  expect(
    (await loadMessages(p.fetch, room, at, at, 1)).messages.map((message) => message.id),
  ).toEqual([`${dayUrl(room, at)}#a`, `${dayUrl(room, at)}#z`]);
});
