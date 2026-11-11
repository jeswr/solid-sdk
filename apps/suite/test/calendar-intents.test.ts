// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import {
  buildEvent,
  type CalendarEvent,
  calendarIO,
  serializeDataset,
} from "../src/apps/calendar/lib/model";
import { applySeriesPlan, type SeriesReplacement } from "../src/apps/calendar/state/editing";
import {
  createSeriesIntents,
  intentsKey,
  type SeriesIntent,
  SeriesJournal,
} from "../src/apps/calendar/state/intents";
import {
  createEventOutbox,
  type OutboxStorage,
  outboxKey,
} from "../src/apps/calendar/state/outbox";
import type { EventWrite } from "../src/apps/calendar/state/repository";

const root = "https://pod.example/";
const web = `${root}profile#me`;
const data: CalendarEvent = { name: "Meeting", start: new Date("2026-11-01T12:00Z"), uid: "new" };
const created = { kind: "create", url: `${root}calendar/work/copy.ttl`, data } as const;
const original = {
  kind: "update",
  url: `${root}calendar/work/master.ttl`,
  etag: '"old"',
  data: { ...data, name: "Excepted", uid: "master" },
} as const;
function store(): OutboxStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
function intent(patch: Partial<SeriesIntent> = {}): SeriesIntent {
  return { created, original, ...patch };
}
afterEach(() => vi.unstubAllGlobals());

it("journals full account-scoped plans, checkpoints and clears, reviving model dates", () => {
  const storage = store();
  const journal = new SeriesJournal(web, storage);
  expect(journal.list()).toEqual([]);
  const record = intent();
  expect(journal.put(record)).toBe(true);
  const next = new SeriesJournal(web, storage);
  expect(next.list()).toEqual([record]);
  expect(next.list()[0]?.created.data.start).toBeInstanceOf(Date);
  expect(new SeriesJournal("other", storage).list()).toEqual([]);
  record.replacementEtag = '"copy"';
  record.attemptingOriginal = true;
  next.put(record);
  expect(journal.list()).toEqual([record]);
  const second = intent({ created: { ...created, url: `${created.url}-other` } });
  journal.put(second);
  next.remove(record);
  expect(journal.list()).toEqual([second]);
  next.remove(second);
  expect(journal.list()).toEqual([]);
});
it("ignores corrupt JSON, foreign accounts, invalid envelopes and invalid plans safely", () => {
  for (const raw of [
    "bad",
    "null",
    JSON.stringify({ v: 2 }),
    JSON.stringify({ v: 1, webId: "other", intents: [] }),
    JSON.stringify({ v: 1, webId: web, intents: {} }),
    ...[
      { ...intent(), created: original },
      { ...intent(), original: created },
      { ...intent(), original: { ...original, url: created.url } },
      { ...intent(), created: { ...created, data: { ...data, start: "bad" } } },
    ].map((record) => JSON.stringify({ v: 1, webId: web, intents: [record] })),
  ]) {
    const storage = store();
    storage.setItem(intentsKey(web), raw);
    expect(new SeriesJournal(web, storage).list()).toEqual([]);
  }
});
it("uses memory if reads or writes throw and never claims persistence", () => {
  for (const fail of ["get", "set"]) {
    const storage = {
      getItem: () => {
        if (fail === "get") throw Error("blocked");
        return null;
      },
      setItem: () => {
        throw Error("full");
      },
    };
    const journal = new SeriesJournal(web, storage);
    expect(journal.put(intent())).toBe(false);
    expect(journal.list()).toEqual([intent()]);
    journal.remove(intent());
    expect(journal.list()).toEqual([]);
  }
});
it("serializes local callers and tabs, releases failed locks, and supports browsers without Web Locks", async () => {
  const a = new SeriesJournal(web, store());
  const b = new SeriesJournal(web, store());
  const order: number[] = [];
  let finish!: () => void;
  const first = a.lock(async () => {
    order.push(1);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    throw Error("failed");
  });
  const rejected = expect(first).rejects.toThrow("failed");
  const second = b.lock(async () => {
    order.push(2);
  });
  await vi.waitFor(() => expect(order).toEqual([1]));
  finish();
  await Promise.all([rejected, second]);
  expect(order).toEqual([1, 2]);
  vi.stubGlobal("navigator", undefined);
  expect(await a.lock(async () => "fallback")).toBe("fallback");
});

async function pod() {
  const resources = new Map<string, { turtle: string; etag: string | null }>();
  let version = 0;
  async function put(url: string, event: CalendarEvent, etag: string | null = `"${++version}"`) {
    resources.set(url, { turtle: await serializeDataset(buildEvent(url, event)), etag });
  }
  await put(original.url, { ...data, name: "Master", uid: "master" }, original.etag);
  const requests: Request[] = [];
  let intercept: (request: Request) => Promise<Response | undefined> = async () => undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const override = await intercept(request);
    if (override) return override;
    const saved = resources.get(request.url);
    if (request.method === "GET")
      return saved
        ? new Response(saved.turtle, {
            headers: { "Content-Type": "text/turtle", ...(saved.etag ? { ETag: saved.etag } : {}) },
          })
        : new Response(null, { status: 404 });
    if (request.method === "PUT") {
      if (
        request.headers.has("If-None-Match")
          ? saved
          : saved?.etag !== request.headers.get("If-Match")
      )
        return new Response(null, { status: 412 });
      const etag = `"${++version}"`;
      resources.set(request.url, { turtle: await request.text(), etag });
      return new Response(null, { status: 201, headers: { ETag: etag } });
    }
    if (!saved) return new Response(null, { status: 404 });
    if (saved.etag !== request.headers.get("If-Match")) return new Response(null, { status: 412 });
    resources.delete(request.url);
    return new Response(null, { status: 204 });
  };
  const io = calendarIO(fetch, root);
  const send = vi.fn(async (write: EventWrite) => {
    if (write.kind === "delete") return await io.removeEvent(write.url, write.etag);
    return await io.saveEvent(
      write.url,
      write.data,
      write.kind === "create" ? { create: true } : { etag: write.etag },
    );
  });
  const storage = store();
  const warn = vi.fn();
  const allowed = vi.fn();
  const recovery = { fetch, storageUrl: root, warn };
  const controller = () => createSeriesIntents(web, storage, send, allowed, recovery);
  return {
    resources,
    put,
    requests,
    io,
    send,
    storage,
    warn,
    allowed,
    recovery,
    controller,
    intercept: (callback: typeof intercept) => {
      intercept = callback;
    },
    journal: new SeriesJournal(web, storage),
  };
}

it.each([
  "update",
  "delete",
] as const)("resumes a reload after replacement creation and completes the master %s once", async (kind) => {
  const p = await pod();
  const etag = await p.io.saveEvent(created.url, data, { create: true });
  const change = kind === "update" ? original : { kind, url: original.url, etag: original.etag };
  p.journal.put(intent({ original: change, replacementEtag: etag }));
  await p.controller().recover();
  expect(p.send).toHaveBeenCalledTimes(1);
  expect(p.send).toHaveBeenCalledWith(change);
  expect(p.journal.list()).toEqual([]);
  await p.controller().recover();
  expect(p.send).toHaveBeenCalledTimes(1);
  expect(p.resources.has(created.url)).toBe(true);
});
it("adopts identical full RDF after losing the create response and persists its ETag before compensation", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  await p.put(original.url, { ...data, name: "Changed elsewhere" }, '"foreign"');
  p.journal.put(intent());
  p.intercept(async (request) => {
    if (request.method === "DELETE") expect(p.journal.list()[0]?.replacementEtag).toBe('"copy"');
    return undefined;
  });
  await p.controller().recover();
  expect(p.send).toHaveBeenCalledWith({ kind: "delete", url: created.url, etag: '"copy"' });
  expect(p.resources.has(created.url)).toBe(false);
  expect(p.resources.get(original.url)?.etag).toBe('"foreign"');
  expect(p.journal.list()).toEqual([]);
});
it.each([
  { replacementEtag: '"copy"', actual: '"edited"', changed: false },
  { replacementEtag: null, actual: '"edited"', changed: true },
  { replacementEtag: undefined, actual: null, changed: false },
  { replacementEtag: undefined, actual: 'W/"weak"', changed: false },
  { replacementEtag: undefined, actual: "*", changed: false },
])("keeps a changed/unguarded replacement and warns after a master conflict: %j", async ({
  replacementEtag,
  actual,
  changed,
}) => {
  const p = await pod();
  await p.put(original.url, { ...data, name: "Remote" }, '"remote"');
  await p.put(created.url, changed ? { ...data, name: "Edited copy" } : data, actual);
  p.journal.put(intent(replacementEtag === undefined ? {} : { replacementEtag }));
  await p.controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  expect(p.resources.size).toBe(2);
  expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
  expect(p.journal.list()).toEqual([]);
});
it("compensates an unchanged replacement when the master disappeared", async () => {
  const p = await pod();
  p.resources.delete(original.url);
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  await p.controller().recover();
  expect(p.resources.size).toBe(0);
});
it.each([
  "update",
  "delete",
] as const)("recognizes an unacknowledged original %s without removing the replacement", async (kind) => {
  const p = await pod();
  await p.put(created.url, data);
  const change = kind === "update" ? original : { kind, url: original.url, etag: original.etag };
  if (kind === "update") await p.put(original.url, original.data);
  else p.resources.delete(original.url);
  p.journal.put(intent({ original: change, attemptingOriginal: true }));
  await p.controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  expect(p.resources.has(created.url)).toBe(true);
  expect(p.journal.list()).toEqual([]);
});
it("retries a failed second write on the next load", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  p.intercept(async (request) =>
    request.method === "PUT" ? new Response(null, { status: 500 }) : undefined,
  );
  await p.controller().recover();
  expect(p.journal.list()).toHaveLength(1);
  expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("reconnect"));
  p.intercept(async () => undefined);
  await p.controller().recover();
  expect(p.journal.list()).toEqual([]);
  expect((await p.io.loadEvent(original.url))?.data.name).toBe("Excepted");
});
it("retains unreadable or disallowed intents without touching pod data", async () => {
  const p = await pod();
  p.journal.put(intent());
  p.intercept(async () => new Response(null, { status: 403 }));
  await p.controller().recover();
  expect(p.journal.list()).toHaveLength(1);
  expect(p.send).not.toHaveBeenCalled();
  p.allowed.mockImplementation(() => {
    throw Error("removed calendar");
  });
  p.requests.length = 0;
  await p.controller().recover();
  expect(p.requests).toHaveLength(0);
});
it("resumes a prepared intent, but never recreates a replacement that was already confirmed", async () => {
  const p = await pod();
  p.journal.put(intent());
  await p.controller().recover();
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "update"]);
  expect(p.journal.list()).toEqual([]);
  const q = await pod();
  q.journal.put(intent({ replacementEtag: '"deleted-copy"' }));
  await q.controller().recover();
  expect(q.send).not.toHaveBeenCalled();
  expect(q.warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
});
it("keeps unrelated RDF at an occupied replacement URL even when known event fields match", async () => {
  const p = await pod();
  await p.put(created.url, data);
  (p.resources.get(created.url) as { turtle: string }).turtle +=
    '\n<urn:other> <urn:property> "foreign" .';
  p.journal.put(intent());
  await p.controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  expect(p.warn).toHaveBeenCalled();
});
it.each([404, 412, 500])("handles compensation DELETE status %s safely", async (status) => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  await p.put(original.url, { ...data, name: "Foreign" });
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  p.intercept(async (request) =>
    request.method === "DELETE" ? new Response(null, { status }) : undefined,
  );
  await p.controller().recover();
  expect(p.journal.list()).toHaveLength(status === 500 ? 1 : 0);
  if (status !== 404) expect(p.warn).toHaveBeenCalled();
});
it("clears a completed intent and an already compensated rollback without writes", async () => {
  const p = await pod();
  p.journal.put(intent({ done: true }));
  await p.controller().recover();
  expect(p.requests).toHaveLength(0);
  p.journal.put(intent({ rollback: true }));
  await p.controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  expect(p.journal.list()).toEqual([]);
});
it("reconciles a racing master conflict, including a concurrent identical completion", async () => {
  for (const same of [true, false]) {
    const p = await pod();
    await p.put(created.url, data, '"copy"');
    p.journal.put(intent({ replacementEtag: '"copy"' }));
    p.intercept(async (request) => {
      if (request.method === "PUT") {
        await p.put(original.url, same ? original.data : { ...data, name: "Remote" });
        return new Response(null, { status: 412 });
      }
      return undefined;
    });
    await p.controller().recover();
    expect(p.journal.list()).toEqual([]);
    expect(p.resources.has(created.url)).toBe(same);
  }
});
it("bounds reconciliation if a pod repeatedly rejects unchanged preconditions", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  p.intercept(async (request) =>
    request.method === "PUT" ? new Response(null, { status: 412 }) : undefined,
  );
  await p.controller().recover();
  expect(p.send).toHaveBeenCalledTimes(2);
  expect(p.journal.list()).toHaveLength(1);
});
it("serializes two tab recoveries and sends only one master update", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  const a = p.controller();
  const b = p.controller();
  await Promise.all([a.lock(() => a.recover()), b.lock(() => b.recover())]);
  expect(p.send).toHaveBeenCalledTimes(1);
});

it("runs a foreground compound through the outbox with a durable checkpoint before each write", async () => {
  const p = await pod();
  const replacement: SeriesReplacement = { current: undefined };
  p.intercept(async (request) => {
    if (request.method === "PUT") {
      const [record] = p.journal.list();
      expect(record?.original).toEqual(original);
      expect(record?.created).toEqual(created);
      expect(JSON.parse(p.storage.getItem(outboxKey(web)) as string).writes).toEqual([]);
      if (request.url === original.url) {
        expect(record?.replacementEtag).toBeTruthy();
        expect(record?.attemptingOriginal).toBe(true);
      }
    }
    return undefined;
  });
  const box = createEventOutbox(web, p.storage, p.send, vi.fn(), p.allowed, p.recovery);
  box.restore();
  expect(await box.compound?.(created, original, replacement)).toBe(true);
  expect(p.journal.list()).toEqual([]);
  expect(replacement.current).toBeUndefined();
  expect(p.send).toHaveBeenCalledTimes(2);
});
it("compensates foreground failures, preserves failed cleanup, and refuses another replacement until recovery", async () => {
  const p = await pod();
  p.intercept(async (request) =>
    (request.method === "PUT" && request.url === original.url) || request.method === "DELETE"
      ? new Response(null, { status: 500 })
      : undefined,
  );
  const replacement: SeriesReplacement = { current: undefined };
  const controller = p.controller();
  await expect(controller.run(created, original, replacement)).rejects.toThrow("500");
  expect(replacement.current).toMatchObject({ url: created.url, durable: true });
  expect(p.journal.list()[0]?.rollback).toBe(true);
  await expect(
    controller.run({ ...created, url: `${created.url}-another` }, original, replacement),
  ).rejects.toThrow("retry cleanup");
  expect(replacement.current?.url).toBe(created.url);
  p.intercept(async () => undefined);
  await controller.recover();
  expect(p.journal.list()).toEqual([]);
  expect(p.resources.has(created.url)).toBe(false);
});
it("reconciles a lost second response instead of compensating a completed foreground edit", async () => {
  const p = await pod();
  p.intercept(async (request) => {
    if (request.method === "PUT" && request.url === original.url) {
      await p.put(original.url, original.data);
      throw new TypeError("response lost");
    }
    return undefined;
  });
  const replacement: SeriesReplacement = { current: undefined };
  await expect(p.controller().run(created, original, replacement)).rejects.toThrow("response lost");
  expect(p.resources.has(created.url)).toBe(true);
  expect(p.journal.list()).toEqual([]);
  expect(replacement.current).toBeUndefined();
});
it("falls back to the original in-memory compound flow when journal storage is blocked", async () => {
  const p = await pod();
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw Error("blocked");
    },
  };
  const box = createEventOutbox(web, storage, p.send, vi.fn(), p.allowed, p.recovery);
  const replacement: SeriesReplacement = { current: undefined };
  await applySeriesPlan({
    plan: { created: data, original: original.data },
    source: { url: original.url, etag: original.etag, data },
    mode: "this",
    target: {
      url: `${root}calendar/work.ttl`,
      container: `${root}calendar/work/`,
      title: "Work",
      colour: "",
      etag: null,
    },
    mutations: {
      compound: box.compound,
      resolve: box.resolve,
      create: (url, event, confirm) => box.save({ kind: "create", url, data: event }, confirm),
      update: (url, event, etag, confirm) =>
        box.save({ kind: "update", url, data: event, etag }, confirm),
      delete: (url, etag, confirm) => box.save({ kind: "delete", url, etag }, confirm),
    },
    replacement,
  });
  expect(p.send).toHaveBeenCalledTimes(2);
  expect(replacement.current).toBeUndefined();
});

it("compensates an acknowledged create whose ETag was omitted, and retains network failures for recovery", async () => {
  const p = await pod();
  const send = async (write: EventWrite) => {
    const result = await p.send(write);
    return write.kind === "create" ? null : result;
  };
  const controller = createSeriesIntents(web, p.storage, send, p.allowed, p.recovery);
  const replacement: SeriesReplacement = { current: undefined };
  await expect(controller.run(created, original, replacement)).rejects.toThrow("Reload");
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "delete"]);
  expect(p.journal.list()).toEqual([]);
  expect(replacement.current).toBeUndefined();
  p.journal.put(intent({ rollback: true, replacementEtag: null }));
  await p.put(created.url, data);
  p.intercept(async (request) => {
    if (request.method === "DELETE") throw new TypeError("network unavailable");
    return undefined;
  });
  await controller.recover();
  expect(p.journal.list()).toHaveLength(1);
  expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("reconnect"));
});
it("compensates an unacknowledged create, including when the first write never landed", async () => {
  for (const landed of [true, false]) {
    const p = await pod();
    p.intercept(async (request) => {
      if (request.method === "PUT") {
        if (landed) await p.put(created.url, data);
        throw new TypeError("response lost");
      }
      return undefined;
    });
    const replacement: SeriesReplacement = { current: undefined };
    await expect(p.controller().run(created, original, replacement)).rejects.toThrow(
      "response lost",
    );
    expect(p.resources.has(created.url)).toBe(false);
    expect(p.journal.list()).toEqual([]);
  }
});
it("recovers an unacknowledged create with no returned ETag using full RDF", async () => {
  const p = await pod();
  p.journal.put(intent());
  const send = async (write: EventWrite) => {
    const result = await p.send(write);
    return write.kind === "create" ? null : result;
  };
  await createSeriesIntents(web, p.storage, send, p.allowed, p.recovery).recover();
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "update"]);
  expect(p.journal.list()).toEqual([]);
});
it("keeps missing, weak or changed replacements rather than updating an unchanged master", async () => {
  for (const state of ["missing", "weak", "changed"]) {
    const p = await pod();
    p.journal.put(intent(state === "changed" ? { replacementEtag: '"before"' } : {}));
    if (state === "missing") {
      p.intercept(async (request) =>
        request.method === "PUT" ? new Response(null, { status: 201 }) : undefined,
      );
    } else {
      await p.put(created.url, data, state === "weak" ? null : '"after"');
    }
    await p.controller().recover();
    expect(p.send.mock.calls.filter(([write]) => write.url === original.url)).toEqual([]);
    expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
    expect(p.journal.list()).toEqual([]);
  }
});
it("preserves unknown-ETag pending operations and blocks a new edit touching the same master", async () => {
  const p = await pod();
  p.journal.put(intent());
  const replacement: SeriesReplacement = { current: undefined };
  await expect(p.controller().run(created, original, replacement)).rejects.toThrow("retry cleanup");
  expect(replacement.current?.etag).toBeNull();
  expect(p.send).not.toHaveBeenCalled();
});
it("compensates a disappeared master even after an unacknowledged attempted update", async () => {
  const p = await pod();
  p.resources.delete(original.url);
  await p.put(created.url, data);
  p.journal.put(intent({ attemptingOriginal: true }));
  await p.controller().recover();
  expect(p.resources.size).toBe(0);
});
