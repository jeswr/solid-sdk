// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { longChatToCanonical } from "@jeswr/solid-chat-interop";
import { AclResource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import {
  appendMessage,
  buildRoom,
  buildRoomAcl,
  CHAT_READ_PREFERENCE_KEY,
  ChatModelError,
  ChatNode,
  countUnread,
  dayKey,
  dayPage,
  dayUrl,
  editMessage,
  httpIri,
  isoDate,
  joinedRoomsUrl,
  joinRoom,
  markRoomRead,
  messageResource,
  messageSubject,
  NS,
  parseChat,
  RDF_TYPE,
  readDate,
  readJoinedRooms,
  readMessages,
  readPreferencesSchema,
  readRefs,
  readRoom,
  readText,
  roomContainer,
  roomIndex,
  segment,
  serializeChat,
  strongEtag,
  text,
  tombstoneMessage,
  turnIntoTask,
} from "../../src/apps/chat/lib/model";

const room = "https://alice.example/pod/chat/rooms/team/";
const alice = "https://alice.example/profile#me";
const bob = "https://bob.example/profile#me";
const at = new Date("2026-10-26T11:00:00Z");
const later = new Date("2026-10-26T12:00:00Z");
const input = { id: "m1", author: alice, content: "hello", at };
const subject = messageSubject(room, at, "m1");

it("uses UTC day shards and bounded inclusive backwards pages", () => {
  expect(dayKey(new Date("2026-01-01T01:00:00+02:00"))).toBe("2025/12/31");
  expect(dayUrl(room, at)).toBe(`${room}2026/10/26.ttl`);
  expect(messageSubject(room, at, "a_2-3")).toBe(`${dayUrl(room, at)}#a_2-3`);
  expect(messageResource(room, subject)).toBe(dayUrl(room, at));
  expect(roomContainer(room.slice(0, -1))).toBe(room);
  expect(roomIndex(room)).toBe(`${room}index.ttl`);
  expect(joinedRoomsUrl("https://alice.example/pod")).toBe(
    "https://alice.example/pod/chat/rooms.ttl",
  );
  const page = dayPage(room, new Date("2024-03-01T23:00Z"), new Date("2024-02-28"), 2);
  expect(page.urls).toEqual([`${room}2024/03/01.ttl`, `${room}2024/02/29.ttl`]);
  expect(page.next?.toISOString()).toBe("2024-02-28T00:00:00.000Z");
  expect(dayPage(room, page.next as Date, new Date("2024-02-28"), 2).next).toBeNull();
  expect(dayPage(room, at, later, 1).urls).toHaveLength(1);
  expect(dayPage(room, at, new Date("2026-10-27"), 1)).toEqual({ urls: [], next: null });
  expect(dayPage(room, new Date("0001-01-01"), new Date("0001-01-01"), 1).next).toBeNull();
  for (const days of [0, 367, 1.5, NaN])
    expect(() => dayPage(room, at, at, days)).toThrow(ChatModelError);
});

it("validates identifiers, content, dates and strong preconditions without echoing values", () => {
  expect(httpIri(alice)).toBe(alice);
  expect(segment("room-1_2")).toBe("room-1_2");
  expect(text(" a\u001b b ")).toBe("a b");
  expect(isoDate(at)).toBe(at.toISOString());
  expect(strongEtag('"v1"')).toBe('"v1"');
  for (const value of [
    "no",
    "file:///tmp/x",
    "https://user:secret@example.com/a",
    "https://:secret@example.com/a",
    "https://a.example/>",
  ])
    expect(() => httpIri(value)).toThrow(ChatModelError);
  for (const value of ["", "../a", "a/b", "x#y"])
    expect(() => segment(value)).toThrow(ChatModelError);
  for (const value of ["", "\u001b", " \n"]) expect(() => text(value)).toThrow(ChatModelError);
  for (const value of [null, 'W/"x"', "*", "", '"x\r\n"'])
    expect(() => strongEtag(value)).toThrow("missing-etag");
  for (const value of [new Date(NaN), new Date("0000-01-01"), new Date("+010000-01-01")])
    expect(() => isoDate(value)).toThrow(ChatModelError);
  for (const url of [`${room}?x=1`, `${room}#it`])
    expect(() => roomContainer(url)).toThrow(ChatModelError);
  for (const id of [
    `${room}index.ttl#it`,
    `${dayUrl(room, at)}`,
    `${subject}?x`,
    `${dayUrl(room, at)}#invalid/slash`,
    `${dayUrl(room, at)}?x#it`,
  ])
    expect(() => messageResource(room, id)).toThrow(ChatModelError);
  expect(() => messageResource(room, "https://other.example/2026/10/26.ttl#it")).toThrow();
});

it("round-trips room descriptors, legacy membership and joined lists without mutating input", async () => {
  const input = { name: " Team ", creator: alice, created: at, members: [bob, alice, bob] };
  const dataset = buildRoom(room, input);
  const parsed = await parseChat(await serializeChat(dataset), roomIndex(room));
  expect(readRoom(room, parsed)).toEqual({
    id: `${roomIndex(room)}#it`,
    name: "Team",
    creator: alice,
    created: at.toISOString(),
    members: [alice, bob],
  });
  expect(readRoom(room, new Store())).toBeUndefined();
  const legacy = await parseChat(
    `@prefix pc: <https://w3id.org/jeswr/pod-chat#>. <#it> a pc:ChatRoom; pc:participant <${bob}>; <${NS.AS}attributedTo> <${alice}>.`,
    roomIndex(room),
  );
  expect(readRoom(room, legacy)).toEqual({
    id: `${roomIndex(room)}#it`,
    name: "",
    creator: undefined,
    created: undefined,
    members: [alice, bob],
  });
  const longRoom = await parseChat(`<#it> a <${NS.MEETING}LongChat>.`, roomIndex(room));
  expect(readRoom(room, longRoom)?.members).toEqual([]);
  const url = joinedRoomsUrl("https://alice.example/pod/");
  const empty = new Store();
  const joined = joinRoom(url, empty, room);
  expect(empty.size).toBe(0);
  expect(readJoinedRooms(url, joined)).toEqual([room]);
  expect(joinRoom(url, joined, room).size).toBe(joined.size);
  expect(readJoinedRooms(url, empty)).toEqual([]);
});

it("builds default-inheriting ACLs with owner control and only member Read+Append", async () => {
  const url = `${room}.acl`;
  const dataset = buildRoomAcl(room, url, alice, [bob, bob, alice]);
  const parsed = await parseChat(await serializeChat(dataset), url);
  const rules = [...new AclResource(parsed, DataFactory).authorizations];
  expect(rules).toHaveLength(2);
  const owner = rules.find((rule) => rule.agent.has(alice));
  const member = rules.find((rule) => rule.agent.has(bob));
  expect(owner?.canReadWriteAcl).toBe(true);
  expect(owner?.canWrite).toBe(true);
  expect([...(member?.mode ?? [])].sort()).toEqual([`${NS.ACL}Append`, `${NS.ACL}Read`]);
  expect(member?.default).toBe(room);
  expect(member?.accessTo).toBe(room);
  expect(member?.agentClass.size).toBe(0);
  expect(member?.canReadWriteAcl).toBe(false);
  expect([
    ...new AclResource(buildRoomAcl(room, url, alice, []), DataFactory).authorizations,
  ]).toHaveLength(1);
  expect(() => buildRoomAcl(room, `${url}#x`, alice, [])).toThrow(ChatModelError);
});

it("appends multiple subjects, preserves unrelated data, and round-trips replies", async () => {
  const original = buildRoom(room, { name: "Team", creator: alice, created: at, members: [] });
  const first = appendMessage(original, room, input);
  const second = appendMessage(first, room, {
    ...input,
    id: "m2",
    author: bob,
    content: 'line 1\n"quote" \\ line 2',
    inReplyTo: subject,
  });
  expect(original.size).toBeLessThan(first.size);
  expect(readMessages(first)).toHaveLength(1);
  const parsed = await parseChat(await serializeChat(second), dayUrl(room, at));
  expect(readMessages(parsed).map((message) => message.id)).toEqual([
    subject,
    `${dayUrl(room, at)}#m2`,
  ]);
  expect(readMessages(parsed)[1]).toMatchObject({
    inReplyTo: subject,
    author: bob,
    room: `${roomIndex(room)}#it`,
    tombstone: false,
  });
  expect(() => appendMessage(second, room, input)).toThrow("duplicate");
  expect(() =>
    appendMessage(first, room, { ...input, id: "new", inReplyTo: "javascript:alert(1)" }),
  ).toThrow();
});

it("edits own message, applies and replaces wf:Task overlay, then erases body with a tombstone", async () => {
  const original = appendMessage(new Store(), room, input);
  const edited = editMessage(original, subject, alice, "edited", later);
  expect(readMessages(original)[0]?.content).toBe("hello");
  expect(readMessages(edited)[0]).toMatchObject({
    content: "edited",
    published: at.toISOString(),
    updated: later.toISOString(),
  });
  expect(longChatToCanonical(edited, subject)?.content).toBe("edited");
  const tasked = turnIntoTask(
    edited,
    subject,
    alice,
    { state: "open", title: "Lunch", assignee: bob },
    later,
  );
  expect(readMessages(tasked)[0]?.task).toEqual({ state: "open", title: "Lunch", assignee: bob });
  const closed = turnIntoTask(tasked, subject, alice, { state: "closed" }, later);
  expect(readMessages(closed)[0]?.task).toEqual({ state: "closed" });
  expect(new ChatNode(subject, closed, DataFactory).types.has(`${NS.WF}Open`)).toBe(false);
  const deleted = tombstoneMessage(tasked, subject, alice, later);
  const parsed = await parseChat(await serializeChat(deleted), dayUrl(room, at));
  expect(readMessages(parsed)[0]).toMatchObject({
    id: subject,
    content: "",
    author: alice,
    published: at.toISOString(),
    updated: later.toISOString(),
    deletedAt: later.toISOString(),
    tombstone: true,
  });
  expect(readMessages(parsed)[0]?.task).toBeUndefined();
  expect(readText(parsed, subject, `${NS.SIOC}content`)).toBeUndefined();
  expect(readRefs(parsed, subject, RDF_TYPE)).toEqual([`${NS.AS}Tombstone`]);
  expect(() => editMessage(deleted, subject, alice, "revive", later)).toThrow("deleted");
  expect(() => editMessage(original, subject, bob, "forged", later)).toThrow("not-author");
  expect(() => tombstoneMessage(new Store(), subject, alice, later)).toThrow("missing-message");
  expect(() => turnIntoTask(original, subject, alice, { state: "bad" as "open" }, later)).toThrow(
    "invalid-input",
  );
  expect(() =>
    turnIntoTask(
      original,
      subject,
      alice,
      { state: "open", assignee: "file:///etc/passwd" },
      later,
    ),
  ).toThrow();
  const legacyDeleted = await parseChat(
    `<${subject}> a <${NS.AS}Note>; <${NS.AS}attributedTo> <${alice}>; <${NS.SCHEMA}dateDeleted> "2026-10-26T12:00:00Z"^^<${NS.XSD}dateTime>.`,
    dayUrl(room, at),
  );
  expect(() => editMessage(legacyDeleted, subject, alice, "revive", later)).toThrow("deleted");
});

it("parses a LongChat fixture through interop and edits without losing its task or reply", async () => {
  const body = readFileSync(new URL("./fixtures/longchat.ttl", import.meta.url), "utf8");
  const dataset = await parseChat(body, dayUrl(room, at));
  const messages = readMessages(dataset);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject(longChatToCanonical(dataset, subject) as object);
  expect(messages[1]).toMatchObject({
    content: "Bring lunch",
    author: bob,
    task: { state: "open", title: "Lunch", assignee: alice },
    inReplyTo: subject,
  });
  expect(readMessages(editMessage(dataset, subject, alice, "New time", later))[0]?.content).toBe(
    "New time",
  );
});

it("round-trips LongChat tombstones with their author, publication time and chronological position", async () => {
  const body = readFileSync(new URL("./fixtures/longchat.ttl", import.meta.url), "utf8");
  const dataset = await parseChat(body, dayUrl(room, at));
  const id = messageSubject(room, at, "m2");
  const deleted = tombstoneMessage(dataset, id, bob, later);
  const messages = readMessages(await parseChat(await serializeChat(deleted), dayUrl(room, at)));
  expect(messages.map((message) => message.id)).toEqual([subject, id]);
  expect(messages[1]).toMatchObject({
    author: bob,
    published: "2026-10-26T11:01:00.000Z",
    content: "",
    tombstone: true,
    updated: later.toISOString(),
    deletedAt: later.toISOString(),
  });
  expect(readRefs(deleted, id, `${NS.FOAF}maker`)).toEqual([bob]);
  expect(readDate(deleted, id, `${NS.DCT}created`)).toBe("2026-10-26T11:01:00.000Z");
  expect(readMessages(dataset)[1]?.content).toBe("Bring lunch");
});

it("prefers valid AS tombstone metadata and falls back per predicate to LongChat metadata", async () => {
  const dataset = await parseChat(
    `<#m1> a <${NS.AS}Tombstone>;
      <${NS.AS}attributedTo> <${alice}>; <${NS.FOAF}maker> <${bob}>;
      <${NS.AS}published> "2026-10-26T11:00:00Z"; <${NS.DCT}created> "2026-10-26T11:01:00Z".
    <#m2> a <${NS.AS}Tombstone>;
      <${NS.AS}attributedTo> "invalid"; <${NS.FOAF}maker> <${bob}>;
      <${NS.AS}published> "invalid"; <${NS.DCT}created> "2026-10-26T11:01:00Z".`,
    dayUrl(room, at),
  );
  expect(readMessages(dataset).map(({ author, published }) => ({ author, published }))).toEqual([
    { author: alice, published: at.toISOString() },
    { author: bob, published: "2026-10-26T11:01:00.000Z" },
  ]);
});

it("handles foreign malformed fields per predicate and ignores unrelated/blank/named-graph subjects", async () => {
  const dataset = await parseChat(
    `
    <#unknown> a <${NS.AS}Person>. [] a <${NS.AS}Note>.
    <#bare> a <${NS.AS}Note>. <#tomb> a <${NS.AS}Tombstone>.
    <#broken> a <${NS.AS}Note>, "wrong"; <${NS.AS}published> "bad"; <${NS.AS}updated> <https://wrong.example/date>.
    <#broken> <${NS.VCARD}hasMember> <${alice}>, "wrong", <javascript:bad>.
    <#date> <${NS.AS}updated> "2026-10-26".
  `,
    dayUrl(room, at),
  );
  expect(readMessages(dataset).map((m) => m.id)).toEqual(
    ["bare", "broken", "tomb"].map((id) => `${dayUrl(room, at)}#${id}`),
  );
  expect(readRefs(dataset, `${dayUrl(room, at)}#broken`, `${NS.VCARD}hasMember`)).toEqual([alice]);
  expect(readDate(dataset, `${dayUrl(room, at)}#date`, `${NS.AS}updated`)).toBe(
    "2026-10-26T00:00:00.000Z",
  );
  expect(readText(dataset, `${dayUrl(room, at)}#broken`, `${NS.AS}updated`)).toBeUndefined();
  const named = await parseChat(
    `<${subject}> <${NS.AS}content> "forged" <https://evil.example/graph>.`,
    dayUrl(room, at),
    "application/n-quads",
  );
  const live = appendMessage(new Store(), room, input);
  live.addQuads([...named]);
  expect(readMessages(live)[0]?.content).toBe("hello");
  await expect(serializeChat(named)).rejects.toThrow("invalid-input");
  const unsafe = new Store();
  new ChatNode(`${subject}>`, unsafe, DataFactory).types.add(`${NS.AS}Note`);
  await expect(serializeChat(unsafe)).rejects.toThrow("invalid-input");
  expect(await serializeChat(new Store())).toBe("");
  expect(
    (
      await parseChat(
        '{"@id":"#it","https://schema.org/name":"hello"}',
        roomIndex(room),
        "application/ld+json",
      )
    ).size,
  ).toBe(1);
  await expect(
    parseChat(
      '{"@context":"https://evil.example/context"}',
      roomIndex(room),
      "application/ld+json",
    ),
  ).rejects.toThrow();
});

it("validates preference payloads and merges read markers monotonically without mutating them", () => {
  expect(CHAT_READ_PREFERENCE_KEY).toBe("chat.lastRead");
  const initial = [
    { roomId: room, lastRead: null },
    { roomId: "https://z.example/room/", lastRead: 0 },
  ];
  const read = markRoomRead(initial, room, at);
  expect(initial[0]?.lastRead).toBeNull();
  expect(read[0]?.lastRead).toBe(at.getTime());
  expect(markRoomRead(read, room, new Date(0))[0]?.lastRead).toBe(at.getTime());
  expect(markRoomRead([], room, at)).toEqual([{ roomId: room, lastRead: at.getTime() }]);
  expect(readPreferencesSchema.safeParse([{ roomId: room, lastRead: 1.5 }]).success).toBe(false);
  expect(readPreferencesSchema.safeParse([{ roomId: "javascript:x", lastRead: 0 }]).success).toBe(
    false,
  );
  expect(() => markRoomRead([{ roomId: room, lastRead: NaN }], room, at)).toThrow();
  expect(
    countUnread(
      {
        roomId: room,
        lastRead: at.getTime(),
        messages: [
          {
            id: subject,
            roomId: room,
            senderId: bob,
            timestamp: later.getTime(),
            mentionIds: [alice],
          },
        ],
      },
      alice,
    ),
  ).toEqual({ unreadCount: 1, mentionCount: 1 });
});

it("refuses control-bearing literals before serialization", async () => {
  const dataset = new Store();
  new ChatNode(subject, dataset, DataFactory).setText(`${NS.AS}content`, "bad\u001btext");
  await expect(serializeChat(dataset)).rejects.toThrow("invalid-input");
});

it("drops invalid foreign date literals", () => {
  const dataset = new Store();
  new ChatNode(subject, dataset, DataFactory).setText(`${NS.AS}updated`, "not a date");
  expect(readDate(dataset, subject, `${NS.AS}updated`)).toBeUndefined();
});

it("preserves composer whitespace while rejecting whitespace-only bodies", () => {
  const original = appendMessage(new Store(), room, {
    ...input,
    content: "  indented\nnext line\n",
  });
  expect(readMessages(original)[0]?.content).toBe("  indented\nnext line\n");
  const edited = editMessage(original, subject, alice, "  changed\n", later);
  expect(readMessages(edited)[0]?.content).toBe("  changed\n");
});
