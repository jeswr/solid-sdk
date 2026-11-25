// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import {
  appendMessage,
  appendReaction,
  appendUndo,
  ChatModelError,
  ChatNode,
  dayUrl,
  loadChat,
  messageSubject,
  NS,
  parseChat,
  react,
  readMessages,
  readReactions,
  sendMessage,
  serializeChat,
  tombstoneMessage,
  unreact,
} from "../../src/apps/chat/lib/model";
import { createDemoPod } from "../../src/lib/demo-pod/pod";

const root = "https://alice.example/pod/";
const room = `${root}chat/rooms/team/`;
const alice = "https://alice.example/profile#me";
const bob = "https://bob.example/profile#me";
const at = new Date("2026-11-01T11:00:00Z");
const message = messageSubject(room, at, "m1");
const day = dayUrl(room, at);
const input = { id: "one", message, actor: alice, emoji: "👍", at };
function messages() {
  return appendMessage(new Store(), room, { id: "m1", author: alice, content: "Hello", at });
}
function withLike() {
  const dataset = messages();
  return new Store([...dataset, ...appendReaction(dataset, room, input)]);
}
function foreign(
  dataset: Store,
  id: string,
  type = "Like",
  object = message,
  actor = alice,
  emoji = "👍",
) {
  const node = new ChatNode(id, dataset, DataFactory);
  node.types.add(`${NS.AS}${type}`);
  node.setIri(`${NS.AS}object`, object);
  node.setIri(`${NS.AS}attributedTo`, actor);
  node.setText(`${NS.AS}content`, emoji);
  node.setDate(`${NS.AS}published`, at);
  return node;
}

it("round-trips Like/Undo events in the message's day, preserving the source and returning only deltas", async () => {
  const original = messages();
  const delta = appendReaction(original, room, input);
  const id = `${day}#reaction-one`;
  expect([...delta].every((q) => q.subject.value === id)).toBe(true);
  expect(readReactions(original).size).toBe(0);
  const dataset = await parseChat(await serializeChat(new Store([...original, ...delta])), day);
  expect(readReactions(dataset).get(message)).toEqual([{ id, actorId: alice, emoji: "👍" }]);
  expect(readMessages(dataset).map((message) => message.id)).toEqual([message]);
  expect([...delta].find((q) => q.predicate.value === `${NS.AS}published`)?.object).toMatchObject({
    datatype: DataFactory.namedNode(`${NS.XSD}dateTime`),
    value: at.toISOString(),
  });
  const undo = appendUndo(dataset, room, {
    id: "off",
    message,
    actor: alice,
    reaction: id,
    at,
  }) as Store;
  expect([...undo].every((q) => q.subject.value === `${day}#undo-off`)).toBe(true);
  const undone = await parseChat(await serializeChat(new Store([...dataset, ...undo])), day);
  expect(readReactions(undone).size).toBe(0);
  expect(readMessages(undone).map((message) => message.id)).toEqual([message]);
  expect(readReactions(dataset).get(message)).toHaveLength(1);
});

it("ignores another author's Undo, even when events are read before their Likes", () => {
  const dataset = messages();
  foreign(dataset, `${day}#forged`, "Undo", `${day}#reaction-one`, bob);
  dataset.addQuads([...appendReaction(dataset, room, input)]);
  expect(readReactions(dataset).get(message)).toHaveLength(1);
  foreign(dataset, `${day}#unknown-undo`, "Undo", `${day}#unknown`, alice);
  foreign(dataset, `${day}#other-like`, "Like", message, bob);
  expect(readReactions(dataset).get(message)).toHaveLength(2);
  const reversed = new Store();
  foreign(reversed, `${day}#early-undo`, "Undo", `${day}#reaction-one`);
  reversed.addQuads([...dataset]);
  expect(readReactions(reversed).get(message)).toEqual([
    { id: `${day}#other-like`, actorId: bob, emoji: "👍" },
  ]);
});

it("fails closed on malformed, ambiguous, cross-day and named-graph reactions", () => {
  const dataset = messages();
  foreign(dataset, `${day}#unknown`, "Like", `${day}#not-a-message`);
  foreign(dataset, `${room}2026/11/02.ttl#cross-day`);
  foreign(dataset, day);
  foreign(dataset, `${day}#blank`, "Like", message, alice, " \t");
  foreign(dataset, `${day}#long`, "Like", message, alice, "👍".repeat(17));
  foreign(dataset, `${day}#no-content`).setText(`${NS.AS}content`, undefined);
  foreign(dataset, `${day}#no-actor`).refs(`${NS.AS}attributedTo`).clear();
  foreign(dataset, `${day}#actors`).refs(`${NS.AS}attributedTo`).add(bob);
  foreign(dataset, `${day}#objects`).refs(`${NS.AS}object`).add(`${day}#elsewhere`);
  foreign(dataset, `${day}#invalid-date`).setText(`${NS.AS}published`, "invalid");
  foreign(dataset, `${day}#ambiguous`).types.add(`${NS.AS}Undo`);
  foreign(dataset, `${day}#irrelevant`, "Announce");
  const blank = new ChatNode(DataFactory.blankNode(), dataset, DataFactory);
  blank.types.add(`${NS.AS}Like`);
  const graph = DataFactory.namedNode(`${root}graph`);
  for (const q of appendReaction(messages(), room, input)) {
    dataset.add(DataFactory.quad(q.subject, q.predicate, q.object, graph));
  }
  expect(readReactions(dataset).size).toBe(0);
  foreign(dataset, `${day}#maximum`, "Like", message, alice, "👍".repeat(16));
  expect(readReactions(dataset).get(message)?.[0]?.emoji.length).toBe(32);
});

it("never surfaces Likes or Undos as messages even if they have Note types or sioc:content", () => {
  const dataset = messages();
  for (const type of ["Like", "Undo"]) {
    const node = foreign(dataset, `${day}#${type === "Like" ? "reaction" : "undo"}-x`, type);
    node.types.add(`${NS.SIOC}Note`);
    node.types.add(`${NS.AS}Note`);
    node.setText(`${NS.SIOC}content`, "This must not be a chat message");
  }
  expect(readMessages(dataset).map((message) => message.id)).toEqual([message]);
  // Other subjects typed only as events are skipped too; a typed message is never hidden.
  foreign(dataset, `${day}#plain-like`, "Like");
  const forged = new ChatNode(message, dataset, DataFactory);
  forged.types.add(`${NS.AS}Like`);
  forged.setIri(`${NS.AS}object`, message);
  expect(readMessages(dataset).map((message) => message.id)).toEqual([message]);
});

it("accepts only emoji, stores the sanitised value and reads only the named document", () => {
  const dataset = messages();
  for (const emoji of ["abc", "123", "#", "👍 ok", "👍999", "1👍", "*️⃣9", "#👍"])
    expect(() => appendReaction(dataset, room, { ...input, id: "text", emoji })).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
  dataset.addQuads([...appendReaction(dataset, room, { ...input, emoji: " ❤️ " })]);
  expect(readReactions(dataset).get(message)?.[0]?.emoji).toBe("❤️");
  for (const emoji of ["🇳🇿", "👍🏽", "1️⃣", "#⃣", "👩‍👩‍👧", "👍1️⃣"])
    expect(appendReaction(dataset, room, { ...input, id: `e${emoji.length}`, emoji }).size).toBe(5);
  foreign(dataset, `${day}#reaction-text`, "Like", message, bob, "spam");
  expect(readReactions(dataset).get(message)).toHaveLength(1);
  expect(readReactions(dataset, day).get(message)).toHaveLength(1);
  expect(readReactions(dataset, `${room}2026/11/02.ttl`).size).toBe(0);
});

it("treats an Undo that another tab already wrote as done, without writing again", async () => {
  const dataset = withLike();
  const reaction = `${day}#reaction-one`;
  const undo = { id: "off", message, actor: alice, reaction, at };
  const undone = new Store([...dataset, ...(appendUndo(dataset, room, undo) as Store)]);
  expect(appendUndo(undone, room, { ...undo, id: "again" })).toBeNull();
  // Bob's Undo of Alice's Like does not count as Alice's.
  const forged = withLike();
  foreign(forged, `${day}#undo-bob`, "Undo", reaction, bob);
  expect(() => appendUndo(forged, room, { ...undo, actor: bob })).toThrow(
    expect.objectContaining({ code: "not-author" }),
  );
  // An inactive (non-emoji) Like that only Bob "undid" is still missing for Alice.
  const spam = `${day}#reaction-spam`;
  foreign(forged, spam, "Like", message, alice, "spam");
  foreign(forged, `${day}#undo-spam`, "Undo", spam, bob);
  expect(() => appendUndo(forged, room, { ...undo, reaction: spam })).toThrow(
    expect.objectContaining({ code: "missing-message" }),
  );
  const pod = createDemoPod({ root });
  await sendMessage(pod.fetch, room, { id: "m1", author: alice, content: "Hello", at });
  await react(pod.fetch, room, input);
  await unreact(pod.fetch, room, undo);
  const fetch = vi.fn(pod.fetch);
  const result = await unreact(fetch, room, { ...undo, id: "late" });
  expect(readReactions(result.dataset).size).toBe(0);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
});

it("validates new events and refuses missing/deleted messages, duplicate IDs and foreign Undos", () => {
  const dataset = withLike();
  for (const emoji of ["", " ", "👍".repeat(17)]) {
    expect(() => appendReaction(dataset, room, { ...input, id: "invalid", emoji })).toThrow(
      ChatModelError,
    );
  }
  expect(() => appendReaction(dataset, room, input)).toThrow(
    expect.objectContaining({ code: "duplicate" }),
  );
  expect(() => appendReaction(new Store(), room, input)).toThrow(
    expect.objectContaining({ code: "missing-message" }),
  );
  for (const invalid of [
    { actor: "invalid" },
    { at: new Date("bad") },
    { id: "bad/id" },
    { message: `${root}elsewhere.ttl#m` },
  ]) {
    expect(() => appendReaction(dataset, room, { ...input, ...invalid })).toThrow();
  }
  const deleted = tombstoneMessage(dataset, message, alice, at);
  expect(() => appendReaction(deleted, room, input)).toThrow(
    expect.objectContaining({ code: "deleted" }),
  );
  const undo = { id: "off", message, actor: alice, reaction: `${day}#reaction-one`, at };
  expect(() => appendUndo(messages(), room, undo)).toThrow(
    expect.objectContaining({ code: "missing-message" }),
  );
  expect(() => appendUndo(dataset, room, { ...undo, reaction: `${day}#unknown` })).toThrow(
    expect.objectContaining({ code: "missing-message" }),
  );
  expect(() => appendUndo(dataset, room, { ...undo, actor: bob })).toThrow(
    expect.objectContaining({ code: "not-author" }),
  );
  const withUndo = new Store([...dataset, ...(appendUndo(dataset, room, undo) as Store)]);
  expect(() => appendUndo(withUndo, room, undo)).toThrow(
    expect.objectContaining({ code: "duplicate" }),
  );
  new ChatNode(message, dataset, DataFactory).setDate(`${NS.SCHEMA}dateDeleted`, at);
  expect(() => appendReaction(dataset, room, input)).toThrow(
    expect.objectContaining({ code: "deleted" }),
  );
});

it("PATCHes only new Like/Undo subjects with If-Match and never rewrites or creates a day", async () => {
  const pod = createDemoPod({ root });
  await sendMessage(pod.fetch, room, { id: "m1", author: alice, content: "Hello", at });
  const fetch = vi.fn(pod.fetch);
  const added = await react(fetch, room, input);
  const reaction = `${day}#reaction-one`;
  const removed = await unreact(fetch, room, { id: "off", message, actor: alice, reaction, at });
  expect(readReactions(added.dataset).get(message)).toHaveLength(1);
  expect(readReactions(removed.dataset).size).toBe(0);
  const patches = fetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(patches).toHaveLength(2);
  for (const [index, [url, init]] of patches.entries()) {
    expect(url).toBe(day);
    expect(new Headers(init?.headers).get("if-match")).toMatch(/^"/);
    expect(new Headers(init?.headers).get("content-type")).toBe("application/sparql-update");
    const body = String(init?.body);
    expect(body.startsWith("INSERT DATA {\n")).toBe(true);
    const delta = await parseChat(
      body.slice("INSERT DATA {\n".length, -2),
      day,
      "application/n-triples",
    );
    expect(
      [...delta].every((q) => q.subject.value === (index === 0 ? reaction : `${day}#undo-off`)),
    ).toBe(true);
  }
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  const missing = `${room}2026/10/31.ttl#m1`;
  await expect(react(fetch, room, { ...input, message: missing })).rejects.toMatchObject({
    code: "missing-message",
  });
  expect(pod.snapshot().resources.some(([url]) => url === missing.split("#")[0])).toBe(false);
});

it("re-reads and retries a real stale ETag once, retaining concurrent messages and reactions", async () => {
  const pod = createDemoPod({ root });
  await sendMessage(pod.fetch, room, { id: "m1", author: alice, content: "Hello", at });
  let raced = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (init?.method === "PATCH" && !raced) {
      raced = true;
      await react(pod.fetch, room, { ...input, id: "other", actor: bob });
    }
    return pod.fetch(url, init);
  });
  const result = await react(fetch, room, input);
  expect(readReactions(result.dataset).get(message)).toHaveLength(2);
  const patches = fetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(patches).toHaveLength(2);
  expect(new Headers(patches[0]?.[1]?.headers).get("if-match")).not.toBe(
    new Headers(patches[1]?.[1]?.headers).get("if-match"),
  );
  expect(patches[0]?.[1]?.body).toBe(patches[1]?.[1]?.body);
  const failing = (status: number) =>
    vi.fn<typeof globalThis.fetch>(async (url, init) =>
      init?.method === "PATCH" ? new Response(null, { status }) : pod.fetch(url, init),
    );
  const conflicts = failing(412);
  await expect(react(conflicts, room, { ...input, id: "conflict" })).rejects.toMatchObject({
    status: 412,
  });
  expect(conflicts.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  const unavailable = failing(503);
  await expect(react(unavailable, room, { ...input, id: "failure" })).rejects.toMatchObject({
    status: 503,
  });
  expect(unavailable.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  const doc = await loadChat(pod.fetch, room, day);
  const noEtag = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(await serializeChat(doc.dataset), {
        headers: { "content-type": "text/turtle" },
      }),
  );
  await expect(react(noEtag, room, { ...input, id: "no-etag" })).rejects.toMatchObject({
    code: "missing-etag",
  });
  expect(noEtag).toHaveBeenCalledTimes(2);
  const noResponseEtag: typeof globalThis.fetch = async (url, init) =>
    init?.method === "PATCH" ? new Response(null, { status: 204 }) : pod.fetch(url, init);
  expect((await react(noResponseEtag, room, { ...input, id: "no-response-etag" })).etag).toBeNull();
});
