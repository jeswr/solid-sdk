// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import {
  createOutbox,
  type IntentSession,
  type Outbox,
  withOutbox,
} from "@jeswr/suite-sdk/offline";
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient, type Message } from "../src/apps/chat/lib/client";
import { messageSubject } from "../src/apps/chat/lib/model";
import { ChatLocalState } from "../src/apps/chat/state/local-state";
import { decodeMessageIntent, messageChannel } from "../src/apps/chat/state/message-channel";
import { ChatOutbox } from "../src/apps/chat/state/outbox";
import { exclusiveLocks } from "./drive-locks";

const { IDBFactory } = createRequire(`${process.cwd()}/../../packages/solid-offline/package.json`)(
  "fake-indexeddb",
) as { IDBFactory: new () => IDBFactory };
const root = "https://alice.example/";
const room = `${root}chat/rooms/a/`;
const webId = `${root}profile#me`;
const boxes: Outbox[] = [];
const cleanups: Array<() => void> = [];
function localStorageFixture() {
  const data = new Map<string, string>();
  const local: Storage = {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
  vi.stubGlobal("localStorage", local);
  return local;
}
function sent(target: string, content: string, input?: { id?: string; at?: Date }): Message {
  return {
    id: messageSubject(target, input?.at as Date, input?.id as string),
    content,
    author: webId,
    mediaType: "text/plain",
    updated: undefined,
    tombstone: false,
    deleted: false,
    edited: false,
  };
}
function setup(idb = new IDBFactory(), identity = webId) {
  const outbox = createOutbox({ webId: identity, idb });
  boxes.push(outbox);
  const raw = createMemoryStorage({ root, protocol: "solid" });
  const storage = withOutbox(raw, outbox);
  const controller = new AbortController();
  const direct = {
    webId: identity,
    send: vi.fn(async (target: string, content: string, input?: { id?: string; at?: Date }) =>
      sent(target, content, input),
    ),
  };
  const adapter = new ChatOutbox(direct, false);
  const session: IntentSession = {
    registerGuardPolicy: (tag, matches) => outbox.registerGuardPolicy(tag, matches),
    registerReplayDelegate: (tag, factory) =>
      outbox.registerDelegate(
        tag,
        factory({
          storage: raw,
          webId: identity,
          fetch: vi.fn<typeof fetch>(),
          signal: controller.signal,
        }),
      ),
  };
  const register = () => {
    const stop = messageChannel.register(session);
    cleanups.push(stop);
    return stop;
  };
  const connect = () => {
    const stop = adapter.connect({ outbox, storage, signal: controller.signal });
    cleanups.push(stop);
    return stop;
  };
  return { outbox, raw, storage, adapter, direct, controller, register, connect };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const box of boxes.splice(0)) box.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("derives offline sends from the real outbox, replays in order, and keeps canonical message IDs", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const delivered = vi
    .spyOn(ChatClient.prototype, "send")
    .mockImplementation(async (target, content, input) => sent(target, content, input));
  const h = setup();
  h.register();
  h.connect();
  const changed = vi.fn();
  const stop = h.adapter.subscribe(changed);
  h.adapter.send(room, "one");
  h.adapter.send(room, "two");
  const ids = h.adapter.snapshot().map((item) => item.id);
  await vi.waitFor(() => expect(h.outbox.pending()).toHaveLength(2));
  expect(h.adapter.snapshot().map((item) => item.status)).toEqual(["sending", "sending"]);
  h.adapter.flush();
  h.adapter.flush();
  expect(delivered).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", { onLine: true });
  await h.outbox.replay(h.raw);
  await vi.waitFor(() => expect(h.adapter.snapshot()).toEqual([]));
  expect(delivered.mock.calls.map(([, content]) => content)).toEqual(["one", "two"]);
  expect(
    delivered.mock.calls.map(([target, , input]) =>
      messageSubject(target, input?.at as Date, input?.id as string),
    ),
  ).toEqual(ids);
  expect(h.direct.send).not.toHaveBeenCalled();
  stop();
  const calls = changed.mock.calls.length;
  h.adapter.acknowledge(new Set(["unknown"]));
  expect(changed).toHaveBeenCalledTimes(calls);
});

it("retains durable failures across reopen, maps retry/discard to item IDs, and isolates WebIDs", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const idb = new IDBFactory();
  const h = setup(idb);
  h.register();
  const disconnect = h.connect();
  const delivered = vi
    .spyOn(ChatClient.prototype, "send")
    .mockRejectedValue(new Error("forbidden"));
  h.adapter.send(room, "Keep this");
  const canonical = h.adapter.snapshot()[0]?.id as string;
  await vi.waitFor(() => expect(h.outbox.pending()).toHaveLength(1));
  disconnect();
  h.outbox.close();
  const next = setup(idb);
  next.register();
  next.connect();
  const other = setup(idb, "https://bob.example/#me");
  other.connect();
  await next.outbox.replay(next.raw);
  await vi.waitFor(() => expect(next.adapter.snapshot()[0]?.status).toBe("failed"));
  expect(next.adapter.snapshot()[0]?.id).toBe(canonical);
  expect(next.adapter.snapshot()[0]?.at).toBeInstanceOf(Date);
  expect(other.adapter.snapshot()).toEqual([]);
  next.adapter.flush();
  expect(delivered).toHaveBeenCalledOnce();
  delivered.mockImplementation(async (target, content, input) => sent(target, content, input));
  const retry = vi.spyOn(next.outbox, "retry");
  const durableId = next.outbox.pending()[0]?.id;
  next.adapter.retry(canonical);
  await vi.waitFor(() => expect(next.outbox.pending()).toEqual([]));
  expect(retry).toHaveBeenCalledWith(durableId);
  expect(delivered.mock.calls[0]).toEqual(delivered.mock.calls[1]);
  next.adapter.send(room, "Discard this");
  await vi.waitFor(() => expect(next.outbox.pending()).toHaveLength(1));
  await vi.waitFor(() => expect(next.adapter.snapshot()[0]?.draft).toBe("Discard this"));
  const discard = vi.spyOn(next.outbox, "discard");
  next.adapter.discard(next.adapter.snapshot()[0]?.id as string);
  await vi.waitFor(() => expect(next.outbox.pending()).toEqual([]));
  expect(discard).toHaveBeenCalledOnce();
});

it("online sends use the delegate, queue network failures, and preserve stable intent identity on retry", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  const delivered = vi
    .spyOn(ChatClient.prototype, "send")
    .mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const h = setup();
  h.register();
  h.connect();
  const rawWrite = vi.spyOn(h.raw, "write");
  h.adapter.send(room, "Retry me");
  await vi.waitFor(() => expect(h.outbox.pending()).toHaveLength(1));
  delivered.mockImplementation(async (target, content, input) => sent(target, content, input));
  await h.outbox.replay(h.raw);
  expect(delivered.mock.calls[0]).toEqual(delivered.mock.calls[1]);
  expect(rawWrite).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(h.adapter.snapshot()).toEqual([]));
  h.adapter.send(room, "Online");
  await vi.waitFor(() => expect(h.adapter.snapshot()[0]?.status).toBeUndefined());
  const id = h.adapter.snapshot()[0]?.id as string;
  h.adapter.acknowledge(new Set([id]));
  expect(h.adapter.snapshot()).toEqual([]);
});

it("stays blocked without a delegate and refuses raw writes to chat day resources", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const h = setup();
  h.connect();
  h.adapter.send(room, "Blocked");
  await vi.waitFor(() => expect(h.outbox.pending()[0]?.blocked).toBe("no-delegate"));
  const delivered = vi
    .spyOn(ChatClient.prototype, "send")
    .mockImplementation(async (target, content, input) => sent(target, content, input));
  await h.outbox.replay(h.raw);
  expect(delivered).not.toHaveBeenCalled();
  h.register();
  await expect(
    h.storage.write(h.outbox.pending()[0]?.url as string, "intent bytes", {
      contentType: "application/json",
      ifMatch: "*",
      offline: "queue",
    }),
  ).rejects.toThrow("guard required");
  await h.outbox.replay(h.raw);
  expect(delivered).toHaveBeenCalledOnce();
});

it("imports legacy sends once per WebID, drops invalid entries, and keeps drafts", async () => {
  const storage = localStorageFixture();
  storage.setItem("solid-suite:chat:v1:outbox:corrupt-key", "broken");
  vi.stubGlobal("navigator", { onLine: false });
  const local = new ChatLocalState(webId);
  const legacy = {
    localId: "legacy",
    at: "2026-11-11T23:30:00.000Z",
    draft: "2026-01-01",
    status: "failed",
  };
  local.write("outbox", room, [
    null,
    { ...legacy, at: "bad" },
    { ...legacy, localId: "bad/id" },
    legacy,
  ]);
  local.setDraft(room, "Unsent draft");
  new ChatLocalState("https://bob.example/#me").write("outbox", room, [legacy]);
  const h = setup();
  h.register();
  const stop = h.connect();
  await vi.waitFor(() => expect(local.read("outbox", room)).toEqual([]));
  expect(h.outbox.pending()).toHaveLength(1);
  const body = new TextDecoder().decode(
    (await h.outbox.localBody(h.outbox.pending()[0]?.id as string)) as Uint8Array,
  );
  expect(JSON.parse(body)).toEqual({ room, id: "legacy", at: legacy.at, content: legacy.draft });
  stop();
  h.connect();
  await h.outbox.ready;
  expect(h.outbox.pending()).toHaveLength(1);
  expect(new ChatLocalState(webId).draft(room)).toBe("Unsent draft");
  expect(new ChatLocalState("https://bob.example/#me").read("outbox", room)).toEqual([legacy]);
});

it("waits for session readiness and fences refreshes after disconnect", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const h = setup();
  h.register();
  h.adapter.send(room, "Opening storage");
  expect(h.outbox.pending()).toEqual([]);
  const disconnect = h.connect();
  await vi.waitFor(() => expect(h.outbox.pending()).toHaveLength(1));
  await vi.waitFor(() => expect(h.adapter.snapshot()).toHaveLength(1));
  disconnect();
  const before = h.adapter.snapshot();
  await h.outbox.purge();
  expect(h.adapter.snapshot()).toBe(before);
});

it("serializes the one-time legacy import across same-WebID tabs", async () => {
  localStorageFixture();
  vi.stubGlobal("navigator", { onLine: false, locks: exclusiveLocks() });
  const local = new ChatLocalState(webId);
  local.write("outbox", room, [
    { localId: "legacy", at: "2026-11-11T00:00:00.000Z", draft: "Once", status: "sending" },
  ]);
  const idb = new IDBFactory();
  const first = setup(idb);
  first.register();
  first.connect();
  const second = setup(idb);
  second.register();
  second.connect();
  await vi.waitFor(() => expect(local.read("outbox", room)).toEqual([]));
  await vi.waitFor(() => expect(first.outbox.pending()).toHaveLength(1));
  await vi.waitFor(() => expect(second.outbox.pending()).toHaveLength(1));
  expect(await messageChannel.pending(second.outbox)).toMatchObject([
    { intent: { id: "legacy", content: "Once" } },
  ]);
});

it("demo delivery stays in memory, flushes offline entries, and supports retry, discard and acknowledgement", async () => {
  const local = localStorageFixture();
  vi.stubGlobal("navigator", { onLine: false });
  const send = vi.fn(async (target: string, content: string, input?: { id?: string; at?: Date }) =>
    sent(target, content, input),
  );
  const adapter = new ChatOutbox({ webId, send }, true);
  adapter.send(room, "Demo");
  expect(adapter.snapshot()[0]?.status).toBe("sending");
  expect(send).not.toHaveBeenCalled();
  expect(local.length).toBe(0);
  vi.stubGlobal("navigator", { onLine: true });
  adapter.flush();
  adapter.flush();
  await vi.waitFor(() => expect(adapter.snapshot()[0]?.status).toBeUndefined());
  expect(send).toHaveBeenCalledOnce();
  const id = adapter.snapshot()[0]?.id as string;
  adapter.acknowledge(new Set([id]));
  expect(adapter.snapshot()).toEqual([]);
  send.mockRejectedValueOnce(new Error("Failed"));
  adapter.send(room, "Keep text");
  await vi.waitFor(() => expect(adapter.snapshot()[0]?.status).toBe("failed"));
  const failed = adapter.snapshot()[0]?.id as string;
  adapter.retry(failed);
  await vi.waitFor(() => expect(adapter.snapshot()[0]?.status).toBeUndefined());
  adapter.discard(failed);
  expect(adapter.snapshot()).toEqual([]);
  adapter.retry("absent");
});

it.each([
  null,
  {},
  { room, id: "bad/id", at: "2026-11-11T00:00:00.000Z", content: "x" },
  { room, id: "valid", at: "invalid", content: "x" },
  { room, id: "valid", at: "2026-11-11T00:00:00.000Z", content: "" },
  { room, id: "valid", at: "2026-11-11T00:00:00.000Z", content: "x", extra: true },
])("rejects invalid chat intents before delivery: %j", (input) => {
  expect(() => decodeMessageIntent(input)).toThrow();
});
