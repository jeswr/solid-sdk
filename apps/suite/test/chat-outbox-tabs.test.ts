// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { ChatModelError } from "../src/apps/chat/lib/model";
import { box, reopen, result, room } from "./chat-outbox-helpers";

it("a new tab delivers an entry after its offline creator closes", async () => {
  const a = box();
  await a.queue.send(room, "survives A closing");
  const pending = a.queue.snapshot()[0]!;
  a.close();
  const c = box(undefined, () => true);
  await c.queue.ready;
  await c.queue.flush();
  expect(c.send).toHaveBeenCalledExactlyOnceWith(room, pending.draft, {
    id: pending.localId,
    at: pending.at,
  });
  expect((await reopen()).pending()).toEqual([]);
});

it("duplicated sessionStorage cannot cause concurrent sends or a false failure", async () => {
  vi.stubGlobal("sessionStorage", { getItem: () => "copied-tab-id", setItem: vi.fn() });
  const a = box();
  await a.queue.send(room, "once");
  a.close();
  const sent = new Set<string>();
  let active = 0;
  const send = vi.fn(async (...args: Parameters<typeof result>) => {
    expect(active++).toBe(0);
    try {
      const message = result(...args);
      if (sent.has(message.id)) throw new ChatModelError("duplicate");
      sent.add(message.id);
      return message;
    } finally {
      active--;
    }
  });
  const b = box(send, () => true),
    c = box(send, () => true);
  await Promise.all([b.queue.ready, c.queue.ready]);
  await Promise.all([b.queue.flush(), c.queue.flush()]);
  expect(send).toHaveBeenCalledOnce();
  expect(
    [...b.queue.snapshot(), ...c.queue.snapshot()].some((entry) => entry.status === "failed"),
  ).toBe(false);
  expect((await reopen()).pending()).toEqual([]);
});

it("broadcasts queued entries and removals without localStorage events", async () => {
  const a = box(),
    b = box();
  await Promise.all([a.queue.ready, b.queue.ready]);
  await a.queue.send(room, "shared");
  await vi.waitFor(() => expect(b.queue.snapshot()).toHaveLength(1));
  await b.queue.discard(b.queue.snapshot()[0]!.id);
  await vi.waitFor(() => expect(a.queue.snapshot()).toEqual([]));
  expect((await reopen()).pending()).toEqual([]);
});

it("an already-open online tab delivers newly broadcast offline intents", async () => {
  const a = box(),
    b = box(undefined, () => true);
  await Promise.all([a.queue.ready, b.queue.ready]);
  await a.queue.send(room, "deliver from a live peer");
  await vi.waitFor(() => expect(b.send).toHaveBeenCalledOnce());
  await b.queue.flush();
  expect((await reopen()).pending()).toEqual([]);
});

it.each([
  false,
  true,
])("a cross-tab discard prunes queued and in-flight sends even after late failure (%s)", async (fail) => {
  let finish!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const send = vi.fn(async (...args: Parameters<typeof result>) => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (fail) throw new Error("late failure");
    return result(...args);
  });
  let online = false;
  const a = box(send, () => online),
    b = box();
  await a.queue.send(room, "in flight");
  await a.queue.send(room, "discard before sending");
  const ids = new Set(a.queue.snapshot().map((entry) => entry.id));
  online = true;
  const replay = a.queue.flush();
  await active;
  await Promise.all([...ids].map((id) => b.queue.discard(id)));
  finish();
  await replay;
  expect(send).toHaveBeenCalledOnce();
  expect((await reopen()).pending()).toEqual([]);
  expect(a.queue.snapshot().some((entry) => entry.status === "failed")).toBe(false);
});

it("documents that discard cannot cancel an in-flight request", () => {
  const readme = readFileSync(
    new URL("../src/apps/chat/lib/client/README.md", import.meta.url),
    "utf8",
  );
  expect(readme).toMatch(/Discard[\s\S]*already in flight[\s\S]*may still/);
});

it("an open tab re-sends an entry a peer returned to waiting, with no online event", async () => {
  let aOnline = false;
  let bOnline = false;
  const aSend = vi.fn(async (): Promise<ReturnType<typeof result>> => {
    aOnline = false; // A loses its connection mid-send; the SDK keeps the entry waiting.
    throw new TypeError("Failed to fetch");
  });
  const a = box(aSend, () => aOnline),
    b = box(undefined, () => bOnline);
  await Promise.all([a.queue.ready, b.queue.ready]);
  await a.queue.send(room, "handed over");
  await vi.waitFor(() => expect(b.queue.snapshot()).toHaveLength(1));
  bOnline = true; // B is online, but no online event fires in B.
  aOnline = true;
  await a.queue.flush();
  expect(aSend).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(b.send).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect((await reopen()).pending()).toEqual([]));
});

it("an open tab delivers an entry its peer left mid-send when that tab closed", async () => {
  let bOnline = false;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  let teardown!: (error: Error) => void;
  const aSend = vi.fn(async (): Promise<ReturnType<typeof result>> => {
    started();
    return new Promise((_, reject) => {
      teardown = reject;
    });
  });
  const a = box(aSend, () => true),
    b = box(undefined, () => bOnline);
  await Promise.all([a.queue.ready, b.queue.ready]);
  const sending = a.queue.send(room, "orphaned");
  await active;
  await vi.waitFor(() => expect(b.queue.snapshot()).toHaveLength(1));
  bOnline = true;
  // A's tab closes with the request outstanding; the page's fetch dies with it.
  a.close();
  teardown(new TypeError("Failed to fetch"));
  await sending;
  await vi.waitFor(() => expect(b.send).toHaveBeenCalledOnce());
  expect(b.send.mock.calls[0]?.[1]).toBe("orphaned");
  await vi.waitFor(async () => expect((await reopen()).pending()).toEqual([]));
});
