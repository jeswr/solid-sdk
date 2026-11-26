// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import type { Message } from "../src/apps/chat/lib/client";
import { box, reopen, result, room, webId } from "./chat-outbox-helpers";

const texts = (send: { mock: { calls: unknown[][] } }) => send.mock.calls.map(([, text]) => text);

it("leaves queued messages pending when the account is switched away during a replay", async () => {
  let live = true;
  let online = false;
  const send = vi.fn(async (..._args: Parameters<typeof result>): Promise<Message> => {
    // The shell's live state flips before React commits: fetch then throws.
    live = false;
    throw new Error("Sign in to continue");
  });
  const { queue, sdk } = box(send, () => online, webId, { active: () => live });
  for (const text of ["one", "two", "three"]) await queue.send(room, text);
  online = true;
  await queue.flush();
  // The first failure stops the pass; nothing is saved as failed.
  expect(texts(send)).toEqual(["one"]);
  expect(sdk.pending().map((item) => item.status)).toEqual(["waiting", "waiting", "waiting"]);
  expect(queue.snapshot().map((row) => row.status)).toEqual(["sending", "sending", "sending"]);
  // Another tab (the next session of the same account) finds them waiting and delivers them.
  queue.snapshot();
  const next = box(
    vi.fn(async (...args: Parameters<typeof result>) => result(...args)),
    () => true,
  );
  await next.queue.ready;
  await next.queue.flush();
  expect(texts(next.send)).toEqual(["one", "two", "three"]);
  expect((await reopen()).pending()).toEqual([]);
});

it("does not even attempt a send once the account has gone, and resumes when it is live again", async () => {
  let live = false;
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  const { queue, sdk } = box(send, () => true, webId, { active: () => live });
  await queue.send(room, "held");
  expect(send).not.toHaveBeenCalled();
  expect(sdk.pending().map((item) => item.status)).toEqual(["waiting"]);
  expect(queue.snapshot()[0]?.status).toBe("sending");
  live = true;
  await queue.flush();
  expect(texts(send)).toEqual(["held"]);
  expect(sdk.pending()).toEqual([]);
});

it("does not show rows as failed when storage discovery fails because the account left", async () => {
  let live = true;
  const { queue, sdk } = box(undefined, () => true, webId, {
    active: () => live,
    storage: async () => {
      live = false;
      throw new Error("Sign in to continue");
    },
  });
  await queue.send(room, "pending");
  await queue.flush();
  expect(sdk.pending().map((item) => item.status)).toEqual(["waiting"]);
  expect(queue.snapshot().map((row) => row.status)).toEqual(["sending"]);
});

it("keeps an in-memory send pending, not failed, when the account left mid-send", async () => {
  let live = true;
  const send = vi.fn(async () => {
    live = false;
    throw new Error("Sign in to continue");
  });
  const { queue } = box(send, () => true, webId, {
    active: () => live,
    open: () => {
      throw new Error("No IndexedDB");
    },
  });
  await queue.send(room, "memory");
  expect(queue.snapshot().map((row) => row.status)).toEqual(["sending"]);
  live = true;
  send.mockImplementationOnce(async () => {
    throw new Error("Server error");
  });
  await queue.flush();
  // A failure while the account is live still fails the row.
  expect(queue.snapshot().map((row) => row.status)).toEqual(["failed"]);
});
