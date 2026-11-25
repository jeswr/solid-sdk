// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import { chatOutboxNamespace } from "../src/apps/chat/state/outbox";
import { box, reopen, result, webId } from "./chat-outbox-helpers";

const A = "https://alice.example/";
const B = "https://alice.example/second-storage/";
const roomA = `${A}chat/rooms/a/`;
const roomB = `${B}chat/rooms/b/`;

it("derives one stable namespace per storage that the SDK accepts", () => {
  const names = [A, B, "https://alice.example/second/", "https://other.example/"].map(
    chatOutboxNamespace,
  );
  expect(new Set(names).size).toBe(names.length);
  expect(chatOutboxNamespace(A)).toBe(chatOutboxNamespace(A));
  for (const name of names) expect(name).toMatch(/^chat-[0-9a-f]{14}$/);
});

it("keeps the first storage's rows untouched while a session on another storage of the same WebID runs", async () => {
  const first = box(undefined, () => false, webId, { storageUrl: A });
  await first.queue.send(roomA, "For storage A");
  expect(first.sdk.pending()).toHaveLength(1);
  first.close();
  const sendB = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  const second = box(sendB, () => true, webId, { storageUrl: B });
  await second.queue.ready;
  // Same WebID, other pod: nothing of A's is shown, replayed or marked failed.
  expect(second.queue.snapshot()).toEqual([]);
  expect(second.sdk.pending()).toEqual([]);
  await second.queue.send(roomB, "For storage B");
  await second.queue.flush();
  expect(sendB.mock.calls.map(([room]) => room)).toEqual([roomB]);
  second.close();
  const stored = await reopen(webId, A);
  expect(stored.pending().map((item) => item.status)).toEqual(["waiting"]);
  const back = box(undefined, () => true, webId, { storageUrl: A });
  await back.queue.ready;
  expect(back.queue.snapshot().map((row) => [row.draft, row.status])).toEqual([
    ["For storage A", "sending"],
  ]);
  await back.queue.flush();
  expect(back.send.mock.calls.map(([room, text]) => [room, text])).toEqual([
    [roomA, "For storage A"],
  ]);
});

it("hides and never sends an intent recorded for another storage, even in the same database", async () => {
  // A collision in the hashed namespace would put A's record in B's database: simulate it.
  const send = vi.fn(async (...args: Parameters<typeof result>) => result(...args));
  const other = box(send, () => true, webId, { storageUrl: B });
  await other.queue.ready;
  await other.sdk.enqueue({
    op: "write",
    url: `${B}chat/rooms/b/2026/01/01.ttl`,
    body: JSON.stringify({
      webId,
      storageUrl: A,
      room: roomB,
      draft: "Wrong storage",
      localId: "x",
      at: "2026-01-01T00:00:00.000Z",
    }),
    contentType: "application/vnd.solid-suite.chat-intent+json",
    guard: { tag: "chat.message.v1" },
  });
  await other.queue.flush();
  expect(other.queue.snapshot()).toEqual([]);
  expect(send).not.toHaveBeenCalled();
});
