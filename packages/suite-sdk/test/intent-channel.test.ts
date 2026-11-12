// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment node

import {
  createOutbox,
  type GuardedDelivery,
  type Outbox,
  type ReplayDelegate,
  withOutbox,
} from "@jeswr/solid-offline/outbox";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createIntentChannel, type IntentSession } from "../src/intent-channel.js";

const root = "https://pod.example/";
const webId = `${root}profile#me`;
const url = `${root}day.json`;
const tag = "example.intent-v1";
const intent = { path: "day.json", content: "private-body" };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const boxes: Outbox[] = [];
function box(idb = new IDBFactory()) {
  const outbox = createOutbox({ webId, idb });
  boxes.push(outbox);
  return outbox;
}
function setup(overrides = {}) {
  const deliver = vi.fn(async () => {});
  const channel = createIntentChannel({
    tag,
    destination: (value: typeof intent) => `${root}${value.path}`,
    matches: (target: string) => target.endsWith(".json"),
    decode(value: unknown) {
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).sort().join() !== "content,path" ||
        !("path" in value) ||
        typeof value.path !== "string" ||
        !("content" in value) ||
        typeof value.content !== "string"
      )
        throw new Error("private-body");
      return value as typeof intent;
    },
    deliver,
    ...overrides,
  });
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const context = {
    storage,
    fetch: vi.fn<typeof fetch>(),
    webId,
    signal: new AbortController().signal,
  };
  return { channel, deliver, storage, context };
}
function session(outbox: Outbox, context: ReturnType<typeof setup>["context"]): IntentSession {
  return {
    registerGuardPolicy: (name, matches) => outbox.registerGuardPolicy(name, matches),
    registerReplayDelegate: (name, factory) => outbox.registerDelegate(name, factory(context)),
  };
}
afterEach(() => {
  for (const outbox of boxes.splice(0)) outbox.close();
  vi.unstubAllGlobals();
});

it.each([
  "",
  "UPPER",
  "bad_underscore",
  "a".repeat(65),
  null,
])("rejects invalid tag %s", (value) => {
  expect(() => setup({ tag: value })).toThrow("tag");
});
it.each([0, -1, Infinity, 1.5])("rejects invalid byte budget %s", (maxBytes) => {
  expect(() => setup({ maxBytes })).toThrow("limit");
});
it("validates the serialized value before storage and reports no private bytes", async () => {
  const { channel, storage } = setup();
  const outbox = box();
  const wrapped = withOutbox(storage, outbox);
  for (const invalid of [
    { ...intent, extra: true },
    undefined,
    { toJSON: () => null },
    { content: 5 },
  ]) {
    await expect(channel.submit(wrapped, invalid as typeof intent)).rejects.toThrow(
      "Invalid intent body",
    );
  }
  const circular = { ...intent, self: {} };
  circular.self = circular;
  await expect(channel.submit(wrapped, circular)).rejects.toThrow("Invalid intent body");
  await expect(setup({ maxBytes: 10 }).channel.submit(wrapped, intent)).rejects.toThrow(
    "Invalid intent body",
  );
  await outbox.ready;
  expect(outbox.pending()).toEqual([]);
});
it("checks scope and destination failures before storing", async () => {
  const { storage } = setup();
  const outbox = box();
  const wrapped = withOutbox(storage, outbox);
  await expect(setup({ matches: () => false }).channel.submit(wrapped, intent)).rejects.toThrow(
    "destination",
  );
  await expect(
    setup({
      destination: () => {
        throw new Error("private-body");
      },
    }).channel.submit(wrapped, intent),
  ).rejects.toThrow("Invalid intent destination");
  await outbox.ready;
  expect(outbox.pending()).toEqual([]);
});
it("submits a JSON snapshot, delivers online, and enforces only its write scope", async () => {
  const { channel, deliver, storage, context } = setup();
  const outbox = box();
  const cleanup = channel.register(session(outbox, context));
  const wrapped = withOutbox(storage, outbox);
  const result = await channel.submit(wrapped, { ...intent, toJSON: () => intent });
  expect(result).toEqual({ url, etag: null, created: false });
  expect(channel.tag).toBe(tag);
  expect(deliver).toHaveBeenCalledWith(intent, { ...context, signal: expect.any(AbortSignal) });
  await expect(
    wrapped.write(url, "raw", { contentType: "application/json", ifMatch: "*" }),
  ).rejects.toThrow("guard required");
  await wrapped.write(`${root}other.txt`, "ok", { contentType: "text/plain", ifMatch: "*" });
  await wrapped.delete(`${root}other.txt`, {
    ifMatch: (await storage.head(`${root}other.txt`)).etag as string,
  });
  // Named Solid creates also write to an exact destination and must require the guard.
  await expect(
    wrapped.create(root, "raw", { name: "day.json", contentType: "application/json" }),
  ).rejects.toThrow("guard required");
  await outbox.enqueue({ op: "delete", url, guard: undefined });
  expect(outbox.pending()[0]?.blocked).toBe("guard-required");
  cleanup();
  cleanup();
  await wrapped.write(url, "ordinary", { contentType: "application/json", ifMatch: "*" });
});
it("round trips through real IndexedDB, stays blocked without a delegate, and replays once registered", async () => {
  const idb = new IDBFactory();
  let outbox = box(idb);
  const { channel, deliver, storage, context } = setup();
  vi.stubGlobal("navigator", { onLine: false });
  const value = { ...intent };
  const submitted = channel.submit(withOutbox(storage, outbox), value);
  value.content = "changed later";
  expect((await submitted).queued).toBe(true);
  outbox.close();
  outbox = box(idb);
  await outbox.ready;
  expect(await channel.pending(outbox)).toMatchObject([
    { intent, status: "waiting", blocked: "no-delegate" },
  ]);
  await outbox.replay(storage);
  expect(deliver).not.toHaveBeenCalled();
  channel.register(session(outbox, context));
  await outbox.replay(storage);
  expect(deliver).toHaveBeenCalledOnce();
  expect(outbox.pending()).toEqual([]);
});
it("queues a network failure and preserves domain errors", async () => {
  const { channel, deliver, storage, context } = setup();
  const outbox = box();
  channel.register(session(outbox, context));
  deliver.mockRejectedValueOnce(new StorageError("network", { url, method: "PUT" }));
  expect((await channel.submit(withOutbox(storage, outbox), intent)).queued).toBe(true);
  deliver.mockRejectedValueOnce(new Error("domain failure"));
  await outbox.replay(storage);
  expect(await channel.pending(outbox)).toMatchObject([
    { intent, status: "failed", error: "domain failure" },
  ]);
});
it.each([
  { op: "delete" },
  { op: "create" },
  { contentType: "text/plain" },
  { contentType: undefined },
  { body: null },
  { body: new Uint8Array() },
  { body: new Uint8Array([255]) },
  { body: new TextEncoder().encode("private-body invalid JSON") },
  { body: bytes({ content: "private-body" }) },
  { body: bytes({ ...intent, content: "private-body".repeat(10000) }) },
  { url: `${root}different.json` },
  { body: bytes({ ...intent, path: "day.txt" }) },
])("refuses tampered deliveries without exposing bytes: %j", async (override) => {
  const { channel, deliver, context, storage } = setup();
  let delegate!: ReplayDelegate;
  channel.register({
    registerGuardPolicy: () => () => {},
    registerReplayDelegate: (_tag, factory) => {
      delegate = factory(context);
      return () => {};
    },
  });
  const delivery = {
    op: "write",
    contentType: "application/json",
    url,
    body: bytes(intent),
    purpose: "replay",
    ...override,
  } as GuardedDelivery;
  await expect(delegate(delivery, { storage, signal: context.signal })).rejects.toThrow(
    /Invalid intent|Intent destination mismatch/,
  );
  expect(deliver).not.toHaveBeenCalled();
});
it("rejects cancelled delivery and rolls back policy registration if delegate registration fails", async () => {
  const { channel, context, storage, deliver } = setup();
  const stop = vi.fn();
  expect(() =>
    channel.register({
      registerGuardPolicy: () => stop,
      registerReplayDelegate: () => {
        throw new Error("opening");
      },
    }),
  ).toThrow("opening");
  expect(stop).toHaveBeenCalledOnce();
  let delegate!: ReplayDelegate;
  channel.register({
    registerGuardPolicy: () => () => {},
    registerReplayDelegate: (_tag, factory) => {
      delegate = factory(context);
      return () => {};
    },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    delegate(
      { op: "write", url, contentType: "application/json", body: bytes(intent), purpose: "replay" },
      { storage, signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(deliver).not.toHaveBeenCalled();
});
it("decodes pending items and reports invalid entries while skipping other tags", async () => {
  const { channel } = setup();
  const outbox = box();
  const base = {
    op: "write" as const,
    url,
    contentType: "application/json",
    body: bytes(intent),
    guard: { tag },
  };
  const good = await outbox.enqueue(base);
  await outbox.enqueue({ ...base, guard: { tag: "other.v1" } });
  await outbox.enqueue({ ...base, guard: undefined });
  await outbox.enqueue({ ...base, body: "bad private-body" });
  await outbox.enqueue({ ...base, body: bytes({ content: "private-body" }) });
  await outbox.enqueue({ ...base, op: "delete" });
  await outbox.enqueue({ ...base, contentType: "text/plain" });
  await outbox.enqueue({ ...base, url: `${root}wrong.json` });
  const pending = await channel.pending(outbox);
  expect(pending).toHaveLength(6);
  expect(pending[0]).toMatchObject({ id: good.id, intent });
  for (const item of pending.slice(1)) {
    expect(item.error).toBe("Invalid pending intent");
    expect(item.intent).toBeUndefined();
  }
});

it("validates explicit enqueue and persists in order without attempting online delivery", async () => {
  const { channel, deliver, storage, context } = setup();
  const outbox = box();
  channel.register(session(outbox, context));
  await channel.enqueue(outbox, intent);
  await channel.enqueue(outbox, { ...intent, content: "second" });
  await expect(channel.enqueue(outbox, { ...intent, path: "bad.txt" })).rejects.toThrow(
    "destination",
  );
  await expect(
    channel.enqueue(outbox, { ...intent, content: 7 } as unknown as typeof intent),
  ).rejects.toThrow("Invalid intent body");
  expect(deliver).not.toHaveBeenCalled();
  expect((await channel.pending(outbox)).map((row) => row.intent?.content)).toEqual([
    "private-body",
    "second",
  ]);
  await outbox.replay(storage);
  expect(deliver.mock.calls.map(([value]) => value)).toEqual([
    intent,
    { ...intent, content: "second" },
  ]);
  expect(outbox.pending()).toEqual([]);
});
