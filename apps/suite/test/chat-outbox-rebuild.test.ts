// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "../src/apps/chat/lib/client";
import { box, reopen, result, room, webId } from "./chat-outbox-helpers";

afterEach(() => vi.useRealTimers());
const texts = (send: { mock: { calls: unknown[][] } }) => send.mock.calls.map(([, text]) => text);

it("keeps an in-flight queued send pending when a same-account rebuild cuts it short, then retries it", async () => {
  let session = {};
  const send = vi.fn(async (...args: Parameters<typeof result>) => {
    if (send.mock.calls.length === 1) {
      // The rebuild commits while the request is out; the response then fails.
      session = {};
      throw new Error("Sign in to continue");
    }
    return result(...args);
  });
  const { queue, sdk } = box(send, () => true, webId, { session: () => session });
  await queue.send(room, "one");
  // The row was never saved as failed, and the pass that was cut short ran again.
  expect(texts(send)).toEqual(["one", "one"]);
  expect(sdk.pending()).toEqual([]);
  expect(queue.snapshot().some((row) => row.status === "failed")).toBe(false);
});

it("runs a flush requested during a fenced pass once that pass has ended", async () => {
  let session = {};
  let live = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = vi.fn(async (...args: Parameters<typeof result>): Promise<Message> => {
    if (send.mock.calls.length > 1) return result(...args);
    session = {};
    live = false;
    await gate;
    throw new Error("Sign in to continue");
  });
  const { queue, sdk } = box(send, () => true, webId, {
    active: () => live,
    session: () => session,
  });
  live = true;
  const first = queue.send(room, "held");
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  // React commits the rebuilt session, whose effect flushes while the fenced pass is running.
  live = true;
  const second = queue.flush();
  release();
  await Promise.all([first, second]);
  expect(texts(send)).toEqual(["held", "held"]);
  expect(sdk.pending()).toEqual([]);
  expect(queue.snapshot().some((row) => row.status === "failed")).toBe(false);
});

it("keeps an in-memory send pending when a rebuild cuts it short, then resends it", async () => {
  let session = {};
  const send = vi.fn(async (...args: Parameters<typeof result>) => {
    if (send.mock.calls.length === 1) {
      session = {};
      throw new Error("Sign in to continue");
    }
    return result(...args);
  });
  const { queue } = box(send, () => true, webId, {
    session: () => session,
    open: () => {
      throw new Error("No IndexedDB");
    },
  });
  await queue.send(room, "memory");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(queue.snapshot().every((row) => row.status === undefined)).toBe(true),
  );
});

it("two tabs with an expired session do not replay at each other, and deliver once it is usable", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let live = false;
  const replays = vi.fn();
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  const options = {
    active: () => live,
    onOpen: (sdk: { replay: (...args: never[]) => Promise<unknown> }) => {
      const original = sdk.replay.bind(sdk);
      sdk.replay = (...args) => {
        replays();
        return original(...args);
      };
    },
  };
  const a = box(send, () => true, webId, options);
  const b = box(send, () => true, webId, options);
  await Promise.all([a.queue.ready, b.queue.ready]);
  await a.queue.send(room, "expired");
  await vi.waitFor(() => expect(b.queue.snapshot()).toHaveLength(1));
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    await a.queue.flush();
    await b.queue.flush();
  }
  // Every trigger was a no-op: no replay attempt, no send, rows still waiting.
  expect(replays).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(a.sdk.pending().map((item) => item.status)).toEqual(["waiting"]);
  live = true;
  await vi.advanceTimersByTimeAsync(2500);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect((await reopen()).pending()).toEqual([]));
  expect(send).toHaveBeenCalledOnce();
});
