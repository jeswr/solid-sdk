// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import {
  createEventOutbox,
  type OutboxStorage,
  outboxKey,
} from "../src/apps/calendar/state/outbox";
import type { EventWrite } from "../src/apps/calendar/state/repository";

const web = "https://pod.example/profile#me";
const write: EventWrite = {
  kind: "create",
  url: "https://pod.example/calendar/work/e.ttl",
  data: {
    name: "2026-11-01T12:00:00Z",
    start: new Date("2026-11-01T12:00Z"),
    end: new Date("2026-11-01T13:00Z"),
    recurrence: {
      frequency: "WEEKLY",
      until: new Date("2026-12-01"),
      exceptDate: [new Date("2026-11-08T12:00Z"), "2026-11-15"],
    },
    reminders: [{ triggerOffset: "-PT5M" }, { triggerTime: new Date("2026-11-01T11:30Z") }],
  },
};
function store(): OutboxStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}
function setup(
  storage = store(),
  send: (w: EventWrite) => Promise<void> = async () => {},
  allowed: (write: EventWrite) => void = vi.fn(),
) {
  const changed = vi.fn();
  const box = createEventOutbox(web, storage, send, changed, allowed);
  return { box, changed, storage, allowed };
}
it("persists before sending and revives only known dates on next load", async () => {
  const storage = store();
  const offline = vi.fn(async () => {
    throw new TypeError("Calendar network unavailable");
  });
  const { box, changed } = setup(storage, offline);
  await box.save(write);
  expect(changed).toHaveBeenLastCalledWith([write], true);
  const send = vi.fn(async () => {});
  const next = setup(storage, send);
  next.box.restore();
  const revived = next.changed.mock.calls[0]![0][0] as typeof write;
  expect(revived.data.start).toBeInstanceOf(Date);
  expect(revived.data.name).toBe(write.data.name);
  expect(revived.data.recurrence?.until).toBeInstanceOf(Date);
  expect(revived.data.recurrence?.exceptDate?.[0]).toBeInstanceOf(Date);
  expect(revived.data.recurrence?.exceptDate?.[1]).toBe("2026-11-15");
  expect(revived.data.reminders?.[1]?.triggerTime).toBeInstanceOf(Date);
  await next.box.flush();
  expect(send).toHaveBeenCalledOnce();
  expect(JSON.parse(storage.getItem(outboxKey(web))!).writes).toEqual([]);
});
it("serializes writes, shares a flush, retains offline order and retries", async () => {
  let finish!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { box } = setup(store(), send);
  const first = box.save(write);
  const second = box.save({ ...write, url: "https://pod.example/calendar/work/f.ttl" });
  const flush = box.flush();
  expect(box.flush()).toBe(flush);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  finish();
  await Promise.all([first, second, flush]);
  expect(send).toHaveBeenCalledTimes(2);
  let network = true;
  const next = setup(store(), async () => {
    if (network) throw new TypeError("Calendar network unavailable");
  });
  await next.box.save(write);
  await next.box.save({ ...write, url: "https://pod.example/calendar/work/f.ttl" });
  expect(next.changed).toHaveBeenLastCalledWith(expect.any(Array), true);
  network = false;
  await next.box.flush();
  expect(next.changed).toHaveBeenLastCalledWith([], false);
});
it("rolls back non-network failures and validates before writes", async () => {
  const failure = new Error("412");
  const { box, changed } = setup(store(), async () => {
    throw failure;
  });
  await expect(box.save(write)).rejects.toBe(failure);
  expect(changed).toHaveBeenLastCalledWith([], false);
  const invalid = setup(
    store(),
    async () => {},
    () => {
      throw new Error("outside pod");
    },
  );
  await expect(invalid.box.save(write)).rejects.toThrow("outside pod");
  const persisted = store();
  persisted.setItem(outboxKey(web), JSON.stringify({ v: 1, webId: web, writes: [write] }));
  const replay = setup(
    persisted,
    async () => {},
    () => {
      throw new Error("removed calendar");
    },
  );
  await replay.box.flush();
  expect(replay.changed).toHaveBeenLastCalledWith([], false);
  const type = setup(store(), async () => {
    throw new TypeError("invalid event");
  });
  await expect(type.box.save(write)).rejects.toThrow("invalid event");
});
it("ignores corrupt, oversized, invalid and foreign envelopes", () => {
  for (const raw of [
    "bad",
    JSON.stringify({ v: 2, webId: web, writes: [] }),
    JSON.stringify({ v: 1, webId: "other", writes: [write] }),
    JSON.stringify({ v: 1, webId: web, writes: {} }),
    JSON.stringify({ v: 1, webId: web, writes: Array(101).fill(write) }),
    ...[
      { ...write, kind: "bad" },
      { ...write, url: 5 },
      { kind: "delete", url: write.url, etag: "" },
      { kind: "delete", url: write.url, etag: "*" },
      { kind: "delete", url: write.url, etag: 'W/"1"' },
      { ...write, data: { ...write.data, start: "bad" } },
    ].map((w) => JSON.stringify({ v: 1, webId: web, writes: [w] })),
  ]) {
    const storage = store();
    storage.setItem(outboxKey(web), raw);
    const { box, changed } = setup(storage);
    box.restore();
    expect(changed).toHaveBeenLastCalledWith([], false);
  }
});
it("restores date-only/minimal/delete/update writes and works with blocked storage", async () => {
  const storage = store();
  const minimal: EventWrite = {
    kind: "update",
    url: write.url,
    etag: '"1"',
    data: {
      name: "Day",
      start: "2026-11-01",
      recurrence: { frequency: "DAILY", until: "2026-12-01" },
    },
  };
  const deleted: EventWrite = { kind: "delete", url: write.url, etag: '"2"' };
  storage.setItem(
    outboxKey(web),
    JSON.stringify({
      v: 1,
      webId: web,
      writes: [
        { ...minimal, data: { name: "No rule", start: "2026-11-01" } },
        minimal,
        deleted,
        {
          ...minimal,
          data: { name: "Minimal", start: "2026-11-01", recurrence: { frequency: "DAILY" } },
        },
      ],
    }),
  );
  const { box, changed } = setup(storage);
  box.restore();
  expect(changed.mock.calls[0]![0][0].data.start).toBe("2026-11-01");
  await box.flush();
  const broken = {
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  };
  const next = setup(broken);
  next.box.restore();
  await next.box.save(write);
  expect(next.changed).toHaveBeenLastCalledWith([], false);
});
it("bounds the queue by count and size", async () => {
  const { box } = setup(store(), async () => {
    throw new TypeError("Calendar network unavailable");
  });
  for (let i = 0; i < 100; i++)
    await box.save({ ...write, url: `https://pod.example/calendar/work/${i}.ttl` });
  await expect(box.save(write)).rejects.toThrow("full");
  const next = setup();
  await expect(
    next.box.save({ ...write, data: { ...write.data, description: "x".repeat(512001) } }),
  ).rejects.toThrow("full");
});
it("rebases queued conditional writes on the ETag returned by the preceding replay", async () => {
  const storage = store();
  const update: EventWrite = { kind: "update", url: write.url, etag: '"old"', data: write.data };
  const unrelated: EventWrite = { ...update, url: `${write.url}-other` };
  storage.setItem(
    outboxKey(web),
    JSON.stringify({ v: 1, webId: web, writes: [update, update, unrelated, write] }),
  );
  const seen: EventWrite[] = [];
  const box = createEventOutbox(
    web,
    storage,
    async (current) => {
      seen.push({ ...current });
      return '"new"';
    },
    () => {},
    () => {},
  );
  await box.flush();
  expect(seen[0]).toMatchObject({ etag: '"old"' });
  expect(seen[1]).toMatchObject({ etag: '"new"' });
  expect(seen[2]).toMatchObject({ etag: '"old"' });
  expect(seen[3]?.kind).toBe("create");
});
