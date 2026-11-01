// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "../src/apps/chat/lib/client";
import { ChatLocalState } from "../src/apps/chat/state/local-state";
import { ChatOutbox } from "../src/apps/chat/state/outbox";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function storage() {
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

const room = "https://alice.example/chat/rooms/a/";
const webId = "https://alice.example/profile#me";
function message(id: string, content: string): Message {
  return {
    id,
    content,
    author: webId,
    mediaType: "text/plain",
    updated: undefined,
    tombstone: false,
    deleted: false,
    edited: false,
  };
}
async function tick() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
it("keeps offline sends pending, flushes in order and acknowledges only canonical IDs", async () => {
  let online = false;
  const send = vi.fn(async (_room: string, text: string, input?: { id?: string; at?: Date }) =>
    message(
      `${room}${input?.at?.toISOString().slice(0, 10).replaceAll("-", "/")}.ttl#${input?.id}`,
      text,
    ),
  );
  const box = new ChatOutbox({ webId, send }, () => online);
  const listener = vi.fn();
  const unsubscribe = box.subscribe(listener);
  box.send(room, "one");
  box.send(room, "two");
  const pending = box.snapshot();
  expect(pending.map((item) => item.status)).toEqual(["sending", "sending"]);
  expect(send).not.toHaveBeenCalled();
  online = true;
  box.flush();
  box.flush();
  await tick();
  expect(send.mock.calls.map(([, text]) => text)).toEqual(["one", "two"]);
  expect(box.snapshot().map((item) => item.status)).toEqual([undefined, undefined]);
  box.acknowledge(new Set([pending[0]?.id as string]));
  expect(box.snapshot()).toHaveLength(1);
  box.acknowledge(new Set(["unknown"]));
  expect(box.snapshot()).toHaveLength(1);
  unsubscribe();
  const calls = listener.mock.calls.length;
  box.discard(pending[1]?.id as string);
  expect(box.snapshot()).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(calls);
});
it("retains failed text for Retry/Discard and retries with the identical ID and UTC timestamp", async () => {
  let fail = true;
  const send = vi.fn(async () => {
    if (fail) throw new Error("unavailable");
    return message("one", "Draft");
  });
  const box = new ChatOutbox({ webId, send }, () => true);
  box.send(room, "Draft");
  await tick();
  const item = box.snapshot()[0];
  expect(item?.status).toBe("failed");
  box.flush();
  await tick();
  expect(send).toHaveBeenCalledTimes(1);
  fail = false;
  box.retry(item?.id as string);
  await tick();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  box.retry("absent");
  box.discard("one");
  expect(box.snapshot()).toEqual([]);
});
it("keeps a network failure pending when offline and rechecks connectivity before dequeuing the next send", async () => {
  let online = true;
  const send = vi.fn(async () => {
    online = false;
    throw new Error("offline");
  });
  const box = new ChatOutbox({ webId, send }, () => online);
  box.send(room, "one");
  box.send(room, "two");
  await tick();
  expect(send).toHaveBeenCalledTimes(1);
  expect(box.snapshot().map((item) => item.status)).toEqual(["sending", "sending"]);
  online = true;
  box.flush();
  await tick();
  expect(send).toHaveBeenCalledTimes(2);
});
it("doesn't resurrect messages acknowledged or discarded while their request was in flight", async () => {
  let complete: (value: Message) => void = () => {};
  const send = vi.fn(
    () =>
      new Promise<Message>((resolve) => {
        complete = resolve;
      }),
  );
  const box = new ChatOutbox({ webId, send }, () => true);
  box.send(room, "one");
  await tick();
  const item = box.snapshot()[0];
  box.acknowledge(new Set([item?.id as string]));
  complete(message(item?.id as string, "one"));
  await tick();
  expect(box.snapshot()).toEqual([]);
});

it("round-trips pending sends and drafts by WebID and room, retaining stable IDs and Date values", async () => {
  const local = storage();
  local.setItem("solid-suite:chat:v1:outbox:corrupt-key", "broken");
  const send = vi.fn(async () => message("sent", "2026-01-01"));
  const first = new ChatOutbox({ webId, send }, () => false);
  first.send(room, "2026-01-01");
  first.send(`${room}sibling/`, "another room");
  const pending = first.snapshot();
  new ChatLocalState(webId).setDraft(room, "Unsent draft");
  expect(new ChatLocalState(webId).draft(room)).toBe("Unsent draft");
  expect(new ChatLocalState(webId).draft(`${room}sibling/`)).toBe("");
  expect(new ChatLocalState("https://bob.example/#me").draft(room)).toBe("");
  expect(new ChatOutbox({ webId: "https://bob.example/#me", send }, () => true).snapshot()).toEqual(
    [],
  );
  const restored = new ChatOutbox({ webId, send }, () => true);
  expect(restored.snapshot()).toEqual(pending);
  expect(restored.snapshot()[0]?.at).toBeInstanceOf(Date);
  restored.flush();
  await tick();
  expect(send).toHaveBeenCalledWith(room, "2026-01-01", {
    id: pending[0]?.localId,
    at: pending[0]?.at,
  });
  expect(new ChatOutbox({ webId, send }, () => true).snapshot()).toEqual([]);
  expect(local.length).toBe(4);
});

it("keeps failed sends durable for explicit retry/discard and fails safely on corrupt or unavailable storage", async () => {
  const local = storage();
  const send = vi.fn(async () => {
    throw new Error("unreachable");
  });
  const first = new ChatOutbox({ webId, send }, () => true);
  first.send(room, "Keep this");
  await tick();
  const restored = new ChatOutbox({ webId, send }, () => true);
  expect(restored.snapshot()[0]?.status).toBe("failed");
  restored.flush();
  expect(send).toHaveBeenCalledTimes(1);
  restored.discard(restored.snapshot()[0]?.id as string);
  expect(new ChatOutbox({ webId, send }, () => true).snapshot()).toEqual([]);
  const key = local.key(0) as string;
  local.setItem(
    key,
    JSON.stringify({
      v: 1,
      webId,
      room,
      data: [null, { localId: "valid", draft: "x", status: "sending", at: "invalid" }],
    }),
  );
  expect(new ChatOutbox({ webId, send }, () => true).snapshot()).toEqual([]);
  local.setItem(key, JSON.stringify({ v: 1, webId: "somebody else", room, data: [] }));
  expect(new ChatOutbox({ webId, send }, () => true).snapshot()).toEqual([]);
  local.setItem(key, "broken JSON");
  expect(new ChatOutbox({ webId, send }, () => true).snapshot()).toEqual([]);
  vi.spyOn(local, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const drafts = new ChatLocalState(webId);
  drafts.setDraft(room, "Live draft");
  expect(drafts.draft(room)).toBe("Live draft");
  const unavailable = new ChatOutbox({ webId, send }, () => false);
  expect(() => unavailable.send(room, "Live pending")).not.toThrow();
  expect(unavailable.snapshot()[0]?.draft).toBe("Live pending");
  vi.stubGlobal("localStorage", undefined);
  expect(new ChatOutbox({ webId, send }, () => false).snapshot()).toEqual([]);
});
