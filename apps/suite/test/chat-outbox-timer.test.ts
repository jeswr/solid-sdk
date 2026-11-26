// AUTHORED-BY Claude Sonnet 5.5
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox } from "@jeswr/suite-sdk/offline";
import { afterEach, expect, it, vi } from "vitest";
import { ChatLocalState } from "../src/apps/chat/state/local-state";
import { box, result, room, storageUrl, stubLocalStorage, webId } from "./chat-outbox-helpers";

afterEach(() => vi.useRealTimers());
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

it("clears the session timer when the queue closes, and never arms it afterwards", async () => {
  fakeTimers();
  let live = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = vi.fn(async (): Promise<never> => {
    await gate;
    throw new Error("Sign in to continue");
  });
  const { queue, close } = box(send, () => true, webId, { active: () => live });
  const sending = queue.send(room, "in flight");
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  // Sign-out while the request is out: the queue is closed, then the request fails.
  live = false;
  close();
  release();
  await sending;
  await queue.flush();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("arms the timer while open and clears it on close", async () => {
  fakeTimers();
  const { queue, close } = box(vi.fn(), () => true, webId, { active: () => false });
  await queue.send(room, "waiting");
  expect(vi.getTimerCount()).toBe(1);
  close();
  expect(vi.getTimerCount()).toBe(0);
});

it("leaves no timer after an IndexedDB open failure and a close", async () => {
  fakeTimers();
  stubLocalStorage();
  new ChatLocalState(webId).write("outbox", room, [
    {
      id: "a",
      localId: "a",
      room,
      draft: "draft a",
      at: new Date().toISOString(),
      status: "sending",
    },
  ] as never);
  const broken = {
    open() {
      const request: { error?: DOMException; onerror?: () => void } = {};
      setTimeout(() => {
        request.error = new DOMException("The operation failed", "UnknownError");
        request.onerror?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  const { queue, close } = box(vi.fn(), () => true, webId, {
    active: () => false,
    open: () => ({
      outbox: createOutbox({ webId, idb: broken }),
      storage: async () => createMemoryStorage({ root: storageUrl, protocol: "solid" }),
    }),
  });
  await vi.advanceTimersByTimeAsync(1);
  await queue.ready;
  await queue.flush();
  close();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("resumes a row that arrives from another tab while this session is inactive", async () => {
  fakeTimers();
  let live = false;
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  const a = box(send, () => true, webId, { active: () => live });
  const b = box(send, () => true, webId, { active: () => live });
  await Promise.all([a.queue.ready, b.queue.ready]);
  await a.queue.send(room, "from tab a");
  await vi.waitFor(() => expect(b.queue.snapshot()).toHaveLength(1));
  // Tab b only saw the row through the change event, yet it has a timer of its own to resume it.
  a.close();
  expect(vi.getTimerCount()).toBe(1);
  live = true;
  await vi.advanceTimersByTimeAsync(2500);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
});

it("resumes a row retried while the session is inactive", async () => {
  fakeTimers();
  let live = true;
  let fail = true;
  const send = vi.fn(async (...args: Parameters<typeof result>) => {
    if (fail) throw new Error("Service Unavailable");
    return result(...args);
  });
  const { queue } = box(send, () => true, webId, { active: () => live });
  await queue.send(room, "fails once");
  const row = queue.snapshot()[0];
  expect(row?.status).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
  // The session expires, then Retry is pressed: the row goes back to Sending.
  live = false;
  fail = false;
  await queue.retry(row?.id as string);
  expect(queue.snapshot()[0]?.status).toBe("sending");
  expect(vi.getTimerCount()).toBe(1);
  live = true;
  await vi.advanceTimersByTimeAsync(2500);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(queue.snapshot()[0]?.status).toBeUndefined());
});
