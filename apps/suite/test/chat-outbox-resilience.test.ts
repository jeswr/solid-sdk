// AUTHORED-BY Claude Opus 5.5

import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, type Outbox } from "@jeswr/suite-sdk/offline";
import { describe, expect, it, type MockInstance, vi } from "vitest";
import { ChatModelError } from "../src/apps/chat/lib/model";
import { ChatLocalState } from "../src/apps/chat/state/local-state";
import { ChatOutbox } from "../src/apps/chat/state/outbox";
import {
  box,
  idb,
  reopen,
  result,
  room,
  sender,
  storageUrl,
  stubLocalStorage,
  webId,
} from "./chat-outbox-helpers";

/** An IndexedDB whose open request errors, as with blocked site data or a corrupt profile. */
function brokenIndexedDb(): IDBFactory {
  return {
    open() {
      const request: { error?: DOMException; onerror?: () => void } = {};
      setTimeout(() => {
        request.error = new DOMException("The operation failed", "UnknownError");
        request.onerror?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
}
const unavailable = () => Object.assign(new Error("Service Unavailable"), { status: 503 });

describe("without a working IndexedDB (H1)", () => {
  it.each([
    [
      "no IndexedDB factory",
      () => {
        vi.stubGlobal("indexedDB", undefined);
        return createOutbox({ webId });
      },
    ],
    ["an open request that errors", () => createOutbox({ webId, idb: brokenIndexedDb() })],
  ])("sends directly with %s, and Retry and Discard work", async (_, create) => {
    const send = sender();
    send.mockRejectedValueOnce(unavailable());
    let online = true;
    const { queue } = box(send, () => online, webId, {
      open: () => ({
        outbox: create(),
        storage: async () => createMemoryStorage({ root: storageUrl, protocol: "solid" }),
      }),
    });
    // Sent before hydration fails: it must still be delivered once the fallback is chosen.
    const first = queue.send(room, "fails once");
    await queue.ready;
    await first;
    expect(queue.snapshot().map((entry) => entry.status)).toEqual(["failed"]);
    const failed = queue.snapshot()[0]!;
    await queue.retry(failed.id);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(queue.snapshot()[0]?.status).toBeUndefined();

    await queue.send(room, "delivered");
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.snapshot()[1]?.status).toBeUndefined();

    send.mockRejectedValueOnce(new ChatModelError("duplicate"));
    await queue.send(room, "already posted");
    expect(queue.snapshot()[2]?.status).toBeUndefined();

    send.mockRejectedValueOnce(unavailable());
    await queue.send(room, "discard me");
    const discarded = queue.snapshot()[3]!;
    expect(discarded.status).toBe("failed");
    await queue.discard(discarded.id);
    expect(queue.snapshot().map((entry) => entry.draft)).toEqual([
      "fails once",
      "delivered",
      "already posted",
    ]);

    online = false;
    send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await queue.send(room, "offline");
    expect(queue.snapshot()[3]?.status).toBe("sending");
    await queue.flush();
    online = true;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(7);
    expect(queue.snapshot()[3]?.status).toBeUndefined();
    await queue.acknowledge(new Set(queue.snapshot().map((entry) => entry.id)));
    expect(queue.snapshot()).toEqual([]);
    await queue.retry("absent");
  });

  it("sends an entry directly when enqueue fails after the queue opened", async () => {
    const send = sender();
    const { queue, sdk } = box(send, () => true, webId, {
      onOpen: (sdk) => {
        vi.spyOn(sdk, "enqueue").mockRejectedValueOnce(
          new DOMException("full", "QuotaExceededError"),
        );
      },
    });
    await queue.ready;
    await queue.send(room, "no room on disk");
    expect(send).toHaveBeenCalledOnce();
    expect(queue.snapshot()[0]?.status).toBeUndefined();
    expect(sdk.pending()).toEqual([]);
  });

  it("does not deliver a row twice while its direct send is in flight", async () => {
    let finish!: () => void;
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return result(...args);
    });
    vi.stubGlobal("indexedDB", undefined);
    const { queue } = box(send, () => true, webId, {
      open: () => ({ outbox: createOutbox({ webId }), storage: async () => undefined as never }),
    });
    const sending = queue.send(room, "once");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await Promise.all([queue.flush(), queue.retry(queue.snapshot()[0]!.id)]);
    finish();
    await sending;
    expect(send).toHaveBeenCalledOnce();
    expect(queue.snapshot()[0]?.status).toBeUndefined();
  });
});

describe("delivery failures while online (M2)", () => {
  it.each([
    ["a 503", unavailable],
    ["a 429", () => Object.assign(new Error("Too Many Requests"), { status: 429 })],
    ["a fetch error", () => new TypeError("Failed to fetch")],
    ["a non-Error rejection", () => "refused"],
  ])("%s fails the row so Retry and Discard show", async (_, failure) => {
    const send = sender();
    send.mockRejectedValueOnce(failure());
    const { queue, sdk } = box(send, () => true);
    await queue.ready;
    await queue.send(room, "server down");
    expect(queue.snapshot()[0]?.status).toBe("failed");
    expect(sdk.pending().map((item) => item.status)).toEqual(["failed"]);
    await queue.retry(queue.snapshot()[0]!.id);
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.snapshot()[0]?.status).toBeUndefined();
    expect((await reopen()).pending()).toEqual([]);
  });

  it("creates the pod client once, and a failed discovery fails rows until Retry succeeds (L4)", async () => {
    let fail = true;
    const storage = vi.fn(async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return createMemoryStorage({ root: storageUrl, protocol: "solid" });
    });
    let online = false;
    const send = sender();
    const { queue } = box(send, () => online, webId, { storage });
    await queue.ready;
    await queue.send(room, "one");
    online = true;
    await queue.flush();
    expect(storage).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(queue.snapshot()[0]?.status).toBe("failed"));
    expect(send).not.toHaveBeenCalled();
    await queue.retry(queue.snapshot()[0]!.id);
    expect(storage).toHaveBeenCalledTimes(2);
    expect(queue.snapshot()[0]?.status).toBe("failed");
    fail = false;
    await queue.retry(queue.snapshot()[0]!.id);
    expect(send).toHaveBeenCalledOnce();
    await queue.send(room, "two");
    send.mockRejectedValueOnce(unavailable());
    await queue.send(room, "three");
    await queue.retry(queue.snapshot()[2]!.id);
    await queue.flush();
    expect(storage).toHaveBeenCalledTimes(3);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("an offline discovery failure leaves rows sending for reconnection", async () => {
    let online = true;
    const storage = vi.fn(async () => {
      online = false;
      throw new TypeError("Failed to fetch");
    });
    const { queue } = box(sender(), () => online, webId, { storage });
    await queue.ready;
    await queue.send(room, "later");
    expect(storage).toHaveBeenCalledOnce();
    expect(queue.snapshot()[0]?.status).toBe("sending");
  });
});

describe("queue isolation and guard scope (M1)", () => {
  it("never replays or lists the shell's queue, and the shell never lists chat intents", async () => {
    const shell = createOutbox({ webId, idb });
    try {
      await shell.ready;
      const drive = await shell.enqueue({
        op: "write",
        url: `${storageUrl}drive/notes.txt`,
        body: "shell",
        contentType: "text/plain",
      });
      const pod = createMemoryStorage({ root: storageUrl, protocol: "solid" });
      const write = vi.spyOn(pod, "write");
      let online = false;
      const send = sender();
      const { queue, sdk } = box(send, () => online, webId, { storage: async () => pod });
      await queue.ready;
      await queue.send(room, "chat only");
      expect(sdk.pending().map((item) => item.url)).toEqual([
        queue.snapshot()[0]!.id.split("#")[0],
      ]);
      expect(shell.pending().map((item) => item.id)).toEqual([drive.id]);
      online = true;
      await queue.flush();
      expect(send).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
      expect(shell.pending()).toMatchObject([{ id: drive.id, status: "waiting" }]);
      const shellAgain = createOutbox({ webId, idb });
      await shellAgain.ready;
      expect(shellAgain.pending().map((item) => item.label)).not.toContain("Send chat message");
      shellAgain.close();
    } finally {
      shell.close();
    }
  });

  it("requires the chat guard only for day documents of chat rooms", async () => {
    const { queue, sdk } = box();
    await queue.ready;
    const plain = { op: "write" as const, body: "x", contentType: "text/turtle" };
    await sdk.enqueue({ ...plain, url: `${storageUrl}notes/2026/01/01.ttl` });
    await sdk.enqueue({ ...plain, url: `${room}2026/01/01.ttl` });
    await sdk.enqueue({ ...plain, url: `${room}index.ttl` });
    await sdk.enqueue({ ...plain, url: "https://alice.example/elsewhere/chat/2026/01/01.ttl" });
    expect(sdk.pending().map((item) => item.blocked)).toEqual([
      undefined,
      "guard-required",
      undefined,
      undefined,
    ]);
  });
});

describe("legacy import (L2, L3, M1) and body reads (L4)", () => {
  const key = (target: string) => `solid-suite:chat:v1:outbox:${JSON.stringify([webId, target])}`;
  const entry = {
    localId: "old",
    at: "2026-06-01T12:00:00Z",
    draft: "restored",
    status: "sending",
  };

  const rejectFirstEnqueue = (error: unknown) => ({
    onOpen: (sdk: Outbox) => {
      vi.spyOn(sdk, "enqueue").mockRejectedValueOnce(error);
    },
  });

  it("keeps and shows a legacy entry whose import fails on storage, and drops it once sent (M1)", async () => {
    const data = stubLocalStorage();
    new ChatLocalState(webId).write("outbox", room, [entry, { ...entry, localId: "second" }]);
    let online = false;
    const send = sender();
    const { queue, sdk } = box(
      send,
      () => online,
      webId,
      rejectFirstEnqueue(new DOMException("full", "QuotaExceededError")),
    );
    await expect(queue.ready).resolves.toBeUndefined();
    expect(sdk.pending()).toHaveLength(1);
    expect(queue.snapshot().map((item) => [item.localId, item.status])).toEqual([
      ["old", "sending"],
      ["second", "sending"],
    ]);
    // Only the entry that could not be queued stays in localStorage, so a reload retries it.
    expect(new ChatLocalState(webId).read("outbox", room)).toEqual([entry]);
    online = true;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.snapshot().map((item) => item.status)).toEqual([undefined, undefined]);
    expect(sdk.pending()).toEqual([]);
    expect(data.size).toBe(0);
  });

  it.each([
    ["a TypeError", new TypeError("[solid-offline] invalid destination URL")],
    ["a scope error", new StorageError("scope", { url: "x", method: "OUTBOX" })],
    ["a bad-request error", new StorageError("bad-request", { url: "x", method: "OUTBOX" })],
  ])("removes a legacy entry the outbox rejects with %s for its destination (M1)", async (_, error) => {
    const data = stubLocalStorage();
    new ChatLocalState(webId).write("outbox", room, [entry, { ...entry, localId: "second" }]);
    const { queue, sdk } = box(sender(), () => false, webId, rejectFirstEnqueue(error));
    await queue.ready;
    expect(sdk.pending()).toHaveLength(1);
    expect(queue.snapshot().map((item) => item.localId)).toEqual(["second"]);
    expect(data.size).toBe(0);
  });

  it("keeps legacy entries for a room on another pod out of the queue until sent or discarded (H1)", async () => {
    const data = stubLocalStorage();
    const foreign = "https://bob.example/chat/rooms/b/";
    new ChatLocalState(webId).write("outbox", foreign, [entry, { ...entry, localId: "second" }]);
    let online = false;
    const send = sender();
    const { queue, sdk } = box(send, () => online, webId);
    await queue.ready;
    expect(sdk.pending()).toEqual([]);
    expect(queue.snapshot().map((item) => [item.localId, item.status])).toEqual([
      ["old", "sending"],
      ["second", "sending"],
    ]);
    await queue.discard(queue.snapshot()[0]!.id);
    expect(new ChatLocalState(webId).read("outbox", foreign)).toEqual([
      { ...entry, localId: "second" },
    ]);
    online = true;
    await queue.flush();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(foreign);
    expect(queue.snapshot().map((item) => item.status)).toEqual([undefined]);
    expect(sdk.pending()).toEqual([]);
    expect(data.size).toBe(0);
  });

  it("removes legacy keys with an invalid envelope or a non-array value", async () => {
    const data = stubLocalStorage();
    data.set(key(room), "{not json");
    data.set(key(`${room}v2/`), JSON.stringify({ v: 2, webId, room: `${room}v2/`, data: [entry] }));
    new ChatLocalState(webId).write("outbox", `${room}object/`, { entry });
    new ChatLocalState(webId).write("outbox", `${room}valid/`, [entry]);
    const { queue, sdk } = box();
    await queue.ready;
    expect(sdk.pending()).toHaveLength(1);
    expect(data.size).toBe(0);
  });

  it("reads each queued body once rather than on every refresh", async () => {
    let reads: string[] = [];
    const a = box(sender(), () => false, webId, {
      onOpen: (sdk) => {
        const localBody = sdk.localBody.bind(sdk);
        vi.spyOn(sdk, "localBody").mockImplementation((id) => {
          reads.push(id);
          return localBody(id);
        });
      },
    });
    const b = box();
    await Promise.all([a.queue.ready, b.queue.ready]);
    await a.queue.send(room, "one");
    await a.queue.send(room, "two");
    reads = [];
    await b.queue.send(room, "three");
    await b.queue.send(room, "four");
    await vi.waitFor(() => expect(a.queue.snapshot()).toHaveLength(4));
    const queued = new Set(a.sdk.pending().map((item) => item.id));
    const counts = new Map<string, number>();
    for (const id of reads) if (queued.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(counts.size).toBe(2);
  });
});

describe("edge cases", () => {
  const Tag = "chat.message.v1";
  const legacy = {
    localId: "old",
    at: "2026-06-01T12:00:00Z",
    draft: "restored",
    status: "sending",
  };
  const gate = () => {
    let finish!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { active, done, started: () => started(), finish: () => finish() };
  };

  it("refuses, and closes, an outbox opened for another WebID", () => {
    const other = createOutbox({ webId: "https://bob.example/#me", idb });
    const close = vi.spyOn(other, "close");
    const queue = new ChatOutbox(
      { webId, send: sender(), storageUrl },
      () => true,
      () => ({
        outbox: other,
        storage: async () => createMemoryStorage({ root: storageUrl, protocol: "solid" }),
      }),
    );
    expect(() => queue.connect()).toThrow("Chat outbox identity mismatch");
    expect(close).toHaveBeenCalledOnce();
  });

  it("hides and fails corrupt, foreign or misplaced intents without sending them", async () => {
    const send = sender();
    const { queue, sdk } = box(send, () => true);
    await queue.ready;
    const day = `${room}2026/01/01.ttl`;
    const intent = { webId, room, draft: "x", localId: "id", at: "2026-01-01T00:00:00.000Z" };
    const guarded = (url: string, body: string) =>
      sdk.enqueue({ op: "write", url, body, contentType: "application/json", guard: { tag: Tag } });
    await guarded(day, "{not json");
    await guarded(day, JSON.stringify({ ...intent, webId: "https://bob.example/#me" }));
    await guarded(`${room}2026/01/02.ttl`, JSON.stringify(intent));
    await sdk.enqueue({ op: "delete", url: day, guard: { tag: Tag } });
    await queue.flush();
    await vi.waitFor(() =>
      expect(sdk.pending().map((item) => item.status)).toEqual([
        "failed",
        "failed",
        "failed",
        "failed",
      ]),
    );
    expect(send).not.toHaveBeenCalled();
    expect(queue.snapshot()).toEqual([]);
    await queue.acknowledge(new Set());
  });

  it("stops replay when the browser goes offline between entries", async () => {
    let online = false;
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      online = false;
      return result(...args);
    });
    const { queue, sdk } = box(send, () => online);
    await queue.ready;
    await queue.send(room, "one");
    await queue.send(room, "two");
    online = true;
    await queue.flush();
    expect(send).toHaveBeenCalledOnce();
    expect(sdk.pending().map((item) => item.status)).toEqual(["waiting"]);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual([undefined, "sending"]);
  });

  it("ignores a delivery that completes after Chat disconnected", async () => {
    const step = gate();
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      step.started();
      await step.done;
      return result(...args);
    });
    const { queue, close } = box(send, () => true);
    await queue.ready;
    const sending = queue.send(room, "late");
    await step.active;
    close();
    step.finish();
    await sending;
    expect(queue.snapshot()[0]?.status).toBe("sending");
  });

  it("keeps the newer connection when an older effect cleans up late", async () => {
    const { queue, close, send } = box(sender(), () => true);
    await queue.ready;
    const disconnect = queue.connect();
    close();
    try {
      await queue.ready;
      await queue.send(room, "after reconnect");
      expect(send).toHaveBeenCalledOnce();
      expect((await reopen()).pending()).toEqual([]);
    } finally {
      disconnect();
    }
  });

  it("ignores a failed hydration after Chat disconnected", async () => {
    const send = sender();
    const { queue, close } = box(send, () => true, webId, {
      open: () => ({
        outbox: createOutbox({ webId, idb: brokenIndexedDb() }),
        storage: async () => createMemoryStorage({ root: storageUrl, protocol: "solid" }),
      }),
    });
    close();
    await queue.ready;
    await queue.send(room, "direct");
    expect(send).toHaveBeenCalledOnce();
  });

  it("drops a direct send's result when its row was discarded meanwhile", async () => {
    const step = gate();
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      step.started();
      await step.done;
      return result(...args);
    });
    vi.stubGlobal("indexedDB", undefined);
    const { queue } = box(send, () => true, webId, {
      open: () => ({ outbox: createOutbox({ webId }), storage: async () => undefined as never }),
    });
    const sending = queue.send(room, "discarded in flight");
    await step.active;
    await queue.discard(queue.snapshot()[0]!.id);
    step.finish();
    await sending;
    expect(queue.snapshot()).toEqual([]);
  });

  it.each([
    ["without Web Locks", undefined],
    [
      "when the migration lock is refused",
      (name: string, run: () => Promise<void>) =>
        name.startsWith("solid-suite:chat-migrate:") ? Promise.reject(new Error("denied")) : run(),
    ],
  ])("still opens the queue %s", async (_, request) => {
    const data = stubLocalStorage();
    new ChatLocalState(webId).write("outbox", room, [
      legacy,
      { ...legacy, localId: "posted", status: "sent" },
    ]);
    vi.stubGlobal("navigator", { onLine: true, ...(request ? { locks: { request } } : {}) });
    const { queue, sdk } = box();
    await queue.ready;
    expect(sdk.pending()).toHaveLength(request ? 0 : 1);
    expect(data.size).toBe(request ? 1 : 0);
    await queue.send(room, "still queued");
    expect(sdk.pending()).toHaveLength(request ? 1 : 2);
  });
});

describe("rooms outside the user's storage (H1, round 2)", () => {
  const foreign = "https://bob.example/chat/rooms/b/";

  it("delivers an online send directly, with no queue entry", async () => {
    const send = sender();
    const { queue, sdk } = box(send, () => true);
    await queue.ready;
    await queue.send(foreign, "hello bob");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(foreign);
    expect(queue.snapshot()).toMatchObject([{ status: undefined, unsaved: true }]);
    expect(sdk.pending()).toEqual([]);
    expect((await reopen()).pending()).toEqual([]);
  });

  it("fails an offline send as not saved, and Retry delivers it", async () => {
    let online = false;
    const send = sender();
    send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { queue, sdk } = box(send, () => online);
    await queue.ready;
    await queue.send(room, "own pod");
    await queue.send(foreign, "later");
    expect(queue.snapshot().map((entry) => [entry.draft, entry.status, entry.unsaved])).toEqual([
      ["own pod", "sending", undefined],
      ["later", "failed", true],
    ]);
    expect(sdk.pending().map((item) => item.url)).toEqual([queue.snapshot()[0]!.id.split("#")[0]]);
    online = true;
    await queue.flush();
    // The own-pod entry replays from the queue; the failed row waits for Retry.
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual([undefined, "failed"]);
    await queue.retry(queue.snapshot()[1]!.id);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]).toEqual(send.mock.calls[0]);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual([undefined, undefined]);
    expect(sdk.pending()).toEqual([]);
  });

  it.each([
    ["a sibling origin", "https://alice.example.evil/chat/rooms/b/"],
    ["another scheme", "http://alice.example/chat/rooms/b/"],
  ])("treats %s as outside the storage", async (_, target) => {
    const send = sender();
    const { queue, sdk } = box(send, () => true);
    await queue.ready;
    await queue.send(target, "elsewhere");
    expect(send).toHaveBeenCalledOnce();
    expect(sdk.pending()).toEqual([]);
  });
});

describe("direct sends without IndexedDB (L1)", () => {
  const noIndexedDb = () => {
    vi.stubGlobal("indexedDB", undefined);
    return {
      open: () => ({ outbox: createOutbox({ webId }), storage: async () => undefined as never }),
    };
  };

  it("sends to one room one at a time, so quick sends arrive in order without a 412", async () => {
    let busy = false;
    const arrived: string[] = [];
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      // Two sends in flight read the same ETag: the later write is rejected.
      if (busy) throw Object.assign(new Error("Chat request failed (412)"), { status: 412 });
      busy = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        arrived.push(args[1]);
        return result(...args);
      } finally {
        busy = false;
      }
    });
    const { queue } = box(send, () => true, webId, noIndexedDb());
    await Promise.all(["one", "two", "three"].map((draft) => queue.send(room, draft)));
    expect(arrived).toEqual(["one", "two", "three"]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("never posts a send discarded while it waited for its turn", async () => {
    let finish!: () => void;
    const send = vi.fn(async (...args: Parameters<typeof result>) => {
      if (args[1] === "first")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return result(...args);
    });
    const { queue } = box(send, () => true, webId, noIndexedDb());
    const first = queue.send(room, "first");
    const second = queue.send(room, "second");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await queue.discard(queue.snapshot()[1]!.id);
    finish();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledOnce();
    expect(queue.snapshot().map((entry) => entry.draft)).toEqual(["first"]);
  });
});

describe("replay that keeps failing after IndexedDB opened (L5)", () => {
  it("fails queued rows while online so Retry and Discard show, and Retry recovers", async () => {
    let online = false;
    const send = sender();
    let replay!: MockInstance;
    const { queue } = box(send, () => online, webId, {
      onOpen: (sdk) => {
        replay = vi
          .spyOn(sdk, "replay")
          .mockRejectedValue(new DOMException("write failed", "UnknownError"));
      },
    });
    await queue.ready;
    await queue.send(room, "stuck");
    await queue.send(room, "discard me");
    expect(queue.snapshot().map((entry) => entry.status)).toEqual(["sending", "sending"]);
    online = true;
    await queue.flush();
    expect(queue.snapshot().map((entry) => entry.status)).toEqual(["failed", "failed"]);
    await queue.discard(queue.snapshot()[1]!.id);
    await queue.retry(queue.snapshot()[0]!.id);
    expect(queue.snapshot().map((entry) => entry.status)).toEqual(["failed"]);
    // Offline, the row waits for reconnection again rather than showing Retry.
    online = false;
    await queue.retry(queue.snapshot()[0]!.id);
    expect(queue.snapshot()[0]?.status).toBe("sending");
    expect(send).not.toHaveBeenCalled();
    online = true;
    replay.mockRestore();
    await queue.retry(queue.snapshot()[0]!.id);
    expect(send).toHaveBeenCalledOnce();
    expect(queue.snapshot().map((entry) => [entry.draft, entry.status])).toEqual([
      ["stuck", undefined],
    ]);
  });
});
