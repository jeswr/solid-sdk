// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, type Outbox, withOutbox } from "@jeswr/suite-sdk/offline";
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import { dayUrl } from "../src/apps/chat/lib/model";
import { type MessageIntent, messageChannel } from "../src/apps/chat/state/message-channel";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const root = "https://alice.demo.pod/";
const webId = `${root}profile/card#me`;
const at = new Date("2026-11-11T20:00:00.000Z");
const boxes: Outbox[] = [];
function fixture(fetch: typeof globalThis.fetch) {
  const outbox = createOutbox({ webId, idb: new IDBFactory() });
  boxes.push(outbox);
  const raw = createMemoryStorage({ root, protocol: "solid" });
  const controller = new AbortController();
  messageChannel.register({
    registerGuardPolicy: (tag, matches) => outbox.registerGuardPolicy(tag, matches),
    registerReplayDelegate: (tag, factory) =>
      outbox.registerDelegate(
        tag,
        factory({ storage: raw, fetch, webId, signal: controller.signal }),
      ),
  });
  return { outbox, raw, storage: withOutbox(raw, outbox), controller };
}
afterEach(() => {
  for (const box of boxes.splice(0)) box.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("delivers through the existing model with the session WebID, merges another participant's message and retries one real 412", async () => {
  const pod = createDemoPod({ root });
  const client = new ChatClient(pod.fetch, root, webId);
  const room = (await client.createRoom({ name: "Intent room", members: [] })).url;
  await client.send(room, "Existing", { id: "existing", at });
  let raced = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (init?.method === "PATCH" && !raced) {
      raced = true;
      await client.send(room, "Concurrent", { id: "concurrent", at });
    }
    return pod.fetch(input, init);
  });
  const h = fixture(fetch);
  const intent: MessageIntent = {
    room,
    id: "stable",
    at: at.toISOString(),
    content: "Intent message",
  };
  expect((await messageChannel.submit(h.storage, intent)).queued).toBeUndefined();
  const messages = await client.messages(room, { before: at, since: at, days: 1 });
  expect(messages.messages.map((message) => message.content).sort()).toEqual([
    "Concurrent",
    "Existing",
    "Intent message",
  ]);
  expect(messages.messages.find((message) => message.id.endsWith("#stable"))?.author).toBe(webId);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  for (const [, init] of fetch.mock.calls) {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("content-type")).not.toBe("application/json");
  }
});

it("classifies a wrapped read network failure as queueable and does not queue HTTP failures", async () => {
  const room = `${root}chat/rooms/a/`;
  const intent = { room, id: "stable", at: at.toISOString(), content: "Message" };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const h = fixture(fetch);
  expect((await messageChannel.submit(h.storage, intent)).queued).toBe(true);
  expect(h.outbox.pending()).toHaveLength(1);
  fetch.mockResolvedValue(new Response(null, { status: 403 }));
  await h.outbox.replay(h.raw);
  expect(h.outbox.pending()[0]?.status).toBe("failed");
  await expect(messageChannel.submit(h.storage, { ...intent, id: "other" })).rejects.toBeInstanceOf(
    RdfFetchError,
  );
  expect(h.outbox.pending()).toHaveLength(1);
});

it("persists an exhausted 412 as a conflict and leaves its stable intent bytes available", async () => {
  const pod = createDemoPod({ root });
  const client = new ChatClient(pod.fetch, root, webId);
  const room = (await client.createRoom({ name: "Conflict room", members: [] })).url;
  await client.send(room, "Existing", { id: "existing", at });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) =>
    init?.method === "PATCH" ? new Response(null, { status: 412 }) : pod.fetch(input, init),
  );
  const h = fixture(fetch);
  vi.stubGlobal("navigator", { onLine: false });
  const intent = { room, id: "stable", at: at.toISOString(), content: "Message" };
  await messageChannel.submit(h.storage, intent);
  await h.outbox.replay(h.raw);
  expect(h.outbox.pending()[0]?.status).toBe("conflict");
  expect(h.outbox.conflicts()).toHaveLength(1);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  expect(
    JSON.parse(
      new TextDecoder().decode(
        (await h.outbox.localBody(h.outbox.conflicts()[0]?.id as string)) as Uint8Array,
      ),
    ),
  ).toEqual(intent);
});

it("rejects destination substitution and blocks stripped guards before any pod I/O", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const h = fixture(fetch);
  const room = `${root}chat/rooms/a/`;
  const url = dayUrl(room, at);
  await h.outbox.enqueue({
    op: "write",
    url,
    body: JSON.stringify({
      room: `${root}chat/rooms/b/`,
      id: "stable",
      at: at.toISOString(),
      content: "Private",
    }),
    contentType: "application/json",
    guard: { tag: messageChannel.tag },
  });
  await h.outbox.enqueue({ op: "write", url, body: "private", contentType: "application/json" });
  await h.outbox.replay(h.raw);
  expect(h.outbox.pending()).toMatchObject([
    { status: "failed", error: "Intent destination mismatch" },
    { blocked: "guard-required" },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("passes cancellation to domain requests and refuses an ended session before dispatch", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    init?.signal?.throwIfAborted();
    throw new DOMException("Cancelled", "AbortError");
  });
  const h = fixture(fetch);
  h.controller.abort();
  await expect(
    messageChannel.submit(h.storage, {
      room: `${root}chat/rooms/a/`,
      id: "stable",
      at: at.toISOString(),
      content: "Message",
    }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(h.outbox.pending()).toEqual([]);
});
