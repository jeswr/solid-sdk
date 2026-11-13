// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { AclResource, Authorization, Group } from "@solid/object";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import {
  appendMessage,
  appendReaction,
  buildRoom,
  buildRoomAcl,
  buildRoomV2,
  ChatModelError,
  ChatNode,
  createRoom,
  dayUrl,
  deleteOwnMessage,
  documentMember,
  loadChat,
  loadMessages,
  memberContainer,
  memberDocument,
  NS,
  ownContainer,
  parseChat,
  react,
  readMessages,
  readReactions,
  readRoomLayout,
  removeMessage,
  roomIndex,
  saveChat,
  saveMessageEdit,
  saveMessageTask,
  sendMessage,
  serializeChat,
  unreact,
} from "../src/apps/chat/lib/model";
import { loadRoomFiles } from "../src/apps/chat/lib/model/extras";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.example/";
const ALICE = `${ROOT}profile#me`;
const BOB = "https://bob.example/#me";
const EVE = "https://eve.example/#me";
const ROOM = `${ROOT}chat/rooms/team/`;
const AT = new Date("2026-11-11T12:00:00Z");
const input = { name: "Team", creator: ALICE, created: AT, members: [BOB] };

/** Apply the nearest WAC ACL, including inherited defaults, before the demo transport. */
function wacPod() {
  const pod = createDemoPod({ root: ROOT });
  const acls = new Map<string, Store>();
  const existing = new Set<string>();
  const calls: { actor: string; url: string; method: string }[] = [];
  let fault: ((url: string, method: string) => Response | undefined) | undefined;
  const as =
    (actor: string): typeof fetch =>
    async (target, init = {}) => {
      const url = String(target);
      const method = init.method ?? "GET";
      calls.push({ actor, url, method });
      const failed = fault?.(url, method);
      if (failed) return failed;
      const control = url.endsWith(".acl");
      const resource = control ? url.slice(0, -4) : url;
      const entry = [...acls.entries()]
        .filter(
          ([container]) =>
            resource === container ||
            resource.startsWith(container.endsWith("/") ? container : `${container}/`),
        )
        .sort(([a], [b]) => b.length - a.length)[0];
      let allowed = actor === ALICE;
      if (entry) {
        allowed = [...new AclResource(entry[1], DataFactory).authorizations].some(
          (rule) =>
            rule.agent.has(actor) &&
            (control
              ? rule.canReadWriteAcl
              : method === "GET" || method === "HEAD"
                ? rule.canRead
                : rule.canWrite ||
                  (rule.canAppend &&
                    ((method === "PUT" && !existing.has(url)) ||
                      (method === "PATCH" && /^INSERT DATA/.test(String(init.body)))))),
        );
      }
      if (!allowed) return new Response(null, { status: 403 });
      const response = await pod.fetch(target, init);
      if (response.ok && method === "PUT") existing.add(url);
      if (response.ok && method === "DELETE") existing.delete(url);
      if (response.ok && method === "PUT" && control)
        acls.set(resource, await parseChat(String(init.body), url));
      return response;
    };
  return {
    ...pod,
    as,
    acls,
    calls,
    fail(value: typeof fault) {
      fault = value;
    },
  };
}

it("builds SIOC v2 descriptors with the exact Web Crypto key and validates each boundary", async () => {
  const dataset = await buildRoomV2(ROOM, input);
  const bob = await memberContainer(ROOM, BOB);
  expect(bob).toBe(
    `${ROOM}members/${createHash("sha256").update(BOB).digest("hex").slice(0, 32)}/`,
  );
  const layout = await readRoomLayout(
    ROOM,
    await parseChat(await serializeChat(dataset), roomIndex(ROOM)),
  );
  expect(layout?.memberContainers).toEqual(expect.arrayContaining([{ url: bob, owner: BOB }]));
  expect(layout?.memberContainers).toHaveLength(2);
  expect(ownContainer(ROOM, layout, BOB)).toBe(bob);
  expect(() => ownContainer(ROOM, layout, EVE)).toThrow("not-author");
  expect(ownContainer(ROOM, undefined, BOB)).toBe(ROOM);
  expect(documentMember(layout?.memberContainers ?? [], `${bob}bad`)).toBeUndefined();
  expect((await readRoomLayout(ROOM, buildRoom(ROOM, input)))?.memberContainers).toBeUndefined();
  expect(await readRoomLayout(ROOM, new Store())).toBeUndefined();
  const space = new ChatNode(`${roomIndex(ROOM)}#it`, dataset, DataFactory);
  const foreign = await memberContainer(ROOM, EVE);
  for (const [url, owner] of [
    [`${ROOM}members/${"f".repeat(32)}/`, BOB],
    [foreign, EVE],
    ["https://evil.example/", BOB],
  ]) {
    space.refs(`${NS.SIOC}space_of`).add(url as string);
    const node = new ChatNode(url as string, dataset, DataFactory);
    node.types.add(`${NS.SIOC}Container`);
    node.setIri(`${NS.SIOC}has_owner`, owner as string);
    node.setIri(`${NS.SIOC}has_space`, `${roomIndex(ROOM)}#it`);
  }
  expect((await readRoomLayout(ROOM, dataset))?.memberContainers).toHaveLength(2);
  new ChatNode(bob, dataset, DataFactory).refs(`${NS.SIOC}has_owner`).add(ALICE);
  expect((await readRoomLayout(ROOM, dataset))?.memberContainers).toHaveLength(1);
  const alice = await memberContainer(ROOM, ALICE);
  dataset.deleteMatches(DataFactory.namedNode(alice), DataFactory.namedNode(`${NS.SIOC}has_space`));
  expect((await readRoomLayout(ROOM, dataset))?.memberContainers).toEqual([]);
});

it("creates root and member ACLs before the ready index and enforces path-based WAC", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const alice = await memberContainer(ROOM, ALICE);
  const bob = await memberContainer(ROOM, BOB);
  const puts = pod.calls.filter((c) => c.method === "PUT").map((c) => c.url);
  expect(puts).toEqual([
    `${ROOT}chat/`,
    `${ROOT}chat/rooms/`,
    ROOM,
    `${ROOM}.acl`,
    `${ROOM}members/`,
    ...[alice, bob].flatMap((url) => [url, `${url}.acl`]),
    roomIndex(ROOM),
  ]);
  const root = [...new AclResource(pod.acls.get(ROOM) as Store, DataFactory).authorizations];
  expect(root.find((rule) => rule.agent.has(BOB))).toMatchObject({
    canRead: true,
    canWrite: false,
    canAppend: false,
    canReadWriteAcl: false,
    accessTo: ROOM,
    default: ROOM,
  });
  for (const [url, writer] of [
    [alice, ALICE],
    [bob, BOB],
  ]) {
    const rules = [
      ...new AclResource(pod.acls.get(url as string) as Store, DataFactory).authorizations,
    ];
    expect(rules.some((rule) => rule.agent.has(writer as string) && rule.canWrite)).toBe(true);
    expect(rules.some((rule) => rule.agentClass.size > 0)).toBe(false);
    expect(rules.find((rule) => rule.agent.has(ALICE) && rule.canReadWriteAcl)?.default).toBe(url);
  }
  expect((await pod.as(BOB)(`${ROOM}2026/11/11.ttl`, { method: "PUT", body: "" })).status).toBe(
    403,
  );
  expect((await pod.as(BOB)(`${alice}2026/11/11.ttl`, { method: "PUT", body: "" })).status).toBe(
    403,
  );
  expect((await pod.as(BOB)(`${bob}.acl`, { method: "PUT", body: "" })).status).toBe(403);
  expect((await pod.as(EVE)(roomIndex(ROOM))).status).toBe(403);
  await expect(createRoom(pod.as(ALICE), ROOT, "team", input)).rejects.toMatchObject({
    status: 412,
  });
});

it("fails closed on member ACL discovery, grants, and conflicting container creation", async () => {
  for (const kind of ["link", "acl", "container"]) {
    const pod = wacPod();
    const bob = await memberContainer(ROOM, BOB);
    pod.fail((url, method) => {
      if (kind === "link" && url === bob)
        return new Response(null, { status: method === "PUT" ? 201 : 200 });
      if (kind === "acl" && url === `${bob}.acl`) return new Response(null, { status: 403 });
      if (kind === "container" && url === bob && method === "PUT")
        return new Response(null, { status: 412 });
      return undefined;
    });
    await expect(createRoom(pod.as(ALICE), ROOT, "team", input)).rejects.toThrow();
    expect(pod.calls.some((c) => c.url === roomIndex(ROOM) && c.method === "PUT")).toBe(false);
  }
});

it("lets members send/edit/delete/task only in their own day and permits explicit owner moderation", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const bob = await memberContainer(ROOM, BOB);
  const first = await sendMessage(pod.as(BOB), ROOM, {
    id: "first",
    author: BOB,
    content: "Hello",
    at: AT,
  });
  const id = `${first.url}#first`;
  expect(first.url).toBe(dayUrl(bob, AT));
  await sendMessage(pod.as(BOB), ROOM, { id: "second", author: BOB, content: "Second", at: AT });
  await saveMessageEdit(pod.as(BOB), ROOM, id, BOB, "Edited", AT);
  await saveMessageTask(pod.as(BOB), ROOM, id, BOB, { title: "Task", state: "open" }, AT);
  await deleteOwnMessage(pod.as(BOB), ROOM, id, BOB, AT);
  expect(readMessages((await loadChat(pod.as(BOB), ROOM, first.url)).dataset)[0]?.tombstone).toBe(
    true,
  );
  const second = `${first.url}#second`;
  await expect(saveMessageEdit(pod.as(ALICE), ROOM, second, ALICE, "No", AT)).rejects.toThrow(
    "not-author",
  );
  await expect(deleteOwnMessage(pod.as(ALICE), ROOM, second, ALICE, AT)).rejects.toThrow(
    "not-author",
  );
  await expect(removeMessage(pod.as(BOB), ROOM, second, BOB, AT)).rejects.toThrow("not-author");
  await removeMessage(pod.as(ALICE), ROOM, second, ALICE, AT);
  expect(
    (await loadMessages(pod.as(BOB), ROOM, AT, AT, 1, { reader: BOB })).messages.every(
      (m) => m.tombstone,
    ),
  ).toBe(true);
  const writes = pod.calls.filter(
    (c) =>
      c.actor === BOB && (c.method === "PUT" || c.method === "PATCH") && !c.url.endsWith(".acl"),
  );
  expect(writes.every((c) => c.url.startsWith(bob))).toBe(true);
  await expect(
    sendMessage(pod.as(EVE), ROOM, { id: "x", author: EVE, content: "No", at: AT }),
  ).rejects.toThrow();
});

it("merges member days, binds authors, drops forged messages/Like/Undo, and ignores cross-container Undos", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const alice = await memberContainer(ROOM, ALICE);
  const bob = await memberContainer(ROOM, BOB);
  const sent = await sendMessage(pod.as(ALICE), ROOM, {
    id: "hello",
    author: ALICE,
    content: "Hello",
    at: AT,
  });
  const id = `${sent.url}#hello`;
  await react(pod.as(BOB), ROOM, {
    id: "bob",
    message: id,
    actor: BOB,
    emoji: "👍",
    at: new Date(AT.getTime() + 86400000),
  });
  const bobDay = dayUrl(bob, AT);
  const document = await loadChat(pod.as(BOB), ROOM, bobDay);
  const forged = appendMessage(
    document.dataset,
    ROOM,
    { id: "forged", author: ALICE, content: "Forged", at: AT },
    bob,
  );
  const honest = appendMessage(
    forged,
    ROOM,
    { id: "honest", author: BOB, content: "Bob", at: AT },
    bob,
  );
  const authorless = new ChatNode(`${bobDay}#anonymous`, honest, DataFactory);
  authorless.types.add(`${NS.AS}Note`);
  authorless.setText(`${NS.AS}content`, "No author");
  for (const [subject, type, actor, object] of [
    [`${bobDay}#like-forged`, "Like", ALICE, id],
    [`${bobDay}#undo-forged`, "Undo", ALICE, `${bobDay}#reaction-bob`],
    [`${bobDay}#undo-cross`, "Undo", BOB, `${sent.url}#reaction-alice`],
  ]) {
    const node = new ChatNode(subject as string, honest, DataFactory);
    node.types.add(`${NS.AS}${type}`);
    node.setIri(`${NS.AS}attributedTo`, actor as string);
    node.setIri(`${NS.AS}object`, object as string);
    node.setDate(`${NS.AS}published`, AT);
    node.setText(`${NS.AS}content`, "👍");
  }
  // A subject from another member's day cannot poison that member's message, even claiming Bob.
  new ChatNode(id, honest, DataFactory).types.add(`${NS.AS}Tombstone`);
  await saveChat(pod.as(BOB), ROOM, bobDay, honest, { ifMatch: document.etag as string });
  await react(pod.as(ALICE), ROOM, { id: "alice", message: id, actor: ALICE, emoji: "👍", at: AT });
  const page = await loadMessages(pod.as(BOB), ROOM, AT, AT, 1, { reader: BOB });
  expect(page.messages.map((m) => m.author)).toEqual([BOB, BOB, ALICE]);
  expect(page.dropped).toBe(4);
  expect(page.documents).toHaveLength(2);
  const known = new Set(page.messages.map((m) => m.id));
  const likes = page.documents.flatMap(
    (doc) => readReactions(doc.dataset, doc.url, known, page.memberContainers).get(id) ?? [],
  );
  expect(likes.map((like) => like.actorId).sort()).toEqual([ALICE, BOB]);
  await unreact(pod.as(BOB), ROOM, {
    id: "undo",
    message: id,
    actor: BOB,
    reaction: `${bobDay}#reaction-bob`,
    at: AT,
  });
  await unreact(pod.as(BOB), ROOM, {
    id: "undo-again",
    message: id,
    actor: BOB,
    reaction: `${bobDay}#reaction-bob`,
    at: AT,
  });
  const client = new ChatClient(pod.as(BOB), ROOT, BOB);
  expect(
    (await client.messages(ROOM, { before: AT, since: AT, days: 1 })).messages.find(
      (m) => m.id === id,
    )?.reactions,
  ).toEqual([{ emoji: "👍", count: 1, reactedByMe: false }]);
  expect(
    pod.calls
      .filter((c) => c.method === "GET" && /2026\/11\/11.ttl$/.test(c.url))
      .every((c) => c.url.startsWith(alice) || c.url.startsWith(bob)),
  ).toBe(true);
});

it("uses member days for the client, search, unread counts, reaction toggles, files, and owner removal", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  try {
    const pod = wacPod();
    const owner = new ChatClient(pod.as(ALICE), ROOT, ALICE);
    const room = await owner.createRoom(input);
    const bob = new ChatClient(pod.as(BOB), ROOT, BOB);
    const message = await bob.send(room.url, "Searchable garden");
    await bob.edit(room.url, message.id, "Edited garden");
    await bob.toTask(room.url, message.id, { title: "Garden" });
    await bob.react(room.url, message.id, "❤️");
    await bob.react(room.url, message.id, "❤️");
    expect((await owner.messages(room.url)).messages[0]?.reactions).toEqual([]);
    expect(await owner.unreadCounts([room])).toEqual({ [room.url]: 1 });
    expect((await owner.search("garden", { timeZone: "UTC" })).results).toHaveLength(1);
    const container = await memberContainer(room.url, BOB);
    await pod.as(BOB)(`${container}photo.png`, { method: "PUT", body: "image" });
    expect(await loadRoomFiles(pod.as(ALICE), room.url, { reader: ALICE })).toEqual({
      files: [`${container}photo.png`],
      dropped: 0,
    });
    await expect(bob.moderate(room.url, message.id)).rejects.toThrow("not-author");
    await owner.moderate(room.url, message.id);
    expect((await owner.messages(room.url)).messages[0]?.deleted).toBe(true);
    await expect(owner.moderate(room.url, `${message.id}unknown`)).rejects.toThrow(
      "missing-message",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("retains the v1 wire model, append ACLs, shared events and author claims", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const index = await loadChat(pod.as(ALICE), ROOM, roomIndex(ROOM));
  const acl = await loadChat(pod.as(ALICE), ROOM, `${ROOM}.acl`);
  await saveChat(
    pod.as(ALICE),
    ROOT,
    `${ROOM}.acl`,
    buildRoomAcl(ROOM, `${ROOM}.acl`, ALICE, [BOB]),
    { ifMatch: acl.etag as string },
  );
  await saveChat(pod.as(ALICE), ROOT, index.url, buildRoom(ROOM, input), {
    ifMatch: index.etag as string,
  });
  const sent = await sendMessage(pod.as(BOB), ROOM, {
    id: "v1",
    author: BOB,
    content: "Claim",
    at: AT,
  });
  await expect(
    saveMessageEdit(pod.as(BOB), ROOM, `${sent.url}#v1`, BOB, "Denied", AT),
  ).rejects.toMatchObject({ status: 403 });
  expect(sent.url).toBe(dayUrl(ROOM, AT));
  await react(pod.as(BOB), ROOM, {
    id: "like",
    message: `${sent.url}#v1`,
    actor: BOB,
    emoji: "👍",
    at: AT,
  });
  expect(
    (await loadMessages(pod.as(BOB), ROOM, AT, AT, 1, { reader: BOB })).messages[0]?.author,
  ).toBe(BOB);
  expect(
    [
      ...new AclResource(buildRoomAcl(ROOM, `${ROOM}.acl`, ALICE, [BOB]), DataFactory)
        .authorizations,
    ].find((rule) => rule.agent.has(BOB))?.canAppend,
  ).toBe(true);
  await expect(removeMessage(pod.as(ALICE), ROOM, `${sent.url}#v1`, ALICE, AT)).rejects.toThrow(
    "not-author",
  );
});

it("refuses malformed v2 boundaries without downgrading, including ownerless descriptors", async () => {
  const dataset = await buildRoomV2(ROOM, input);
  const alice = await memberContainer(ROOM, ALICE);
  const bob = await memberContainer(ROOM, BOB);
  dataset.deleteMatches(
    DataFactory.namedNode(`${roomIndex(ROOM)}#it`),
    DataFactory.namedNode(`${NS.DCT}creator`),
  );
  dataset.deleteMatches(DataFactory.namedNode(alice), DataFactory.namedNode(`${NS.SIOC}has_owner`));
  dataset.deleteMatches(DataFactory.namedNode(bob), DataFactory.namedNode(`${NS.RDF}type`));
  const layout = await readRoomLayout(ROOM, dataset);
  expect(layout?.memberContainers).toEqual([]);
  expect(() => ownContainer(ROOM, layout, ALICE)).toThrow("not-author");
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(await serializeChat(dataset), { headers: { "content-type": "text/turtle" } }),
  );
  expect((await loadMessages(fetch, ROOM, AT, AT, 1, { reader: ALICE })).documents).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const invalid = new Store([...dataset]);
  invalid.deleteMatches(
    DataFactory.namedNode(`${roomIndex(ROOM)}#it`),
    DataFactory.namedNode(`${NS.RDF}type`),
  );
  await expect(readRoomLayout(ROOM, invalid)).rejects.toThrow("invalid-input");
  const empty = createDemoPod({ root: ROOT });
  await expect(loadRoomFiles(empty.fetch, ROOM, { reader: ALICE })).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    loadRoomFiles(async () => new Response(null, { status: 503 }), ROOM, { reader: ALICE }),
  ).rejects.toMatchObject({ status: 503 });
});

it("bounds a v2 page to six concurrent member-day reads, treats 404 as empty, and propagates errors", async () => {
  const descriptor = await serializeChat(
    await buildRoomV2(ROOM, {
      ...input,
      members: Array.from({ length: 9 }, (_, i) => `https://person-${i}.example/#me`),
    }),
  );
  let active = 0;
  let peak = 0;
  let release!: () => void;
  let six!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    six = resolve;
  });
  const fetch: typeof globalThis.fetch = async (target) => {
    if (String(target) === roomIndex(ROOM))
      return new Response(descriptor, { headers: { "content-type": "text/turtle" } });
    active++;
    peak = Math.max(peak, active);
    if (active === 6) six();
    await gate;
    active--;
    return new Response(null, { status: 404 });
  };
  const pending = loadMessages(fetch, ROOM, AT, AT, 1, { reader: ALICE });
  await ready;
  expect(peak).toBe(6);
  release();
  expect((await pending).documents).toHaveLength(10);
  const denied: typeof globalThis.fetch = async (target) =>
    String(target) === roomIndex(ROOM)
      ? new Response(descriptor, { headers: { "content-type": "text/turtle" } })
      : new Response(null, { status: 403 });
  await expect(loadMessages(denied, ROOM, AT, AT, 1, { reader: ALICE })).rejects.toMatchObject({
    status: 403,
  });
});

it("rejects foreign/cross-day Likes and checks LongChat makers, literal authors, and authorless events", async () => {
  const bob = await memberContainer(ROOM, BOB);
  const alice = await memberContainer(ROOM, ALICE);
  const day = dayUrl(bob, AT);
  const target = `${dayUrl(alice, AT)}#message`;
  const tomorrow = `${dayUrl(alice, new Date(AT.getTime() + 86400000))}#message`;
  const dataset = new Store();
  for (const [id, object] of [
    [`${day}#otherday`, tomorrow],
    [`${day}#foreign`, `${ROOT}foreign.ttl#message`],
  ]) {
    const node = new ChatNode(id as string, dataset, DataFactory);
    node.types.add(`${NS.AS}Like`);
    node.setIri(`${NS.AS}object`, object as string);
    node.setIri(`${NS.AS}attributedTo`, BOB);
    node.setText(`${NS.AS}content`, "👍");
    node.setDate(`${NS.AS}published`, AT);
  }
  const containers = [
    { url: bob, owner: BOB },
    { url: alice, owner: ALICE },
  ];
  expect(
    readReactions(
      dataset,
      day,
      new Set([target, tomorrow, `${ROOT}foreign.ttl#message`]),
      containers,
    ).size,
  ).toBe(0);
  const legacy = new ChatNode(`${day}#legacy`, dataset, DataFactory);
  legacy.types.add(`${NS.SIOC}Note`);
  legacy.setText(`${NS.SIOC}content`, "Forged LongChat");
  legacy.setIri(`${NS.FOAF}maker`, ALICE);
  const literal = new ChatNode(`${day}#literal`, dataset, DataFactory);
  literal.types.add(`${NS.AS}Note`);
  literal.setText(`${NS.AS}attributedTo`, BOB);
  const absent = new ChatNode(`${day}#absent`, dataset, DataFactory);
  absent.types.add(`${NS.AS}Like`);
  const trusted = memberDocument(dataset, day, BOB);
  expect(trusted.dropped).toBe(3);
  expect(readMessages(trusted.dataset)).toEqual([]);
});

it("toggles cross-member client reactions in the actor day, rejects forged targets and retains v1 toggles", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const sent = await sendMessage(pod.as(ALICE), ROOM, {
    id: "target",
    author: ALICE,
    content: "Hello",
    at: AT,
  });
  const id = `${sent.url}#target`;
  const bob = new ChatClient(pod.as(BOB), ROOT, BOB);
  await bob.react(ROOM, id, "👍");
  await bob.react(ROOM, id, "👍");
  const bad = new ChatClient(
    async (url, init) =>
      String(url) === dayUrl(await memberContainer(ROOM, BOB), AT)
        ? new Response(null, { status: 503 })
        : pod.as(BOB)(url, init),
    ROOT,
    BOB,
  );
  await expect(bad.react(ROOM, id, "👍")).rejects.toMatchObject({ status: 503 });
  await expect(
    react(pod.as(BOB), ROOM, {
      id: "root",
      actor: BOB,
      message: `${dayUrl(ROOM, AT)}#root`,
      emoji: "👍",
      at: AT,
    }),
  ).rejects.toThrow("missing-message");
  await expect(removeMessage(pod.as(ALICE), ROOM, `${sent.url}#absent`, ALICE, AT)).rejects.toThrow(
    "missing-message",
  );
  const forged = await sendMessage(pod.as(BOB), ROOM, {
    id: "fake",
    author: BOB,
    content: "False",
    at: AT,
  });
  const doc = await loadChat(pod.as(BOB), ROOM, forged.url);
  new ChatNode(`${forged.url}#fake`, doc.dataset, DataFactory).setIri(
    `${NS.AS}attributedTo`,
    ALICE,
  );
  await saveChat(pod.as(BOB), ROOM, forged.url, doc.dataset, { ifMatch: doc.etag as string });
  await expect(bob.react(ROOM, `${forged.url}#fake`, "👍")).rejects.toThrow("missing-message");
  const legacy = createDemoPod({ root: ROOT });
  await saveChat(legacy.fetch, ROOT, roomIndex(ROOM), buildRoom(ROOM, input), { ifNoneMatch: "*" });
  const client = new ChatClient(legacy.fetch, ROOT, ALICE);
  const own = await client.send(ROOM, "Legacy");
  await client.react(ROOM, own.id, "👍");
  await client.react(ROOM, own.id, "👍");
  expect((await client.messages(ROOM)).messages[0]?.reactions).toEqual([]);
});

const badMemberResponses = [
  {
    name: "invalid RDF",
    counted: true,
    response: () =>
      new Response("this is not Turtle", { headers: { "content-type": "text/turtle" } }),
  },
  {
    name: "unsupported media type",
    counted: true,
    response: () =>
      new Response("binary", { headers: { "content-type": "application/octet-stream" } }),
  },
  {
    name: "malformed content type",
    counted: true,
    response: () => new Response("binary", { headers: { "content-type": "not a type;;" } }),
  },
  {
    name: "parser budget",
    counted: true,
    response: () =>
      new Response(`${"[".repeat(130)}0${"]".repeat(130)}`, {
        headers: { "content-type": "application/ld+json" },
      }),
  },
  {
    name: "JSON-LD processing error",
    counted: true,
    response: () =>
      new Response('{"@id": 5, "https://example.org/p": "v"}', {
        headers: { "content-type": "application/ld+json" },
      }),
  },
  {
    name: "remote JSON-LD context",
    counted: true,
    response: () =>
      new Response('{"@context": "https://evil.example/context", "@id": "#x"}', {
        headers: { "content-type": "application/ld+json" },
      }),
  },
  // CSS answers 501 when a stored type has no conversion to the requested RDF types.
  ...[403, 406, 415, 501].map((status) => ({
    name: String(status),
    counted: true,
    response: () => new Response(null, { status }),
  })),
  // A member who did not post that day: absent, not a failure.
  ...[404, 410].map((status) => ({
    name: String(status),
    counted: false,
    response: () => new Response(null, { status }),
  })),
];

it.each(
  badMemberResponses,
)("isolates another member's $name day across timeline, reactions, unread and search", async ({
  response,
  name,
  counted,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  try {
    const pod = wacPod();
    await createRoom(pod.as(ALICE), ROOT, "team", input);
    const client = new ChatClient(pod.as(ALICE), ROOT, ALICE);
    await client.join(ROOM);
    const message = await client.send(ROOM, "Healthy garden", { at: AT });
    await client.react(ROOM, message.id, "👍");
    const day = dayUrl(await memberContainer(ROOM, BOB), AT);
    pod.fail((url, method) => (url === day && method === "GET" ? response() : undefined));
    if (name === "parser budget")
      await expect(loadChat(pod.as(ALICE), ROOM, day)).rejects.toMatchObject({
        code: "PARSE_LIMIT",
      });
    const page = await client.messages(ROOM, { before: AT, since: AT, days: 1 });
    expect(page.dropped).toBe(counted ? 1 : 0);
    expect(page.messages.map((m) => m.id)).toEqual([message.id]);
    expect(page.messages[0]?.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
    expect(await client.unreadCounts([{ url: ROOM }])).toEqual({ [ROOM]: 0 });
    const search = await client.search("garden", { days: 1, timeZone: "UTC" });
    expect(search.results.map((result) => result.message.id)).toEqual([message.id]);
    expect(search.skipped).toEqual([]);
    expect(search.droppedRecords).toBe(counted ? 1 : 0);
    const own = new ChatClient(pod.as(BOB), ROOT, BOB);
    if (name === "404")
      expect((await own.messages(ROOM, { before: AT, since: AT, days: 1 })).dropped).toBe(0);
    else await expect(own.messages(ROOM, { before: AT, since: AT, days: 1 })).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});

it.each(
  badMemberResponses,
)("isolates $name member file listings at each date depth, retaining own errors", async ({
  response,
  counted,
}) => {
  for (const depth of ["", "2026/", "2026/11/"]) {
    const pod = wacPod();
    await createRoom(pod.as(ALICE), ROOT, "team", input);
    const alice = await memberContainer(ROOM, ALICE);
    const bob = await memberContainer(ROOM, BOB);
    for (const [actor, container] of [
      [ALICE, alice],
      [BOB, bob],
    ]) {
      await sendMessage(pod.as(actor as string), ROOM, {
        author: actor as string,
        id: "one",
        content: "Hello",
        at: AT,
      });
      await pod.as(actor as string)(`${container}2026/11/photo.png`, {
        method: "PUT",
        body: "image",
      });
    }
    pod.fail((url, method) =>
      method === "GET" && url === `${bob}${depth}` ? response() : undefined,
    );
    expect(await loadRoomFiles(pod.as(ALICE), ROOM, { reader: ALICE })).toEqual({
      files: [`${alice}2026/11/photo.png`],
      dropped: counted ? 1 : 0,
    });
    await expect(loadRoomFiles(pod.as(BOB), ROOM, { reader: BOB })).rejects.toThrow();
  }
});

it("propagates index, authentication, server, network and own parsing failures", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const bob = await memberContainer(ROOM, BOB);
  for (const status of [401, 503]) {
    pod.fail((url, method) =>
      url.startsWith(bob) && method === "GET"
        ? new Response("failure", { status, headers: { "content-type": "text/turtle" } })
        : undefined,
    );
    await expect(
      loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE }),
    ).rejects.toMatchObject({ status });
    await expect(loadRoomFiles(pod.as(ALICE), ROOM, { reader: ALICE })).rejects.toMatchObject({
      status,
    });
  }
  const network: typeof fetch = (url, init) => {
    if (String(url).startsWith(bob)) throw new Error("offline");
    return pod.as(ALICE)(url, init);
  };
  pod.fail(undefined);
  await expect(loadMessages(network, ROOM, AT, AT, 1, { reader: ALICE })).rejects.toThrow(
    "Network error",
  );
  pod.fail((url) => (url === roomIndex(ROOM) ? badMemberResponses[0]?.response() : undefined));
  await expect(loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE })).rejects.toThrow();
  await expect(loadRoomFiles(pod.as(ALICE), ROOM, { reader: ALICE })).rejects.toThrow();
});

it("refuses to resume creation under a legacy Append ACL before writing member containers or index", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  await pod.as(ALICE)(roomIndex(ROOM), { method: "DELETE" });
  const acl = await loadChat(pod.as(ALICE), ROOM, `${ROOM}.acl`);
  await saveChat(pod.as(ALICE), ROOT, acl.url, buildRoomAcl(ROOM, acl.url, ALICE, [BOB]), {
    ifMatch: acl.etag as string,
  });
  const before = pod.calls.length;
  await expect(
    createRoom(pod.as(ALICE), ROOT, "team", input, { resume: true }),
  ).rejects.toMatchObject({ name: "ChatModelError", code: "unsafe-acl" });
  expect(
    pod.calls
      .slice(before)
      .filter((c) => c.method === "PUT")
      .map((c) => c.url),
  ).toEqual([ROOM, `${ROOM}.acl`]);
  expect((await pod.as(ALICE)(roomIndex(ROOM))).status).toBe(404);
});

it("refuses an interrupted direct message with a legacy root ACL", async () => {
  const pod = wacPod();
  const client = new ChatClient(pod.as(ALICE), ROOT, ALICE);
  const room = await client.createDirect(BOB);
  await client.leave(room.url);
  await pod.as(ALICE)(roomIndex(room.url), { method: "DELETE" });
  const acl = await loadChat(pod.as(ALICE), room.url, `${room.url}.acl`);
  await saveChat(pod.as(ALICE), ROOT, acl.url, buildRoomAcl(room.url, acl.url, ALICE, [BOB]), {
    ifMatch: acl.etag as string,
  });
  await expect(client.createDirect(BOB)).rejects.toMatchObject({ code: "unsafe-acl" });
  expect((await pod.as(ALICE)(roomIndex(room.url))).status).toBe(404);
});

it("preserves member-bound cached messages and reactions, reading index and target once per toggle", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const alice = new ChatClient(pod.as(ALICE), ROOT, ALICE);
  const bob = new ChatClient(pod.as(BOB), ROOT, BOB);
  const target = await alice.send(ROOM, "Alice", { at: AT });
  const own = await bob.send(ROOM, "Bob", { at: AT });
  await alice.react(ROOM, own.id, "❤️");
  await bob.messages(ROOM, { before: AT, since: AT, days: 1 });
  const day = await loadChat(pod.as(BOB), ROOM, own.id.split("#")[0] as string);
  const forged = appendMessage(
    day.dataset,
    ROOM,
    { id: "injected", author: ALICE, content: "Forgery", at: AT },
    await memberContainer(ROOM, BOB),
  );
  await saveChat(pod.as(ALICE), ROOT, day.url, forged, { ifMatch: day.etag as string });
  const cache = (bob as unknown as { known: Map<string, { reactions: unknown[] }> }).known;
  for (const message of [target, target, own, own]) {
    const before = pod.calls.length;
    await bob.react(ROOM, message.id, "👍");
    const gets = pod.calls.slice(before).filter((c) => c.method === "GET");
    expect(gets.filter((c) => c.url === roomIndex(ROOM))).toHaveLength(1);
    expect(gets.filter((c) => c.url === message.id.split("#")[0])).toHaveLength(1);
    expect(cache.has(`${day.url}#injected`)).toBe(false);
    const cached = cache.get(message.id)?.reactions;
    const fresh = (await bob.messages(ROOM, { before: AT, since: AT, days: 1 })).messages.find(
      (m) => m.id === message.id,
    )?.reactions;
    expect(cached).toEqual(fresh);
    expect(cache.get(own.id)?.reactions).toContainEqual({
      emoji: "❤️",
      count: 1,
      reactedByMe: false,
    });
  }
});

it("lets a v1 Append member append layout descriptors, documenting the legacy trust boundary", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const acl = await loadChat(pod.as(ALICE), ROOT, `${ROOM}.acl`);
  await saveChat(pod.as(ALICE), ROOT, acl.url, buildRoomAcl(ROOM, acl.url, ALICE, [BOB]), {
    ifMatch: acl.etag as string,
  });
  const index = await loadChat(pod.as(ALICE), ROOT, roomIndex(ROOM));
  await saveChat(pod.as(ALICE), ROOT, index.url, buildRoom(ROOM, input), {
    ifMatch: index.etag as string,
  });
  const body = await serializeChat(await buildRoomV2(ROOM, input), "application/n-triples");
  expect(
    (
      await pod.as(BOB)(index.url, {
        method: "PATCH",
        headers: { "content-type": "application/sparql-update" },
        body: `INSERT DATA {\n${body}\n}`,
      })
    ).ok,
  ).toBe(true);
  expect(
    (await readRoomLayout(ROOM, (await loadChat(pod.as(ALICE), ROOM, index.url)).dataset))
      ?.memberContainers,
  ).toHaveLength(2);
});

it.each([
  "unread",
  "search",
  "pages",
])("shares the six-read bound across rooms during %s", async (operation) => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  try {
    const rooms = Array.from({ length: 3 }, (_, i) => ({
      url: `${ROOT}chat/rooms/r-${i}/`,
      name: `Room ${i}`,
      members: [ALICE, BOB],
      creator: ALICE,
      created: AT.toISOString(),
      isDirect: false,
    }));
    const indexes = new Map(
      await Promise.all(
        rooms.map(
          async ({ url }) =>
            [
              roomIndex(url),
              await serializeChat(
                await buildRoomV2(url, {
                  ...input,
                  members: Array.from({ length: 8 }, (_, i) => `https://member-${i}.example/#me`),
                }),
              ),
            ] as const,
        ),
      ),
    );
    let active = 0;
    let peak = 0;
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const six = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const fetch: typeof globalThis.fetch = async (url) => {
      const index = indexes.get(String(url));
      if (index) return new Response(index, { headers: { "content-type": "text/turtle" } });
      if (String(url).endsWith("/preferences")) return new Response(null, { status: 404 });
      if (!String(url).includes("/members/")) return new Response(null, { status: 404 });
      active++;
      peak = Math.max(peak, active);
      if (active === 6) ready();
      await held;
      active--;
      return new Response(null, { status: 404 });
    };
    const client = new ChatClient(fetch, ROOT, ALICE);
    vi.spyOn(client, "joinedRooms").mockResolvedValue(rooms);
    const pending =
      operation === "unread"
        ? client.unreadCounts(rooms)
        : operation === "search"
          ? client.search("hello", { days: 1, timeZone: "UTC" })
          : Promise.all(
              rooms.map(({ url }) => client.messages(url, { before: AT, since: AT, days: 1 })),
            );
    await six;
    expect(peak).toBe(6);
    release();
    await pending;
    expect(peak).toBe(6);
  } finally {
    vi.useRealTimers();
  }
});

it("stops queued day and file reads after a fatal failure, and settles every unread room before failing", async () => {
  const descriptor = await serializeChat(
    await buildRoomV2(ROOM, {
      ...input,
      members: Array.from({ length: 19 }, (_, i) => `https://member-${i}.example/#me`),
    }),
  );
  for (const files of [false, true]) {
    let started = 0;
    const fetch: typeof globalThis.fetch = async (url) => {
      if (String(url) === roomIndex(ROOM))
        return new Response(descriptor, { headers: { "content-type": "text/turtle" } });
      started++;
      return new Response(null, { status: 503 });
    };
    await expect(
      files
        ? loadRoomFiles(fetch, ROOM, { reader: ALICE })
        : loadMessages(fetch, ROOM, AT, AT, 1, { reader: ALICE }),
    ).rejects.toMatchObject({ status: 503 });
    expect(started).toBe(6);
  }
  const client = new ChatClient(async () => new Response(null, { status: 404 }), ROOT, ALICE);
  let settled = false;
  const messages = vi.spyOn(client, "messages").mockImplementation(async (url) => {
    if (url === ROOM) throw new Error("fatal");
    await new Promise((resolve) => setTimeout(resolve, 0));
    settled = true;
    return { messages: [], next: null };
  });
  await expect(client.unreadCounts([{ url: ROOM }, { url: `${ROOM}next/` }])).rejects.toThrow(
    "fatal",
  );
  expect(messages).toHaveBeenCalledTimes(2);
  expect(messages).toHaveBeenCalledWith(ROOM, { background: true });
  expect(settled).toBe(true);
});

it("bounds the member-key cache while retaining deterministic hashes and cache hits", async () => {
  const digest = vi.spyOn(crypto.subtle, "digest");
  try {
    const webId = "https://cache-first.example/#me";
    const first = await memberContainer(ROOM, webId);
    expect(await memberContainer(ROOM, webId)).toBe(first);
    expect(digest).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 256; i++) await memberContainer(ROOM, `https://cache-${i}.example/#me`);
    expect(await memberContainer(ROOM, webId)).toBe(first);
    expect(digest).toHaveBeenCalledTimes(258);
  } finally {
    digest.mockRestore();
  }
});

it.each([
  "write",
  "public",
  "group",
  "control",
  "untyped",
  "unknown-mode",
])("fails closed on resumed %s grants to other agents", async (grant) => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  await pod.as(ALICE)(roomIndex(ROOM), { method: "DELETE" });
  const acl = await loadChat(pod.as(ALICE), ROOM, `${ROOM}.acl`);
  const rule = new Authorization(`${acl.url}#extra`, acl.dataset, DataFactory);
  // Some WAC servers (acl-check) honour rules without the acl:Authorization type.
  if (grant !== "untyped") rule.type.add(`${NS.ACL}Authorization`);
  rule.accessTo = ROOM;
  rule.default = ROOM;
  if (grant === "write") {
    rule.agent.add(BOB);
    rule.canWrite = true;
  } else if (grant === "control") {
    // Control lets Bob rewrite this ACL and grant himself Append.
    rule.agent.add(BOB);
    rule.canRead = true;
    rule.canReadWriteAcl = true;
  } else if (grant === "untyped") {
    rule.agent.add(BOB);
    rule.canAppend = true;
  } else if (grant === "unknown-mode") {
    rule.agent.add(BOB);
    rule.mode.add("https://example.org/modes#Publish");
  } else {
    rule.canAppend = true;
    if (grant === "public") rule.accessibleToAny = true;
    else rule.agentGroup = new Group(`${ROOT}group#it`, acl.dataset, DataFactory);
  }
  await saveChat(pod.as(ALICE), ROOT, acl.url, acl.dataset, { ifMatch: acl.etag as string });
  const before = pod.calls.length;
  const refusal = await createRoom(pod.as(ALICE), ROOT, "team", input, { resume: true }).catch(
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(ChatModelError);
  expect(refusal).toMatchObject({ code: "unsafe-acl" });
  expect(
    pod.calls.slice(before).some((c) => c.method === "PUT" && c.url.includes("/members/")),
  ).toBe(false);
});

it("resumes under an owner-only Control rule and a members Read rule, typed or not", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  await pod.as(ALICE)(roomIndex(ROOM), { method: "DELETE" });
  const acl = await loadChat(pod.as(ALICE), ROOM, `${ROOM}.acl`);
  const rule = new Authorization(`${acl.url}#untyped-owner`, acl.dataset, DataFactory);
  rule.agent.add(ALICE);
  rule.accessTo = ROOM;
  rule.canReadWriteAcl = true;
  const read = new Authorization(`${acl.url}#untyped-read`, acl.dataset, DataFactory);
  read.agent.add(BOB);
  read.accessTo = ROOM;
  read.canRead = true;
  await saveChat(pod.as(ALICE), ROOT, acl.url, acl.dataset, { ifMatch: acl.etag as string });
  const resumed = await createRoom(pod.as(ALICE), ROOT, "team", input, { resume: true });
  expect((await readRoomLayout(ROOM, resumed.dataset))?.memberContainers).toHaveLength(2);
});

it("rejects raw reaction events with missing or mismatched member bindings", async () => {
  const bob = await memberContainer(ROOM, BOB);
  const alice = await memberContainer(ROOM, ALICE);
  const target = `${dayUrl(alice, AT)}#message`;
  const dataset = new Store();
  for (const [document, actor] of [
    [dayUrl(bob, AT), ALICE],
    [`${ROOM}outside.ttl`, BOB],
  ]) {
    const node = new ChatNode(`${document}#like`, dataset, DataFactory);
    node.types.add(`${NS.AS}Like`);
    node.setIri(`${NS.AS}attributedTo`, actor as string);
    node.setIri(`${NS.AS}object`, target);
    node.setText(`${NS.AS}content`, "👍");
    node.setDate(`${NS.AS}published`, AT);
  }
  expect(
    readReactions(dataset, undefined, new Set([target]), [
      { url: bob, owner: BOB },
      { url: alice, owner: ALICE },
    ]).size,
  ).toBe(0);
});

const CAROL = "https://carol.example/#me";
const DAY = 86_400_000;

it("reports no drops for a healthy multi-day room where one member never posted", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  try {
    const pod = wacPod();
    await createRoom(pod.as(ALICE), ROOT, "team", {
      ...input,
      members: [BOB, CAROL],
      created: new Date(AT.getTime() - 3 * DAY),
    });
    await sendMessage(pod.as(ALICE), ROOM, {
      id: "one",
      author: ALICE,
      content: "Garden one",
      at: new Date(AT.getTime() - 2 * DAY),
    });
    await sendMessage(pod.as(BOB), ROOM, {
      id: "two",
      author: BOB,
      content: "Garden two",
      at: new Date(AT.getTime() - DAY),
    });
    const client = new ChatClient(pod.as(ALICE), ROOT, ALICE);
    await client.join(ROOM);
    const page = await client.messages(ROOM, { before: AT, days: 4 });
    expect(page.messages.map((m) => m.content)).toEqual(["Garden one", "Garden two"]);
    expect(page.dropped).toBe(0);
    const search = await client.search("garden", { days: 4, timeZone: "UTC" });
    expect(search.results).toHaveLength(2);
    expect(search.skipped).toEqual([]);
    expect(search.droppedRecords).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("propagates a transport failure while streaming another member's day", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const day = dayUrl(await memberContainer(ROOM, BOB), AT);
  const failing = (failure: Error) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<#a> <#b> <#c> ."));
          controller.error(failure);
        },
      }),
      { headers: { "content-type": "text/turtle" } },
    );
  for (const response of [
    () => failing(new TypeError("terminated")),
    () => failing(Object.assign(new Error("connection reset"), { code: "ECONNRESET" })),
    () => failing(Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" })),
  ]) {
    pod.fail((url, method) => (url === day && method === "GET" ? response() : undefined));
    const failure = await loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RdfFetchError);
    expect((failure as RdfFetchError).status).toBeUndefined();
  }
});

it("isolates another member's malformed or invalid JSON-LD day as content", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const day = dayUrl(await memberContainer(ROOM, BOB), AT);
  const own = dayUrl(await memberContainer(ROOM, ALICE), AT);
  const jsonld = (body: string) =>
    new Response(body, { headers: { "content-type": "application/ld+json" } });
  for (const body of ['{"@id": ', '{"@id":"#m","http://e/p":{"@value":5,"@direction":"ltr"}}']) {
    pod.fail((url, method) => (url === day && method === "GET" ? jsonld(body) : undefined));
    const page = await loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE });
    expect(page.dropped).toBe(1);
    pod.fail((url, method) => (url === own && method === "GET" ? jsonld(body) : undefined));
    await expect(
      loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE }),
    ).rejects.toBeInstanceOf(RdfFetchError);
  }
});

it("requires a reader, and an absent one never makes a member container lenient", async () => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  const bob = await memberContainer(ROOM, BOB);
  pod.fail((url, method) =>
    url.startsWith(bob) && method === "GET" ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(
    // @ts-expect-error a reader is required for member reads
    loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, {}),
  ).rejects.toMatchObject({ status: 403 });
  // @ts-expect-error a reader is required for member reads
  await expect(loadRoomFiles(pod.as(ALICE), ROOM, {})).rejects.toMatchObject({ status: 403 });
  expect((await loadMessages(pod.as(ALICE), ROOM, AT, AT, 1, { reader: ALICE })).dropped).toBe(1);
});

it.each([
  ["v2", "none"],
  ["v2", "weak"],
  ["v1", "none"],
])("removes %s duplicate reactions when PATCH answers with a %s ETag", async (layout, etag) => {
  const pod = wacPod();
  await createRoom(pod.as(ALICE), ROOT, "team", input);
  if (layout === "v1") {
    const acl = await loadChat(pod.as(ALICE), ROOM, `${ROOM}.acl`);
    await saveChat(pod.as(ALICE), ROOT, acl.url, buildRoomAcl(ROOM, acl.url, ALICE, [BOB]), {
      ifMatch: acl.etag as string,
    });
    const index = await loadChat(pod.as(ALICE), ROOM, roomIndex(ROOM));
    await saveChat(pod.as(ALICE), ROOT, index.url, buildRoom(ROOM, input), {
      ifMatch: index.etag as string,
    });
  }
  const sent = await sendMessage(pod.as(ALICE), ROOM, {
    id: "target",
    author: ALICE,
    content: "Hello",
    at: AT,
  });
  const id = `${sent.url}#target`;
  // Two tabs both added a Like before either saw the other.
  for (const like of ["one", "two"])
    await react(pod.as(BOB), ROOM, { id: like, message: id, actor: BOB, emoji: "👍", at: AT });
  const patches: string[] = [];
  const stripped: typeof fetch = async (url, init) => {
    const response = await pod.as(BOB)(url, init);
    if (init?.method !== "PATCH") return response;
    patches.push(String(url));
    const headers = new Headers(response.headers);
    if (etag === "weak") headers.set("etag", 'W/"weak"');
    else headers.delete("etag");
    return new Response(response.body, { status: response.status, headers });
  };
  const bob = new ChatClient(stripped, ROOT, BOB);
  await bob.react(ROOM, id, "👍");
  expect(patches).toHaveLength(2);
  expect(
    (await bob.messages(ROOM, { before: AT, since: AT, days: 1 })).messages.find((m) => m.id === id)
      ?.reactions,
  ).toEqual([]);
});

it("starts the open room's timeline before queued unread reads, which run rooms concurrently", async () => {
  const rooms = Array.from({ length: 3 }, (_, i) => ({ url: `${ROOT}chat/rooms/r-${i}/` }));
  const open = `${ROOT}chat/rooms/open/`;
  const indexes = new Map(
    await Promise.all(
      [...rooms.map(({ url }) => url), open].map(
        async (url) =>
          [
            roomIndex(url),
            await serializeChat(
              await buildRoomV2(url, {
                ...input,
                members: Array.from({ length: 8 }, (_, i) => `https://member-${i}.example/#me`),
              }),
            ),
          ] as const,
      ),
    ),
  );
  const fetched = new Set<string>();
  const held: (() => void)[] = [];
  let holding = true;
  let six!: () => void;
  const ready = new Promise<void>((resolve) => {
    six = resolve;
  });
  const fetch: typeof globalThis.fetch = async (target) => {
    const url = String(target);
    fetched.add(url);
    const index = indexes.get(url);
    if (index) return new Response(index, { headers: { "content-type": "text/turtle" } });
    if (holding && url.includes("/members/") && !url.startsWith(open)) {
      await new Promise<void>((resolve) => {
        held.push(resolve);
        if (held.length === 6) six();
      });
    }
    return new Response(null, { status: 404 });
  };
  const client = new ChatClient(fetch, ROOT, ALICE);
  const unread = client.unreadCounts(rooms);
  await ready;
  // Rooms run together: every room's index was read before any day read finished.
  expect(rooms.every(({ url }) => fetched.has(roomIndex(url)))).toBe(true);
  let done = false;
  const page = client.messages(open, { before: AT, since: AT, days: 1 }).then((result) => {
    done = true;
    return result;
  });
  let releases = 0;
  while (!done && releases < 20) {
    held.shift()?.();
    releases++;
    for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(done).toBe(true);
  expect(releases).toBeLessThanOrEqual(3);
  expect((await page).dropped).toBe(0);
  holding = false;
  for (const release of held.splice(0)) release();
  expect(await unread).toEqual(Object.fromEntries(rooms.map(({ url }) => [url, 0])));
});

it("bounds reaction sources, keeping the most recently loaded documents", async () => {
  const room = `${ROOT}chat/rooms/legacy/`;
  const bodies = new Map<string, string>([
    [roomIndex(room), await serializeChat(buildRoom(room, input))],
  ]);
  const start = Date.UTC(2025, 0, 1, 12);
  const days = 520;
  for (let i = 0; i < days; i++) {
    const at = new Date(start + i * DAY);
    const url = dayUrl(room, at);
    const message = appendMessage(new Store(), room, {
      id: "m",
      author: ALICE,
      content: "x",
      at,
    });
    const like = appendReaction(message, room, {
      id: "r",
      message: `${url}#m`,
      actor: ALICE,
      emoji: "👍",
      at,
    });
    bodies.set(url, await serializeChat(new Store([...message, ...like])));
  }
  const fetch: typeof globalThis.fetch = async (url) => {
    const body = bodies.get(String(url));
    return body
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : new Response(null, { status: 404 });
  };
  const client = new ChatClient(fetch, ROOT, ALICE);
  const sources = (client as unknown as { reactionSources: Map<string, unknown> }).reactionSources;
  const last = new Date(start + (days - 1) * DAY);
  const first = await client.messages(room, { before: last, days: 366 });
  expect(first.messages).toHaveLength(366);
  await client.messages(room, { before: first.next as Date, days: 366 });
  // Empty days hold no reactions and are not kept.
  await client.messages(room, { before: new Date(start - DAY), days: 30 });
  expect(sources.size).toBe(512);
  expect(sources.has(dayUrl(room, new Date(start)))).toBe(true);
  expect(sources.has(dayUrl(room, new Date(start + 300 * DAY)))).toBe(true);
  expect(sources.has(dayUrl(room, new Date(start - DAY)))).toBe(false);
  expect(sources.has(dayUrl(room, last))).toBe(false);
  await client.messages(room, { before: last, since: last, days: 1 });
  expect(sources.size).toBe(512);
  expect(sources.has(dayUrl(room, last))).toBe(true);
});
