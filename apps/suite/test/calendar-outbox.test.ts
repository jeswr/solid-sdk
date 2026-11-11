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
    timeZone: "America/New_York",
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
  expect(revived.data.timeZone).toBe("America/New_York");
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

it.each([
  "update",
  "delete",
] as const)("chains a %s on an in-flight create and uses its ETag", async (kind) => {
  let finish!: (etag: string) => void;
  const send = vi.fn(async (current: EventWrite) => {
    if (current.kind === "create")
      return await new Promise<string>((resolve) => {
        finish = resolve;
      });
    return '"edited"';
  });
  const box = createEventOutbox(
    web,
    store(),
    send,
    () => {},
    () => {},
  );
  const first = box.save({ ...write });
  const dependent: EventWrite =
    kind === "update"
      ? { kind, url: write.url, etag: "", data: { ...write.data, name: "Edited draft" } }
      : { kind, url: write.url, etag: "" };
  const second = box.save(dependent);
  expect(send).toHaveBeenCalledOnce();
  finish('"created"');
  await Promise.all([first, second]);
  expect(send.mock.calls[1]?.[0]).toMatchObject({ kind, etag: '"created"' });
  expect(await box.resolve(write.url, null)).toBe('"edited"');
});
it("resolves the latest local ETag even after a preceding write has finished", async () => {
  const box = createEventOutbox(
    web,
    store(),
    async () => '"new"',
    () => {},
    () => {},
  );
  await box.save({ ...write });
  expect(await box.resolve(write.url, null)).toBe('"new"');
  expect(await box.resolve(write.url, '"remote"')).toBe('"remote"');
  expect(await box.resolve(`${write.url}-other`, '"other"')).toBe('"other"');
  for (const etag of [null, "", "*", 'W/"weak"'])
    await expect(box.resolve(`${write.url}-unknown`, etag)).rejects.toThrow("Reload");
  const noTag = createEventOutbox(
    web,
    store(),
    async () => null,
    () => {},
    () => {},
  );
  await noTag.save({ ...write });
  await expect(noTag.resolve(write.url, null)).rejects.toThrow("Reload");
});
it("waits for pending writes before resolving preconditions and surfaces prerequisite rejection", async () => {
  let reject!: (error: Error) => void;
  const failure = new Error("412");
  const send = vi.fn(
    () =>
      new Promise<string>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const box = createEventOutbox(
    web,
    store(),
    send,
    () => {},
    () => {},
  );
  const first = box.save({ ...write });
  const firstRejected = expect(first).rejects.toBe(failure);
  const second = box.save({ kind: "delete", url: write.url, etag: "" });
  const secondRejected = expect(second).rejects.toBe(failure);
  const resolved = box.resolve(write.url, null);
  const resolvedRejected = expect(resolved).rejects.toBe(failure);
  reject(failure);
  await Promise.all([firstRejected, secondRejected, resolvedRejected]);
  expect(send).toHaveBeenCalledOnce();
});
it("coalesces edits to offline creates, cancels unsent creates and refuses unconfirmed compound writes", async () => {
  const send = vi.fn(async () => {
    throw new TypeError("Calendar network unavailable");
  });
  const { box, changed } = setup(store(), send);
  await box.save({ ...write });
  await expect(box.resolve(write.url, null)).rejects.toThrow("Reconnect");
  await box.save({
    kind: "update",
    url: write.url,
    etag: "",
    data: { ...write.data, name: "Queued edit" },
  });
  expect(changed).toHaveBeenLastCalledWith(
    [
      expect.objectContaining({
        kind: "create",
        data: expect.objectContaining({ name: "Queued edit" }),
      }),
    ],
    true,
  );
  expect(await box.resolve(write.url, null, false)).toBe("");
  expect(await box.resolve(write.url, '"queued"', false)).toBe('"queued"');
  await box.save({ kind: "delete", url: write.url, etag: "" });
  expect(changed).toHaveBeenLastCalledWith([], true);
  for (const etag of ["", "*", 'W/"weak"'])
    await expect(box.save({ kind: "delete", url: write.url, etag })).rejects.toThrow("Reload");
});

it("requires confirmed compound writes and removes unsent steps when the network disappears", async () => {
  const { box, changed, storage } = setup(store(), async () => {
    throw new TypeError("Calendar network unavailable");
  });
  await expect(box.save({ ...write }, true)).rejects.toThrow("Reconnect");
  expect(changed).toHaveBeenLastCalledWith([], true);
  expect(JSON.parse(storage.getItem(outboxKey(web))!).writes).toEqual([]);
  await expect(box.save({ kind: "delete", url: write.url, etag: '"1"' }, true)).rejects.toThrow(
    "Reconnect",
  );
  expect(changed).toHaveBeenLastCalledWith([], true);
  const next = setup();
  await next.box.save({ ...write }, true);
  expect(next.changed).toHaveBeenLastCalledWith([], false);
});

it("rejects dependent intents without dropping unrelated queued resources", async () => {
  let fail!: (error: Error) => void;
  const failure = new Error("failed create");
  const send = vi.fn(async (current: EventWrite) => {
    if (current.url === write.url)
      return await new Promise<string>((_resolve, reject) => {
        fail = reject;
      });
    return '"unrelated"';
  });
  const box = createEventOutbox(
    web,
    store(),
    send,
    () => {},
    () => {},
  );
  const first = box.save({ ...write });
  const rejected = expect(first).rejects.toBe(failure);
  const other = box.save({ ...write, url: `${write.url}-other` });
  fail(failure);
  await Promise.all([rejected, other]);
  expect(send).toHaveBeenCalledTimes(2);
});
