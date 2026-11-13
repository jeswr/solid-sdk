// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { ChatModelError } from "../src/apps/chat/lib/model";
import { ChatLocalState } from "../src/apps/chat/state/local-state";
import { box, reopen, result, room, webId } from "./chat-outbox-helpers";

it("keeps offline sends optimistic, flushes in order, and prunes acknowledged entries", async () => {
  let online = false;
  const { queue, sdk, send } = box(undefined, () => online);
  const one = queue.send(room, "one");
  expect(queue.snapshot()[0]?.status).toBe("sending");
  await one;
  await queue.send(room, "two");
  const pending = queue.snapshot();
  expect(sdk.pending()).toHaveLength(2);
  expect(send).not.toHaveBeenCalled();
  online = true;
  await Promise.all([queue.flush(), queue.flush()]);
  expect(send.mock.calls.map(([, text]) => text)).toEqual(["one", "two"]);
  expect(queue.snapshot().map((item) => item.status)).toEqual([undefined, undefined]);
  expect((await reopen()).pending()).toEqual([]);
  await queue.acknowledge(new Set([pending[0]!.id]));
  expect(queue.snapshot()).toHaveLength(1);
  await queue.discard(pending[1]!.id);
  expect(queue.snapshot()).toEqual([]);
});

it("keeps failed drafts durable until Retry or Discard, preserving the intent ID and timestamp", async () => {
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  send.mockRejectedValueOnce(new Error("unavailable"));
  const first = box(send, () => true);
  await first.queue.send(room, "Draft");
  const item = first.queue.snapshot()[0]!;
  expect(item.status).toBe("failed");
  first.close();
  const restored = box(send, () => true);
  await restored.queue.ready;
  await restored.queue.flush();
  expect(restored.queue.snapshot()[0]?.status).toBe("failed");
  expect(send).toHaveBeenCalledOnce();
  await restored.queue.retry(item.id);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(restored.sdk.pending()).toEqual([]);
  await restored.queue.retry("absent");
  await restored.queue.discard(item.id);
  expect(restored.queue.snapshot()).toEqual([]);
});

it("treats duplicate as confirmed delivery rather than a failed optimistic row", async () => {
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  send.mockRejectedValueOnce(new ChatModelError("duplicate"));
  const { queue, sdk } = box(send, () => true);
  await queue.send(room, "Already posted before closing");
  expect(queue.snapshot()[0]?.status).toBeUndefined();
  expect(sdk.pending()).toEqual([]);
});

it("stops on network failure and retries waiting entries after reconnection", async () => {
  let online = false;
  const send = vi.fn(async (): Promise<ReturnType<typeof result>> => {
    online = false;
    throw new TypeError("Failed to fetch");
  });
  const { queue, sdk } = box(send, () => online);
  await queue.send(room, "one");
  await queue.send(room, "two");
  online = true;
  await queue.flush();
  expect(send).toHaveBeenCalledOnce();
  expect(sdk.pending().map((item) => item.status)).toEqual(["waiting", "waiting"]);
  online = true;
  await queue.flush();
  expect(send).toHaveBeenCalledTimes(2);
});

it("restores the SDK queue by WebID with Date values and keeps drafts isolated", async () => {
  const first = box();
  await first.queue.send(room, "2026-01-01");
  await first.queue.send(`${room}sibling/`, "another room");
  const pending = first.queue.snapshot();
  first.close();
  const restored = box();
  const foreign = box(undefined, () => false, "https://bob.example/#me");
  await Promise.all([restored.queue.ready, foreign.queue.ready]);
  expect(restored.queue.snapshot()).toEqual(pending);
  expect(restored.queue.snapshot()[0]?.at).toBeInstanceOf(Date);
  expect(foreign.queue.snapshot()).toEqual([]);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key),
    setItem: (key: string, value: string) => data.set(key, value),
  });
  new ChatLocalState(webId).setDraft(room, "Unsent draft");
  expect(new ChatLocalState(webId).draft(room)).toBe("Unsent draft");
  expect(new ChatLocalState("other").draft(room)).toBe("");
  expect(new ChatLocalState(webId).draft(`${room}sibling/`)).toBe("");
});

it("imports legacy entries once, removes empty room keys, and prunes acknowledgements", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  const local = new ChatLocalState(webId);
  const entry = {
    localId: "old",
    at: "2026-06-01T12:00:00Z",
    draft: "restored",
    status: "sending",
    owner: "closed-tab",
  };
  local.write("outbox", room, [
    null,
    { ...entry, at: "bad" },
    entry,
    { ...entry, localId: "failed", status: "failed" },
  ]);
  local.write("outbox", `${room}empty/`, []);
  new ChatLocalState("other").write("outbox", room, [entry]);
  const a = box(),
    b = box();
  await Promise.all([a.queue.ready, b.queue.ready]);
  expect((await reopen()).pending()).toHaveLength(2);
  expect(a.queue.snapshot().map((item) => item.status)).toEqual(["sending", "failed"]);
  expect(local.pendingRooms()).toEqual([]);
  expect(data.size).toBe(1); // Another WebID's legacy queue is untouched.
  await b.queue.acknowledge(new Set(a.queue.snapshot().map((item) => item.id)));
  expect((await reopen()).pending()).toEqual([]);
});

it("reconnects cleanly when an effect is torn down before hydration finishes", async () => {
  const first = box();
  first.close();
  const disconnect = first.queue.connect();
  try {
    await first.queue.ready;
    await first.queue.send(room, "after effect replay");
    expect(first.queue.snapshot()[0]?.draft).toBe("after effect replay");
    expect((await reopen()).pending()).toHaveLength(1);
  } finally {
    disconnect();
  }
});
