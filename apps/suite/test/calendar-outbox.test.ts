// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { eventIntent } from "../src/apps/calendar/state/event-channel";
import { outboxKey } from "../src/apps/calendar/state/outbox";
import {
  CalendarHttpError,
  data,
  fixture,
  legacyStorage,
  root,
  url,
  webId,
  write,
} from "./calendar-outbox-fixture";

it("persists JSON intents in the shared outbox, reopens with revived dates and replays via the domain writer", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const first = fixture();
  first.register();
  first.connect();
  await first.adapter.save(write);
  expect(first.send).not.toHaveBeenCalled();
  expect(first.legacy.getItem(outboxKey(webId))).toContain('"writes":[]');
  const [row] = await first.adapter.channel.pending(first.outbox);
  expect(row?.intent?.write).toEqual(write);
  expect(row?.intent?.write.kind !== "delete" && row?.intent?.write.data.start).toBeInstanceOf(
    Date,
  );
  first.outbox.close();
  const next = fixture({ idb: first.idb });
  await next.outbox.ready;
  await next.outbox.replay(next.raw);
  expect(next.outbox.pending()[0]?.blocked).toBe("no-delegate");
  next.register();
  next.connect();
  await next.adapter.flush();
  expect(next.changed).toHaveBeenLastCalledWith([write], true);
  vi.stubGlobal("navigator", { onLine: true });
  await next.outbox.replay(next.raw);
  await vi.waitFor(() => expect(next.changed).toHaveBeenLastCalledWith([], false));
  expect(next.send).toHaveBeenCalledOnce();
  expect((await next.io.loadEvent(url))?.data.name).toBe(data.name);
  expect(next.outbox.pending()).toEqual([]);
});
it("delivers online immediately with the session fetch and returns the latest confirmed ETag", async () => {
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.save(write);
  expect(f.transport).toHaveBeenCalled();
  expect(f.outbox.pending()).toEqual([]);
  const item = await f.io.loadEvent(url);
  expect(await f.adapter.resolve(url, null)).toBe(item?.etag);
  expect(await f.adapter.resolve(url, '"remote"')).toBe('"remote"');
  await f.adapter.save({ kind: "delete", url, etag: item?.etag as string });
  await expect(f.adapter.resolve(url, null)).rejects.toThrow("Reload");
});
it("queues a network failure, retries from the real outbox, and preserves a 412 as a conflict", async () => {
  const f = fixture();
  f.register();
  f.connect();
  f.transport.mockRejectedValueOnce(new TypeError("unreachable"));
  await f.adapter.save(write);
  expect(f.outbox.pending()).toHaveLength(1);
  await f.outbox.retry();
  expect(f.outbox.pending()).toEqual([]);
  vi.stubGlobal("navigator", { onLine: false });
  await f.adapter.save({ kind: "update", url, etag: '"stale"', data: { ...data, name: "Local" } });
  vi.stubGlobal("navigator", { onLine: true });
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()[0]?.status).toBe("conflict");
  expect(f.outbox.conflicts()).toHaveLength(1);
  expect(f.failed).toHaveBeenLastCalledWith(expect.any(CalendarHttpError), true);
  expect((await f.io.loadEvent(url))?.data.name).toBe(data.name);
});
it("chains offline updates and deletes after a create and survives reopening between deliveries", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.save(write);
  expect(await f.adapter.resolve(url, null, false)).toBe("");
  await expect(f.adapter.resolve(url, null)).rejects.toThrow("Reconnect");
  await f.adapter.save({ kind: "update", url, etag: "", data: { ...data, name: "Edited" } });
  await f.adapter.save({ kind: "delete", url, etag: "" });
  expect(f.outbox.pending()).toHaveLength(3);
  // Only the first request lands; the rest stay durable for the replacement session.
  let puts = 0;
  f.transport.mockImplementation(async (input, init) => {
    if (init?.method === "PUT" && ++puts === 2) throw new TypeError("offline again");
    return f.pod.fetch(input, init);
  });
  vi.stubGlobal("navigator", { onLine: true });
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()).toHaveLength(2);
  f.outbox.close();
  const next = fixture({ idb: f.idb });
  next.transport.mockImplementation((input, init) => f.pod.fetch(input, init));
  next.register();
  next.connect();
  await next.adapter.flush();
  await next.outbox.replay(next.raw);
  expect(next.outbox.pending()).toEqual([]);
  await expect(f.io.loadEvent(url)).rejects.toThrow();
});
it("leaves dependent edits conflicted when a remote writer changed the prerequisite", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.save(write);
  await f.adapter.save({ kind: "update", url, etag: "", data: { ...data, name: "Local edit" } });
  f.transport.mockImplementation(async (input, init) => {
    const response = await f.pod.fetch(input, init);
    if (init?.method === "PUT") {
      const item = await f.io.loadEvent(url);
      await f.io.saveEvent(url, { ...data, name: "Remote" }, { etag: item?.etag as string });
    }
    return response;
  });
  vi.stubGlobal("navigator", { onLine: true });
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()[0]?.status).toBe("conflict");
  expect((await f.io.loadEvent(url))?.data.name).toBe("Remote");
});
it("does not overtake a pending intent when an online edit arrives", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.save(write);
  vi.stubGlobal("navigator", { onLine: true });
  await f.adapter.save({ kind: "update", url, etag: "", data: { ...data, name: "New" } });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.outbox.pending()).toHaveLength(2);
  await f.outbox.replay(f.raw);
  expect((await f.io.loadEvent(url))?.data.name).toBe("New");
});
it("imports this WebID's valid legacy entries once, drops corrupt entries individually and keeps other accounts untouched", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const legacy = legacyStorage();
  legacy.setItem(
    outboxKey(webId),
    JSON.stringify({
      v: 1,
      webId,
      writes: [
        { bad: true },
        write,
        { ...write, data: { ...data, description: "x".repeat(65536) } },
        { kind: "delete", url, etag: "*" },
      ],
    }),
  );
  legacy.setItem(outboxKey("other"), "foreign");
  const f = fixture({ legacy });
  f.register();
  const disconnect = f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toHaveLength(1);
  expect(JSON.parse(legacy.getItem(outboxKey(webId)) as string).writes).toEqual([]);
  expect(legacy.getItem(outboxKey("other"))).toBe("foreign");
  disconnect();
  f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toHaveLength(1);
});
it("deduplicates migration after a failed legacy checkpoint and retains records on database failure", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const legacy = legacyStorage();
  legacy.setItem(outboxKey(webId), JSON.stringify({ v: 1, webId, writes: [write] }));
  const set = vi.spyOn(legacy, "setItem").mockImplementationOnce(() => {
    throw new Error("quota");
  });
  const f = fixture({ legacy });
  f.register();
  const stop = f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toHaveLength(1);
  stop();
  f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toHaveLength(1);
  expect(set).toHaveBeenCalled();
  expect(JSON.parse(legacy.getItem(outboxKey(webId)) as string).writes).toEqual([]);
});
it("rejects invalid, foreign and unavailable sessions and fences disconnected submissions", async () => {
  const f = fixture();
  await expect(f.adapter.save(write)).rejects.toThrow("storage is still opening");
  const other = fixture({ webId: `${root}bob#me` });
  expect(() =>
    f.adapter.connect({
      outbox: other.outbox,
      storage: other.storage,
      signal: other.controller.signal,
    }),
  ).toThrow("identity mismatch");
  f.controller.abort();
  expect(() => f.connect()).toThrow();
  const next = fixture();
  next.register();
  const stop = next.connect();
  await next.adapter.flush();
  stop();
  await expect(next.adapter.save(write)).rejects.toThrow("storage is still opening");
});
it("requires confirmation for compound steps and never retains their unsent operations", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture();
  f.register();
  f.connect();
  await expect(f.adapter.save(write, true)).rejects.toThrow("Reconnect");
  expect(f.outbox.pending()).toEqual([]);
  await f.adapter.save(write);
  await expect(f.adapter.save({ kind: "delete", url, etag: "" }, true)).rejects.toThrow(
    "Reconnect",
  );
  expect(f.outbox.pending()).toHaveLength(1);
});
it("keeps demo delivery in memory, retries offline work and never writes persistence", async () => {
  const f = fixture({ demo: true });
  f.adapter.restore();
  f.send.mockRejectedValueOnce(new TypeError("Calendar network unavailable"));
  await f.adapter.save(write);
  expect(f.changed).toHaveBeenLastCalledWith([write], true);
  expect(f.legacy.getItem(outboxKey(webId))).toBeNull();
  await f.adapter.flush();
  expect(f.changed).toHaveBeenLastCalledWith([], false);
  expect(f.outbox.pending()).toEqual([]);
  f.send.mockRejectedValueOnce(new Error("denied"));
  await expect(f.adapter.save({ ...write, url: `${root}calendar/work/other.ttl` })).rejects.toThrow(
    "denied",
  );
  expect(f.changed).toHaveBeenLastCalledWith([], false);
});
it("rejects domain errors and invalid validators without losing unrelated retained intents", async () => {
  const f = fixture();
  f.register();
  f.connect();
  for (const etag of ["", "*", 'W/"weak"', "unquoted"])
    await expect(f.adapter.save({ kind: "delete", url, etag })).rejects.toThrow("Reload");
  f.send.mockRejectedValueOnce(new Error("denied"));
  await expect(f.adapter.save(write)).rejects.toThrow("denied");
  vi.stubGlobal("navigator", { onLine: false });
  await f.adapter.save(write);
  await f.adapter.channel.enqueue(
    f.outbox,
    eventIntent({ ...write, url: `${root}calendar/work/unrelated.ttl` }),
  );
  expect(f.outbox.pending()).toHaveLength(2);
  await expect(
    f.adapter.save({ ...write, data: { ...data, description: "x".repeat(70000) } }),
  ).rejects.toThrow();
});

it.each([
  "{broken",
  { v: 2, webId, writes: [write] },
  { v: 1, webId: "other", writes: [write] },
  { v: 1, webId, writes: {} },
  { v: 1, webId, writes: Array(101).fill(write) },
])("drops invalid legacy envelopes without delivering them: %j", async (envelope) => {
  const legacy = legacyStorage();
  legacy.setItem(
    outboxKey(webId),
    typeof envelope === "string" ? envelope : JSON.stringify(envelope),
  );
  const f = fixture({ legacy });
  f.register();
  f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toEqual([]);
  expect(JSON.parse(legacy.getItem(outboxKey(webId)) as string).writes).toEqual([]);
});
it("retains unavailable legacy storage and fences a migration disconnected before its lock starts", async () => {
  const legacy = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: vi.fn(),
  };
  const f = fixture({ legacy });
  f.register();
  f.connect();
  await f.adapter.flush();
  expect(legacy.setItem).not.toHaveBeenCalled();
  const pending = fixture();
  pending.register();
  const stop = pending.connect();
  stop();
  await pending.adapter.flush();
  expect(pending.outbox.pending()).toEqual([]);
});
it("imports chained updates/deletes without Web Locks and refuses writes after a pending delete", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const legacy = legacyStorage();
  legacy.setItem(
    outboxKey(webId),
    JSON.stringify({
      v: 1,
      webId,
      writes: [
        write,
        { kind: "update", url, data: { ...data, name: "After" }, etag: '"1"' },
        { kind: "delete", url, etag: '"2"' },
      ],
    }),
  );
  const f = fixture({ legacy });
  f.register();
  f.connect();
  await f.adapter.flush();
  expect(f.outbox.pending()).toHaveLength(3);
  await expect(f.adapter.save({ kind: "update", url, etag: '"3"', data })).rejects.toThrow(
    "Reload",
  );
  expect(await f.adapter.resolve(url, '"local"', false)).toBe('"local"');
  vi.stubGlobal("navigator", { onLine: true });
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()).toEqual([]);
});
it("rejects compound operations behind durable prerequisites while leaving unrelated resources alone", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture({ recovery: { fetch: globalThis.fetch, storageUrl: root, warn: vi.fn() } });
  f.register();
  f.connect();
  await f.adapter.save(write);
  await expect(
    f.adapter.compound?.(
      { ...write, url: `${root}calendar/work/replacement.ttl` },
      { kind: "delete", url, etag: '"old"' },
      { current: undefined },
    ),
  ).rejects.toThrow("Reconnect");
  expect(f.outbox.pending()).toHaveLength(1);
});
it("single-flights demo flushes, retains offline failures and rejects non-network failures", async () => {
  const f = fixture({ demo: true });
  f.send.mockRejectedValue(new TypeError("Calendar network unavailable"));
  await f.adapter.save(write);
  await expect(f.adapter.resolve(url, null)).rejects.toThrow("Reconnect");
  expect(await f.adapter.resolve(url, null, false)).toBe("");
  expect(await f.adapter.resolve(url, '"queued"', false)).toBe('"queued"');
  f.send.mockRejectedValueOnce(new Error("permission denied"));
  await expect(f.adapter.flush()).rejects.toThrow("permission denied");
  let finish!: (value: string) => void;
  f.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.adapter.flush();
  const second = f.adapter.flush();
  expect(second).toBe(first);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  finish('"saved"');
  await first;
  expect(f.changed).toHaveBeenLastCalledWith([], false);
});
it("keeps optimistic same-resource submissions ordered and fences a stale binding during submission", async () => {
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.flush();
  let finish!: (etag: string) => void;
  f.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.adapter.save(write);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const second = f.adapter.save({
    kind: "update",
    url,
    etag: "",
    data: { ...data, name: "Second" },
  });
  const rejected = expect(second).rejects.toThrow();
  finish('"first"');
  await first;
  await rejected;
  const stop = f.connect();
  const read = vi.spyOn(f.adapter.channel, "pending");
  read.mockImplementationOnce(async () => {
    stop();
    return [];
  });
  await expect(
    f.adapter.save({ ...write, url: `${root}calendar/work/fenced.ttl` }),
  ).rejects.toThrow("session changed");
});
it("drops an error row from the overlay and tolerates refresh failure until the next change", async () => {
  const f = fixture();
  f.register();
  f.connect();
  await f.adapter.flush();
  const read = vi
    .spyOn(f.adapter.channel, "pending")
    .mockRejectedValueOnce(new Error("idb unavailable"));
  await f.outbox.enqueue({
    op: "write",
    url,
    contentType: "application/json",
    body: "{}",
    guard: { tag: "calendar.event-v1" },
  });
  await f.adapter.flush();
  expect(read).toHaveBeenCalled();
  expect(f.changed).toHaveBeenLastCalledWith([], true);
});

it("handles an unconfirmed step removed by another consumer before its submission settles", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const f = fixture();
  f.register();
  f.connect();
  const submit = f.adapter.channel.submit.bind(f.adapter.channel);
  vi.spyOn(f.adapter.channel, "submit").mockImplementationOnce(async (storage, intent) => {
    const result = await submit(storage, intent);
    const queued = f.outbox.pending()[0];
    if (queued) await f.outbox.discard(queued.id);
    return result;
  });
  await expect(f.adapter.save(write, true)).rejects.toThrow("Reconnect");
  expect(f.outbox.pending()).toEqual([]);
});
