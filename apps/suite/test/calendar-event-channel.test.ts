// AUTHORED-BY Codex GPT-6.1-Sol
import type { GuardedDelivery, ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { expect, it, vi } from "vitest";
import {
  decodeEventIntent,
  eventDestination,
  eventIntent,
} from "../src/apps/calendar/state/event-channel";
import { decodeEvent, reviveEventWrite } from "../src/apps/calendar/state/event-write";
import { data, fixture, root, url, write } from "./calendar-outbox-fixture";

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

it("decodes the full event model, reviving known dates and preserving date-shaped text", () => {
  const intent = decodeEventIntent(json(eventIntent(write)));
  expect(intent.write).toEqual(write);
  expect(eventDestination(intent)).toBe(url);
  expect(decodeEvent({ name: "2026-11-01", start: "2026-11-01" })).toEqual(
    expect.objectContaining({ name: "2026-11-01", start: "2026-11-01" }),
  );
  expect(
    decodeEvent({
      name: "Day",
      start: "2026-11-01",
      recurrence: { frequency: "DAILY", until: "2026-12-01" },
    }).recurrence?.until,
  ).toBe("2026-12-01");
  expect(reviveEventWrite({ kind: "delete", url, etag: '"1"' })).toEqual({
    kind: "delete",
    url,
    etag: '"1"',
  });
});
it.each([
  null,
  [],
  {},
  { name: 7, start: "2026-11-01" },
  { ...json(data), extra: true },
  { ...json(data), location: 7 },
  { ...json(data), start: 7 },
  { ...json(data), start: "2026-11-01T12:00Z" },
  { ...json(data), end: "bad" },
  { ...json(data), recurrence: null },
  { ...json(data), recurrence: { frequency: "DAILY", extra: true } },
  { ...json(data), recurrence: { frequency: "DAILY", byDay: "MO" } },
  { ...json(data), recurrence: { frequency: "DAILY", exceptDate: [7] } },
  { ...json(data), reminders: {} },
  { ...json(data), reminders: [{ triggerOffset: 7 }] },
  { ...json(data), reminders: [{ extra: true }] },
  { ...json(data), reminders: [{ triggerTime: "2026-11-01" }] },
])("refuses invalid event data %j", (value) => {
  expect(() => decodeEvent(value)).toThrow();
});
it.each([
  null,
  [],
  {},
  { kind: "bad", url },
  { kind: "create", url: 5, data: json(data) },
  { kind: "delete", url, etag: "*" },
  { kind: "delete", url, etag: 'W/"weak"' },
  { kind: "delete", url, etag: '"1"', data: json(data) },
  { ...json(write), etag: '"1"' },
  { ...json(write), confirmation: { etag: '"1"' } },
])("refuses invalid writes %j", (value) => {
  expect(() => reviveEventWrite(value)).toThrow();
});
it.each([
  null,
  [],
  {},
  { ...json(eventIntent(write)), extra: true },
  { ...json(eventIntent(write)), id: "bad/id" },
  { ...json(eventIntent(write)), name: "../other.ttl" },
  { ...json(eventIntent(write)), name: "bad%2fkey.ttl" },
  { ...json(eventIntent(write)), name: "" },
  { ...json(eventIntent(write)), collection: `${root}calendar/work` },
  { ...json(eventIntent(write)), collection: `${root}calendar/work/?query` },
  { ...json(eventIntent(write)), collection: "https://user@pod.example/calendar/work/" },
  { ...json(eventIntent(write)), collection: "ftp://pod.example/calendar/work/" },
  { ...json(eventIntent(write)), name: "wrong.ttl" },
  { ...json(eventIntent(write)), after: json(data) },
])("refuses invalid intents and destinations %j", (value) => {
  expect(() => decodeEventIntent(value)).toThrow();
});
it("requires guards for event and calendar documents, collections and named creates, while leaving other app resources usable", async () => {
  const f = fixture();
  f.register();
  for (const target of [url, `${root}calendar/work.ttl`, `${root}calendar/work/`]) {
    await expect(
      f.storage.write(target, "{}", {
        contentType: "application/json",
        ifMatch: "*",
        offline: "queue",
      }),
    ).rejects.toThrow("guard required");
  }
  await expect(
    f.storage.create(`${root}calendar/work/`, "{}", {
      name: "e.ttl",
      contentType: "application/json",
    }),
  ).rejects.toThrow("guard required");
  await f.storage.write(`${root}other.txt`, "ok", { contentType: "text/plain", ifMatch: "*" });
  expect(f.send).not.toHaveBeenCalled();
});
it.each([
  { op: "delete" },
  { op: "create" },
  { contentType: "text/turtle" },
  { body: new Uint8Array([255]) },
  { body: new TextEncoder().encode("bad JSON") },
  { body: new Uint8Array(65537) },
  { url: `${root}calendar/work/wrong.ttl` },
  {
    body: new TextEncoder().encode(
      JSON.stringify(eventIntent({ ...write, url: "https://evil.example/event.ttl" })),
    ),
  },
])("fails closed before domain I/O on tampered delivery %j", async (override) => {
  const f = fixture();
  let delegate!: ReplayDelegate;
  f.adapter.channel.register({
    registerGuardPolicy: () => () => {},
    registerReplayDelegate: (_tag, factory) => {
      delegate = factory(f.context);
      return () => {};
    },
  });
  await expect(
    delegate(
      {
        op: "write",
        url,
        contentType: "application/json",
        body: new TextEncoder().encode(JSON.stringify(eventIntent(write))),
        purpose: "replay",
        ...override,
      } as GuardedDelivery,
      { storage: f.raw, signal: f.controller.signal },
    ),
  ).rejects.toThrow(/Invalid|mismatch/);
  expect(f.transport).not.toHaveBeenCalled();
});
it("keeps missing policies/delegates blocked and rejects a stale session before any request", async () => {
  const f = fixture();
  const unregister = f.register();
  f.connect();
  await f.adapter.channel.enqueue(f.outbox, eventIntent(write));
  unregister();
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()[0]?.blocked).toBe("no-delegate");
  f.register();
  f.controller.abort();
  await f.outbox.replay(f.raw);
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.outbox.pending()[0]?.status).toBe("failed");
});
it("retains ordinary domain failures without classifying them as offline", async () => {
  const f = fixture();
  f.register();
  f.connect();
  f.send.mockRejectedValueOnce(new Error("forbidden"));
  await expect(f.adapter.save(write)).rejects.toThrow("forbidden");
  expect(f.outbox.pending()).toEqual([]);
});

it("reports missing or changed predecessors as conflicts, and propagates HTTP failures", async () => {
  const conflict = vi.fn();
  const f = fixture({ conflict });
  f.register();
  f.connect();
  const dependent = eventIntent(
    { kind: "update", url, etag: "", data: { name: "Next", start: "2026-11-01" } },
    undefined,
    data,
  );
  await f.adapter.channel.enqueue(f.outbox, dependent);
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()[0]?.status).toBe("conflict");
  expect(conflict).toHaveBeenCalledOnce();
  const broken = fixture();
  broken.register();
  broken.connect();
  broken.transport.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await broken.adapter.channel.enqueue(broken.outbox, dependent);
  await broken.outbox.replay(broken.raw);
  expect(broken.outbox.pending()[0]?.status).toBe("failed");
});
it("does not replace non-network transport errors or aborted requests with offline success", async () => {
  const f = fixture();
  f.register();
  f.connect();
  f.transport.mockRejectedValueOnce(new Error("transport denied"));
  await expect(f.adapter.save(write)).rejects.toThrow("transport denied");
  f.transport.mockImplementationOnce(async () => {
    f.controller.abort();
    throw new TypeError("cancelled");
  });
  await expect(f.adapter.save(write)).rejects.toThrow();
  expect(f.outbox.pending()).toEqual([]);
});
it("wraps network failures when reading a predecessor and respects missing validator evidence", async () => {
  const f = fixture();
  f.register();
  f.connect();
  const dependent = eventIntent({ kind: "delete", url, etag: "" }, undefined, data);
  f.transport.mockRejectedValueOnce(new TypeError("offline"));
  expect((await f.adapter.channel.submit(f.storage, dependent)).queued).toBe(true);
  await f.io.saveEvent(url, data, { create: true });
  f.transport.mockImplementation(async (input, init) => {
    const response = await f.pod.fetch(input, init);
    const headers = new Headers(response.headers);
    headers.delete("etag");
    return new Response(response.body, { status: response.status, headers });
  });
  await f.outbox.replay(f.raw);
  expect(f.outbox.pending()[0]?.status).toBe("conflict");
});

it("rejects oversized legacy intents before persistence", () => {
  expect(() =>
    decodeEventIntent(
      json(eventIntent({ ...write, data: { ...data, description: "x".repeat(65536) } })),
    ),
  ).toThrow("size");
});
