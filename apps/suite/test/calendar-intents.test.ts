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
import { createEventOutbox, outboxKey } from "../src/apps/calendar/state/outbox";
import type { EventWrite } from "../src/apps/calendar/state/repository";
import { MemoryIntentStorage } from "./contacts-support";

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
function store() {
  return new MemoryIntentStorage();
}
function intent(patch: Partial<SeriesIntent> = {}): SeriesIntent {
  return {
    v: 1,
    id: "operation",
    startedAt: "2026-11-01",
    webId: web,
    storageUrl: root,
    operation: { mode: "following", action: "edit" },
    created,
    original,
    ...patch,
  };
}
afterEach(() => vi.unstubAllGlobals());

it("journals full account-scoped plans, checkpoints and clears, reviving model dates", () => {
  const storage = store();
  const journal = new SeriesJournal(web, root, vi.fn(), () => storage);
  expect(journal.list()).toEqual([]);
  const record = intent();
  journal.put(record);
  const next = new SeriesJournal(web, root, vi.fn(), () => storage);
  expect(next.list()).toEqual([record]);
  expect(next.list()[0]?.created.data.start).toBeInstanceOf(Date);
  expect(new SeriesJournal("other", root, vi.fn(), () => storage).list()).toEqual([]);
  record.replacementEtag = '"copy"';
  record.attemptingOriginal = true;
  next.put(record);
  expect(journal.list()).toEqual([record]);
  const second = intent({ id: "second", created: { ...created, url: `${created.url}-other` } });
  journal.put(second);
  next.remove(record);
  expect(journal.list()).toEqual([second]);
  next.remove(second);
  expect(journal.list()).toEqual([]);
});
it("refuses corrupt, foreign and invalid recovery records without discarding them", () => {
  for (const record of [
    null,
    { ...intent(), v: 2 },
    { ...intent(), webId: "other" },
    { ...intent(), storageUrl: "https://other.example/" },
    { ...intent(), id: 5 },
    { ...intent(), id: "" },
    { ...intent(), startedAt: 5 },
    { ...intent(), operation: { mode: "bad", action: "edit" } },
    { ...intent(), operation: { mode: "this", action: "bad" } },
    { ...intent(), created: original },
    { ...intent(), original: created },
    { ...intent(), original: { ...original, url: created.url } },
    { ...intent(), created: { ...created, data: { ...data, start: "bad" } } },
    { ...intent(), attemptingOriginal: "yes" },
    { ...intent(), rollback: 1 },
    { ...intent(), done: "yes" },
    { ...intent(), replacementEtag: 1 },
  ]) {
    const storage = store();
    const key = `${intentsKey(web, root)}operation`;
    storage.setItem(key, JSON.stringify(record));
    expect(() => new SeriesJournal(web, root, vi.fn(), () => storage).list()).toThrow();
    expect(storage.getItem(key)).toBe(JSON.stringify(record));
  }
});
it("isolates pods for the same account and validates the account inside each record", () => {
  const storage = store();
  const journal = new SeriesJournal(web, root, vi.fn(), () => storage);
  journal.put(intent());
  expect(new SeriesJournal(web, `${root}other/`, vi.fn(), () => storage).list()).toEqual([]);
});
it.each([
  "get",
  "set",
])("shares volatile recovery across remounts when storage %s fails", (failure) => {
  const storage = store();
  const account = `${web}-${failure}`;
  const warn = vi.fn();
  vi.spyOn(storage, failure === "get" ? "getItem" : "setItem").mockImplementation(() => {
    throw Error("blocked");
  });
  // Seed one key so list exercises getItem too.
  if (failure === "get")
    storage.setItem(
      `${intentsKey(account, root)}operation`,
      JSON.stringify(intent({ webId: account })),
    );
  const journal = new SeriesJournal(account, root, warn, () => storage);
  const record = intent({ webId: account });
  journal.put(record);
  expect(journal.list()).toEqual([record]);
  const remounted = new SeriesJournal(account, root, vi.fn(), () => storage);
  expect(remounted.list()).toEqual([record]);
  remounted.remove(record);
  expect(journal.list()).toEqual([]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("lost on reload"));
});
it("serializes local callers and tabs, releases failed locks, and supports browsers without Web Locks", async () => {
  const a = new SeriesJournal(web, root, vi.fn(), store);
  const b = new SeriesJournal(web, root, vi.fn(), store);
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
  const notice = vi.fn();
  const recovery = { fetch, storageUrl: root, warn, notice, journalStorage: () => storage };
  const controller = () => createSeriesIntents(web, send, allowed, recovery);
  return {
    resources,
    put,
    requests,
    io,
    send,
    storage,
    warn,
    notice,
    allowed,
    recovery,
    controller,
    intercept: (callback: typeof intercept) => {
      intercept = callback;
    },
    journal: new SeriesJournal(web, root, vi.fn(), () => storage),
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
  await Promise.all([a.recover(), b.recover()]);
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
it("keeps compound ownership in the shared memory journal when storage is blocked", async () => {
  const p = await pod();
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw Error("blocked");
    },
  };
  const box = createEventOutbox(`${web}-blocked`, storage, p.send, vi.fn(), p.allowed, {
    ...p.recovery,
    journalStorage: () => {
      throw Error("blocked");
    },
  });
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
  const controller = createSeriesIntents(web, send, p.allowed, p.recovery);
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
  await createSeriesIntents(web, send, p.allowed, p.recovery).recover();
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

it("keeps offline recovery pending across reloads, then finishes once and reports recovery", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  p.intercept(async () => {
    throw new TypeError("offline");
  });
  await p.controller().recover();
  expect(p.journal.list()).toHaveLength(1);
  expect(p.send).not.toHaveBeenCalled();
  expect(p.notice).not.toHaveBeenCalled();
  p.intercept(async () => undefined);
  await Promise.all([p.controller().recover(), p.controller().recover()]);
  expect(p.send).toHaveBeenCalledExactlyOnceWith(original);
  expect(p.notice).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("recovered"));
  expect(p.journal.list()).toEqual([]);
});
it("replays the actual persisted foreground checkpoint after a crash between writes", async () => {
  const p = await pod();
  const replacement: SeriesReplacement = { current: undefined };
  let crash!: () => void;
  const crashed = new Promise<void>((resolve) => {
    crash = resolve;
  });
  // Simulate termination: the old execution never resumes, including its compensation.
  const send = async (write: EventWrite) => {
    if (write.kind === "update") {
      crash();
      return new Promise<never>(() => {});
    }
    return p.send(write);
  };
  void createSeriesIntents(web, send, p.allowed, p.recovery).run(created, original, replacement, {
    mode: "following",
    action: "edit",
  });
  await crashed;
  const [record] = p.journal.list();
  expect(record).toMatchObject({
    operation: { mode: "following", action: "edit" },
    attemptingOriginal: true,
    replacementEtag: expect.any(String),
  });
  await p.controller().recover();
  expect((await p.io.loadEvent(original.url))?.data.name).toBe("Excepted");
  expect(p.resources.has(created.url)).toBe(true);
  expect(p.journal.list()).toEqual([]);
  await p.controller().recover();
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "update"]);
});
it("warns about corrupt recovery, leaves it in storage and prevents outbox replay", async () => {
  const p = await pod();
  const key = `${intentsKey(web, root)}corrupt`;
  p.storage.setItem(key, "{");
  p.storage.setItem(outboxKey(web), JSON.stringify({ v: 1, webId: web, writes: [created] }));
  const box = createEventOutbox(web, p.storage, p.send, vi.fn(), p.allowed, p.recovery);
  await box.flush();
  expect(p.storage.getItem(key)).toBe("{");
  expect(p.send).not.toHaveBeenCalled();
  expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("needs attention"));
  expect(JSON.parse(p.storage.getItem(outboxKey(web)) as string).writes).toEqual([
    JSON.parse(JSON.stringify(created)),
  ]);
});
it("keeps journal steps out of the ordinary outbox and refuses overlapping edits while recovery is offline", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  p.intercept(async () => {
    throw new TypeError("offline");
  });
  const changed = vi.fn();
  const box = createEventOutbox(web, p.storage, p.send, changed, p.allowed, p.recovery);
  for (const write of [original, { kind: "delete", url: created.url, etag: '"copy"' } as const])
    await expect(box.save(write)).rejects.toThrow("unfinished calendar edit");
  const unrelated = { ...created, url: `${root}calendar/work/unrelated.ttl` };
  await box.save(unrelated);
  expect(p.send).not.toHaveBeenCalled();
  expect(JSON.parse(p.storage.getItem(outboxKey(web)) as string).writes).toHaveLength(1);
  p.intercept(async () => undefined);
  await box.flush();
  expect(p.send.mock.calls.map(([write]) => write.url)).toEqual([original.url, unrelated.url]);
  expect(p.journal.list()).toEqual([]);
  expect(changed).toHaveBeenLastCalledWith([], false);
});
it("refuses a compound write while its master still has an offline prerequisite", async () => {
  const p = await pod();
  p.storage.setItem(outboxKey(web), JSON.stringify({ v: 1, webId: web, writes: [original] }));
  const send = vi.fn(async () => {
    throw new TypeError("Calendar network unavailable");
  });
  const box = createEventOutbox(web, p.storage, send, vi.fn(), p.allowed, p.recovery);
  await expect(box.compound?.(created, original, { current: undefined })).rejects.toThrow(
    "Reconnect",
  );
  expect(send).toHaveBeenCalledExactlyOnceWith(original);
  expect(p.journal.list()).toEqual([]);
});

it("coordinates concurrent foreground compounds for distinct masters without starting duplicate recovery", async () => {
  const p = await pod();
  const otherOriginal = { ...original, url: `${root}calendar/work/other-master.ttl` };
  const otherCreated = {
    ...created,
    url: `${root}calendar/work/other-copy.ttl`,
    data: { ...data, uid: "other-copy" },
  };
  await p.put(otherOriginal.url, { ...data, name: "Other master" }, otherOriginal.etag);
  const box = createEventOutbox(web, p.storage, p.send, vi.fn(), p.allowed, p.recovery);
  expect(
    await Promise.all([
      box.compound?.(created, original, { current: undefined }),
      box.compound?.(otherCreated, otherOriginal, { current: undefined }),
    ]),
  ).toEqual([true, true]);
  expect(p.send).toHaveBeenCalledTimes(4);
  expect(p.journal.list()).toEqual([]);
});

it("never compensates an occupied destination after a definite create rejection", async () => {
  const p = await pod();
  await p.put(created.url, data, '"existing"');
  await expect(p.controller().run(created, original, { current: undefined })).rejects.toThrow(
    "412",
  );
  expect(p.send).toHaveBeenCalledExactlyOnceWith(created);
  expect(p.resources.get(created.url)?.etag).toBe('"existing"');
  expect(p.resources.get(original.url)?.etag).toBe(original.etag);
  expect(p.journal.list()).toEqual([]);
  expect(p.warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
});

it("compensates the confirmed replacement when the foreground master write loses a race", async () => {
  const p = await pod();
  p.intercept(async (request) => {
    if (request.method === "PUT" && request.url === original.url) {
      await p.put(original.url, { ...data, name: "Remote master" }, '"remote"');
      return new Response(null, { status: 412 });
    }
    return undefined;
  });
  await expect(p.controller().run(created, original, { current: undefined })).rejects.toThrow(
    "412",
  );
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "update", "delete"]);
  expect(p.resources.has(created.url)).toBe(false);
  expect(p.resources.get(original.url)?.etag).toBe('"remote"');
  expect(p.journal.list()).toEqual([]);
});

it("does not create a second replacement when flushing recovery completes the stale editor plan", async () => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  p.journal.put(intent({ replacementEtag: '"copy"' }));
  const box = createEventOutbox(web, p.storage, p.send, vi.fn(), p.allowed, p.recovery);
  const duplicate = {
    ...created,
    url: `${root}calendar/work/duplicate.ttl`,
    data: { ...data, uid: "duplicate" },
  };
  await expect(box.compound?.(duplicate, original, { current: undefined })).rejects.toThrow(
    "Reload this series",
  );
  expect(p.send).toHaveBeenCalledExactlyOnceWith(original);
  expect(p.resources.has(created.url)).toBe(true);
  expect(p.resources.has(duplicate.url)).toBe(false);
  expect(p.journal.list()).toEqual([]);
});
it("refuses a missing foreground master before creating or journaling a replacement", async () => {
  const p = await pod();
  p.resources.delete(original.url);
  await expect(p.controller().run(created, original, { current: undefined })).rejects.toThrow(
    "Reload this series",
  );
  expect(p.send).not.toHaveBeenCalled();
  expect(p.journal.list()).toEqual([]);
});

it("does not resurrect a completed intent and delete its committed replacement after storage fails", async () => {
  const p = await pod();
  const account = `${web}-completed`;
  let unavailable = false;
  const source = () => {
    if (unavailable) throw Error("storage unavailable");
    return p.storage;
  };
  const journal = new SeriesJournal(account, root, p.warn, source);
  const master = { ...original.data, recurrence: { frequency: "WEEKLY" as const, count: 3 } };
  const completed = {
    ...master,
    recurrence: { ...master.recurrence, exceptDate: [data.start] },
  };
  const saved = intent({
    webId: account,
    original: { ...original, data: completed },
    replacementEtag: '"copy"',
  });
  await p.put(original.url, master, original.etag);
  await p.put(created.url, data, '"copy"');
  journal.put(saved);
  expect(journal.list()).toEqual([saved]);
  // Another tab commits the master and removes the record, outside this module's memory.
  await p.put(original.url, completed, '"committed"');
  p.storage.removeItem(`${journal.prefix}${saved.id}`);
  expect(journal.list()).toEqual([]);
  unavailable = true;
  const recovery = createSeriesIntents(account, p.send, p.allowed, {
    ...p.recovery,
    journalStorage: source,
  });
  await recovery.recover();
  expect(p.send).not.toHaveBeenCalled();
  expect(p.resources.get(created.url)?.etag).toBe('"copy"');
  expect((await p.io.loadEvent(original.url))?.data).toMatchObject(completed);
  expect(journal.list()).toEqual([]);
});

it.each([
  false,
  true,
])("drains a save queued during a compound after it settles (failure: %s)", async (failed) => {
  const p = await pod();
  let entered!: () => void;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  p.intercept(async (request) => {
    if (request.method === "PUT" && request.url === original.url) {
      entered();
      await gate;
      if (failed) return new Response(null, { status: 500 });
    }
    return undefined;
  });
  const changed = vi.fn();
  const box = createEventOutbox(web, p.storage, p.send, changed, p.allowed, p.recovery);
  const compound = box.compound?.(created, original, { current: undefined });
  const checked = failed
    ? expect(compound).rejects.toThrow("500")
    : expect(compound).resolves.toBe(true);
  await waiting;
  const unrelated = { ...created, url: `${root}calendar/work/during-compound.ttl` };
  const saved = box.save(unrelated);
  const flushed = box.flush();
  expect(p.send).toHaveBeenCalledTimes(2);
  finish();
  await Promise.all([checked, saved, flushed]);
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(
    failed ? ["create", "update", "delete", "create"] : ["create", "update", "create"],
  );
  expect(p.send).toHaveBeenLastCalledWith(unrelated);
  expect(p.resources.has(unrelated.url)).toBe(true);
  expect(JSON.parse(p.storage.getItem(outboxKey(web)) as string).writes).toEqual([]);
  expect(changed).toHaveBeenLastCalledWith([], false);
});

const oldKey = (account = web) => `suite:calendar:intents:${account}`;
function legacy(p: Awaited<ReturnType<typeof pod>>, records: unknown[], account = web) {
  p.storage.setItem(oldKey(account), JSON.stringify({ v: 1, webId: account, intents: records }));
}
const oldIntent = (patch: Partial<SeriesIntent> = {}) => ({ created, original, ...patch });

it.each([
  false,
  true,
])("migrates legacy checkpoints durably before removing their envelope (recurrence: %s)", async (recurring) => {
  const p = await pod();
  const record = oldIntent({
    created: {
      ...created,
      data: { ...data, ...(recurring ? { recurrence: { frequency: "WEEKLY" as const } } : {}) },
    },
    replacementEtag: '"copy"',
    attemptingOriginal: true,
    rollback: false,
    done: true,
  });
  legacy(p, [record]);
  const remove = p.storage.removeItem.bind(p.storage);
  vi.spyOn(p.storage, "removeItem").mockImplementation((key) => {
    if (key === oldKey()) {
      expect(p.journal.list()).toMatchObject([
        {
          ...record,
          operation: { mode: recurring ? "following" : "this", action: "edit" },
        },
      ]);
      expect(p.journal.list()[0]?.created.data.start).toBeInstanceOf(Date);
    }
    remove(key);
  });
  await p.controller().recover();
  expect(p.storage.getItem(oldKey())).toBeNull();
  expect(p.journal.list()).toEqual([]);
  expect(p.send).not.toHaveBeenCalled();
});
it("resumes a prepared legacy operation and migrates it only once", async () => {
  const p = await pod();
  legacy(p, [oldIntent()]);
  await p.controller().recover();
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(["create", "update"]);
  expect(p.storage.getItem(oldKey())).toBeNull();
  await p.controller().recover();
  expect(p.send).toHaveBeenCalledTimes(2);
});
it.each([
  "attempted",
  "rollback",
])("preserves legacy %s checkpoints during replay", async (step) => {
  const p = await pod();
  await p.put(created.url, data, '"copy"');
  if (step === "attempted") await p.put(original.url, original.data, '"committed"');
  legacy(p, [
    oldIntent({
      replacementEtag: '"copy"',
      ...(step === "attempted" ? { attemptingOriginal: true } : { rollback: true }),
    }),
  ]);
  await p.controller().recover();
  expect(p.resources.has(created.url)).toBe(step === "attempted");
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual(
    step === "attempted" ? [] : ["delete"],
  );
});
it("drops corrupt or foreign legacy envelopes without any pod writes", async () => {
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ v: 2 }),
    JSON.stringify({ v: 1, webId: "foreign", intents: [oldIntent()] }),
    JSON.stringify({ v: 1, webId: web, intents: {} }),
    JSON.stringify({ v: 1, webId: web, intents: [] }),
  ]) {
    const p = await pod();
    p.storage.setItem(oldKey(), raw);
    await p.controller().recover();
    expect(p.storage.getItem(oldKey())).toBeNull();
    expect(p.journal.list()).toEqual([]);
    expect(p.send).not.toHaveBeenCalled();
  }
});
it("drops invalid legacy records, including mixed pod scope, without any pod writes", async () => {
  for (const record of [
    null,
    {},
    oldIntent({ created: original as never }),
    oldIntent({ original: created as never }),
    oldIntent({ original: { ...original, url: created.url } }),
    oldIntent({ original: { ...original, etag: 'W/"weak"' } }),
    oldIntent({ attemptingOriginal: 1 as never }),
    oldIntent({ replacementEtag: 1 as never }),
    ...[
      "relative",
      "file:///copy.ttl",
      "https://name@pod.example/calendar/work/copy.ttl",
      "https://:test-password@pod.example/calendar/work/copy.ttl",
      `${root}calendar/work/`,
      `${created.url}#it`,
      `${created.url}?query`,
      "https://foreign.example/copy.ttl",
    ].map((url) => oldIntent({ created: { ...created, url } })),
    oldIntent({ created: { ...created, data: { ...data, start: "invalid" } } }),
  ]) {
    const p = await pod();
    legacy(p, [record]);
    await p.controller().recover();
    expect(p.storage.getItem(oldKey())).toBeNull();
    expect(p.journal.list()).toEqual([]);
    expect(p.send).not.toHaveBeenCalled();
  }
});
it("retains valid legacy records for other pods and serializes their shared account handoff", async () => {
  const p = await pod();
  const otherRoot = "https://other.example/";
  const other = oldIntent({
    created: { ...created, url: `${otherRoot}calendar/copy.ttl` },
    original: { ...original, url: `${otherRoot}calendar/master.ttl` },
  });
  legacy(p, [oldIntent(), other, null]);
  await p.journal.migrateLegacy();
  expect(p.journal.list()).toHaveLength(1);
  expect(JSON.parse(p.storage.getItem(oldKey()) as string).intents).toEqual([
    JSON.parse(JSON.stringify(other)),
  ]);
  // A second inspection of an entirely foreign envelope does not rewrite it.
  const set = vi.spyOn(p.storage, "setItem");
  await p.journal.migrateLegacy();
  expect(set).not.toHaveBeenCalled();
  const nextPod = new SeriesJournal(web, otherRoot, p.warn, () => p.storage);
  await Promise.all([p.journal.migrateLegacy(), nextPod.migrateLegacy()]);
  expect(nextPod.list()).toHaveLength(1);
  expect(p.storage.getItem(oldKey())).toBeNull();
  expect(p.send).not.toHaveBeenCalled();
});
it("retains a legacy source and blocks replay across remounts when the durable copy fails", async () => {
  const p = await pod();
  const account = `${web}-migration-quota`;
  const journal = new SeriesJournal(account, root, p.warn, () => p.storage);
  const recovery = { ...p.recovery, journalStorage: () => p.storage };
  legacy(p, [oldIntent()], account);
  const set = p.storage.setItem.bind(p.storage);
  vi.spyOn(p.storage, "setItem").mockImplementation((key, value) => {
    if (key.startsWith(journal.prefix)) throw Error("quota");
    set(key, value);
  });
  await createSeriesIntents(account, p.send, p.allowed, recovery).recover();
  expect(p.storage.getItem(oldKey(account))).not.toBeNull();
  expect(journal.list()).toEqual([]);
  await createSeriesIntents(account, p.send, p.allowed, recovery).recover();
  expect(p.storage.getItem(oldKey(account))).not.toBeNull();
  expect(p.send).not.toHaveBeenCalled();
  // Explicitly retire the test fixture without leaving a failed handoff in shared memory.
  p.storage.removeItem(oldKey(account));
  await journal.migrateLegacy();
});
it("retries an interrupted legacy retirement without replacing a newer checkpoint", async () => {
  const p = await pod();
  const account = `${web}-migration-removal`;
  let unavailable = false;
  const source = () => {
    if (unavailable) throw Error("unavailable");
    return p.storage;
  };
  const recovery = { ...p.recovery, journalStorage: source };
  const controller = () => createSeriesIntents(account, p.send, p.allowed, recovery);
  const journal = new SeriesJournal(account, root, p.warn, source);
  legacy(p, [oldIntent({ replacementEtag: '"copy"' })], account);
  await p.put(created.url, data, '"copy"');
  const remove = p.storage.removeItem.bind(p.storage);
  const failed = vi.spyOn(p.storage, "removeItem").mockImplementation((key) => {
    if (key === oldKey(account)) throw Error("failed retirement");
    remove(key);
  });
  await controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  const [checkpoint] = journal.list();
  journal.put({ ...(checkpoint as SeriesIntent), attemptingOriginal: true });
  await p.put(original.url, original.data, '"committed"');
  unavailable = true;
  await controller().recover();
  expect(p.send).not.toHaveBeenCalled();
  unavailable = false;
  failed.mockRestore();
  await controller().recover();
  expect(p.resources.has(created.url)).toBe(true);
  expect(p.send).not.toHaveBeenCalled();
  expect(p.storage.getItem(oldKey(account))).toBeNull();
  expect(journal.list()).toEqual([]);
});

it("rejects a legacy operation split between two pods on the same origin", async () => {
  const p = await pod();
  legacy(p, [
    oldIntent({
      created: { ...created, url: `${root}one/calendar/copy.ttl` },
      original: { ...original, url: `${root}two/calendar/master.ttl` },
    }),
  ]);
  const journal = new SeriesJournal(web, `${root}one/`, p.warn, () => p.storage);
  await journal.migrateLegacy();
  expect(journal.list()).toEqual([]);
  expect(p.storage.getItem(oldKey())).toBeNull();
});

it("recovers failed compound cleanup before draining a save that joined the compound", async () => {
  const p = await pod();
  let entered!: () => void;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let cleanup = 0;
  const unrelated = {
    ...created,
    url: `${root}calendar/work/after-cleanup.ttl`,
    data: { ...data, uid: "unrelated" },
  };
  p.intercept(async (request) => {
    if (request.method === "PUT" && request.url === original.url) {
      entered();
      await gate;
      return new Response(null, { status: 500 });
    }
    if (request.method === "DELETE" && ++cleanup === 1) return new Response(null, { status: 500 });
    if (request.method === "PUT" && request.url === unrelated.url) {
      expect(p.journal.list()).toEqual([]);
      expect(p.resources.has(created.url)).toBe(false);
    }
    return undefined;
  });
  const box = createEventOutbox(web, p.storage, p.send, vi.fn(), p.allowed, p.recovery);
  const compound = expect(
    box.compound?.(created, original, { current: undefined }),
  ).rejects.toThrow("500");
  await waiting;
  const saved = box.save(unrelated);
  const flushed = box.flush();
  finish();
  await Promise.all([compound, saved, flushed]);
  expect(p.send.mock.calls.map(([write]) => write.kind)).toEqual([
    "create",
    "update",
    "delete",
    "delete",
    "create",
  ]);
  expect(p.resources.has(unrelated.url)).toBe(true);
});
