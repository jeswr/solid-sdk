// AUTHORED-BY Codex GPT-6.1-Sol
import { Blob } from "node:buffer";
import { ownerPolicy, policiesEqual, readWac, scopePolicy } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { act, createElement, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ensureOwnerOnly } from "./access.js";
import { createQueue, type RecordValue } from "./cache.js";
import {
  createPreferences,
  type PreferencesHook,
  type PreferencesSchema,
  type UsePreferencesResult,
} from "./index.js";
import {
  CONFIGURATION,
  createRemote,
  type PreferencesOptions,
  type PreferencesTypeIndex,
} from "./remote.js";
import { encode, PreferencesError, validateKey } from "./value.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rootUrl = "https://pod.example/";
const webId = `${rootUrl}card#me`;
const keyType = (key: string) => `https://jeswr.org/ns/suite/preferences/${key}`;
const suiteType = "https://jeswr.org/ns/suite/preferences";
const number: PreferencesSchema<number> = {
  parse(value) {
    if (typeof value !== "number") throw new Error("number");
    return value;
  },
};
const any: PreferencesSchema<unknown> = { parse: (value) => value };
const stores: PreferencesHook[] = [];
const roots: Root[] = [];
let connected = true;
class Channel {
  static all = new Set<Channel>();
  onmessage: ((event: MessageEvent<RecordValue>) => void) | null = null;
  constructor(readonly name: string) {
    Channel.all.add(this);
  }
  postMessage(data: RecordValue) {
    for (const other of Channel.all)
      if (other !== this) other.onmessage?.({ data } as MessageEvent<RecordValue>);
  }
  close() {
    Channel.all.delete(this);
  }
}
beforeEach(() => {
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", Channel);
  connected = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => connected);
});
afterEach(async () => {
  for (const root of roots) await act(() => root.unmount());
  roots.length = 0;
  for (const store of stores) store.dispose();
  stores.length = 0;
  Channel.all.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(protocol: "solid" | "lws" = "solid", preferencesFile = false) {
  const storage = createMemoryStorage({ protocol, root: rootUrl });
  let custom: string | undefined;
  if (preferencesFile)
    custom = (await storage.create(rootUrl, null, { kind: "container", name: "custom" })).url;
  const card = await storage.create(
    rootUrl,
    preferencesFile
      ? `<${webId}> <http://www.w3.org/ns/pim/space#preferencesFile> <${custom}prefs.ttl>.`
      : "",
    { name: "card", contentType: "text/turtle" },
  );
  const profile = await storage.readRdf(card.url);
  const registrations = new Set<string>();
  const typeIndex: PreferencesTypeIndex = {
    find: vi.fn(async () => {
      if (protocol === "solid") return [...registrations];
      const found: string[] = [];
      for await (const item of storage.listAll(rootUrl))
        if (item.types.includes(CONFIGURATION)) found.push(item.url);
      return found;
    }),
    register: vi.fn(async (_iri, location) => {
      if (protocol === "solid") {
        registrations.add(location.container);
        return undefined;
      }
      return { links: [{ rel: "type", target: CONFIGURATION }] };
    }),
  };
  const seal = vi.fn(async () => {});
  const options: PreferencesOptions = { storage, typeIndex, webId, profile, ensureOwnerOnly: seal };
  return { storage, typeIndex, seal, options, custom, registrations };
}
function make(options: PreferencesOptions) {
  const store = createPreferences(options);
  stores.push(store);
  return store;
}
async function mount<T>(
  store: PreferencesHook,
  key = "rail",
  schema: PreferencesSchema<T> = number as PreferencesSchema<T>,
  fallback: T = 0 as T,
  strict = false,
) {
  let current!: UsePreferencesResult<T>;
  let selected = store;
  let selectedKey = key;
  function Probe() {
    current = selected(selectedKey, schema, fallback);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const render = () =>
    root.render(
      strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe),
    );
  await act(render);
  return {
    get current() {
      return current;
    },
    async ready() {
      await act(async () => {
        await vi.waitFor(() => expect(current.loading).toBe(false));
      });
    },
    async change(next: PreferencesHook, nextKey = key) {
      selected = next;
      selectedKey = nextKey;
      await act(render);
    },
    async unmount() {
      await act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}
function record(key = "rail", patch: Partial<RecordValue> = {}): RecordValue {
  return {
    v: 1,
    webId,
    root: rootUrl,
    key,
    json: "1",
    pending: true,
    order: Date.now(),
    token: crypto.randomUUID(),
    ...patch,
  };
}
const conflict = () =>
  new StorageError("precondition-failed", { url: rootUrl, method: "PUT", status: 412 });
async function keyUrl(storage: StorageClient, key = "rail") {
  for await (const parent of storage.listAll(rootUrl)) {
    if (parent.kind !== "container") continue;
    for await (const suite of storage.listAll(parent.url)) {
      if (suite.kind !== "container") continue;
      for await (const item of storage.listAll(suite.url)) {
        if (item.url.endsWith(`${key}.json`) || item.types.includes(keyType(key))) return item.url;
      }
    }
  }
  throw new Error("missing key");
}

test.each([
  "solid",
  "lws",
] as const)("typed JSON round-trip on %s, discovery and one owner-only provision", async (protocol) => {
  const f = await fixture(protocol);
  // Force the LWS server to ignore every Slug, including settings, suite and JSON names.
  if (protocol === "lws") {
    const create = f.storage.create;
    vi.spyOn(f.storage, "create").mockImplementation((url, body, options) =>
      create(url, body, { ...options, name: `server-${crypto.randomUUID()}` }),
    );
  }
  const blob = { open: false, folders: ["a", "b"], nested: { count: 2 } };
  const schema = {
    parse(value: unknown) {
      if (!value || typeof value !== "object") throw Error();
      return value as typeof blob;
    },
  };
  const store = make(f.options);
  const view = await mount(store, "docs.starred", schema, blob, true);
  await view.ready();
  await act(async () => view.current.set({ ...blob, open: true }));
  expect(view.current).toMatchObject({
    value: { ...blob, open: true },
    pending: false,
    error: undefined,
  });
  const url = await keyUrl(f.storage, "docs.starred");
  expect(JSON.parse(await (await f.storage.read(url)).text())).toEqual({ ...blob, open: true });
  expect((await f.storage.read(url)).contentType).toBe("application/json");
  expect(f.seal).toHaveBeenCalledTimes(1);
  expect(f.typeIndex.register).toHaveBeenLastCalledWith(CONFIGURATION, {
    container: expect.any(String),
  });
  if (protocol === "solid") expect(url).toBe(`${rootUrl}settings/suite/docs.starred.json`);
  await view.unmount();
  store.dispose();
  const restarted = await mount(make(f.options), "docs.starred", schema, blob);
  await restarted.ready();
  expect(restarted.current.value.open).toBe(true);
  expect(f.typeIndex.find).toHaveBeenCalledTimes(2);
});

test.each([
  "solid",
  "lws",
] as const)("pim:preferencesFile takes priority on %s", async (protocol) => {
  const f = await fixture(protocol, true);
  const view = await mount(make(f.options));
  await view.ready();
  await act(async () => view.current.set(3));
  expect(await keyUrl(f.storage)).toContain(`${f.custom}suite/`);
  expect(f.typeIndex.find).not.toHaveBeenCalled();
  expect(f.typeIndex.register).not.toHaveBeenCalled();
});

test("412 re-reads and retries with the new ETag; a second 412 preserves durable pending", async () => {
  const f = await fixture();
  const store = make(f.options);
  const view = await mount(store);
  await view.ready();
  await act(async () => view.current.set(1));
  const url = await keyUrl(f.storage);
  const old = (await f.storage.head(url)).etag as string;
  const external = await f.storage.write(url, "4", {
    ifMatch: old,
    contentType: "application/json",
  });
  const write = vi.spyOn(f.storage, "write");
  await act(async () => view.current.set((value) => value + 1));
  expect(view.current.value).toBe(2);
  expect(write.mock.calls.map((args) => args[2].ifMatch)).toEqual([old, external.etag]);
  write.mockRejectedValue(conflict());
  await act(async () => view.current.set(9));
  expect(view.current).toMatchObject({
    value: 9,
    pending: true,
    error: { code: "precondition-failed" },
  });
  expect((await createQueue(webId, rootUrl).list())[0]).toMatchObject({ json: "9", pending: true });
  write.mockRestore();
  await act(() => store.flush());
  expect(view.current.pending).toBe(false);
  expect(await (await f.storage.read(url)).text()).toBe("9");
});

test("one write in flight per key; last local value survives concurrent sets", async () => {
  const f = await fixture();
  const view = await mount(make(f.options));
  await view.ready();
  await act(() => view.current.set(0));
  const original = f.storage.write;
  const gate = defer<void>();
  const write = vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => {
    await gate.promise;
    return original(...args);
  });
  let first!: Promise<void>;
  let second!: Promise<void>;
  let third!: Promise<void>;
  await act(async () => {
    first = view.current.set(1);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
  await act(async () => {
    second = view.current.set((n) => n + 1);
    third = view.current.set((n) => n + 1);
  });
  expect(view.current.value).toBe(3);
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => {
    gate.resolve();
    await Promise.all([first, second, third]);
  });
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls.map((args) => args[1])).toEqual(["1", "3"]);
  expect(view.current.pending).toBe(false);
});

test("two tabs share updates, ignore other accounts and malformed messages, and fence account replacement", async () => {
  const f = await fixture();
  const a = await mount(make(f.options));
  const b = await mount(make(f.options));
  await a.ready();
  await b.ready();
  await act(() => a.current.set(8));
  expect(b.current.value).toBe(8);
  const channel = new Channel("suite-prefs");
  const bad = [
    null,
    {},
    { ...record(), webId: "https://other.example/#me" },
    { ...record(), root: "https://elsewhere.example/" },
    { ...record(), v: 2 },
    { ...record(), key: 9 },
    { ...record(), json: 1 },
    { ...record(), pending: 1 },
    { ...record(), order: NaN },
    { ...record(), order: -1 },
    { ...record(), token: 2 },
    { ...record(), token: "" },
    record("../evil"),
    record("rail", { json: "not-json" }),
    record("rail", { json: JSON.stringify("x".repeat(65_536)) }),
    record("rail", { order: 0, json: "20" }),
  ];
  await act(async () => {
    for (const value of bad) channel.postMessage(value as RecordValue);
  });
  expect(b.current.value).toBe(8);
  const stale = b.current.set;
  connected = false;
  const other = make({ ...f.options, webId: "https://other.example/#me" });
  await b.change(other);
  expect(b.current.value).toBe(0);
  await b.ready();
  await expect(stale(1)).rejects.toMatchObject({ code: "session-changed" });
  await act(async () => channel.postMessage(record("rail", { json: "10" })));
  expect(b.current.value).toBe(0);
});

test("offline sets persist latest per key, replay ordered on online and across restart without mounted keys", async () => {
  const f = await fixture();
  connected = false;
  const store = make(f.options);
  const rail = await mount(store);
  const density = await mount(store, "density");
  await rail.ready();
  await density.ready();
  await act(() => rail.current.set(1));
  await act(() => density.current.set(2));
  await act(() => rail.current.set(3));
  expect(rail.current.pending).toBe(true);
  const rows = await createQueue(webId, rootUrl).list();
  expect(rows).toHaveLength(2);
  const create = vi.spyOn(f.storage, "create");
  connected = true;
  await act(async () => {
    globalThis.dispatchEvent(new Event("online"));
    await store.flush();
  });
  expect(
    create.mock.calls
      .filter((args) => args[2]?.contentType === "application/json")
      .map((args) => args[1]),
  ).toEqual(["2", "3"]);
  expect(rail.current.pending).toBe(false);
  connected = false;
  await act(() => rail.current.set(4));
  await rail.unmount();
  await density.unmount();
  store.dispose();
  const restarted = make(f.options);
  const hydrated = await mount(restarted);
  await hydrated.ready();
  expect(hydrated.current).toMatchObject({ value: 4, pending: true });
  connected = true;
  await act(() => restarted.flush());
  expect(hydrated.current.pending).toBe(false);
  expect(await (await f.storage.read(await keyUrl(f.storage))).text()).toBe("4");
  await hydrated.unmount();
  restarted.dispose();
  connected = false;
  const offlineCache = await mount(make(f.options));
  await offlineCache.ready();
  expect(offlineCache.current.value).toBe(4);
});

test("schema/JSON failures fall back and warn once per key; invalid sets and keys fail before I/O", async () => {
  const f = await fixture();
  const remote = createRemote(f.options, new AbortController().signal);
  await remote.put("rail", '"bad"');
  await remote.put("density", "broken-json");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const store = make(f.options);
  const a = await mount(store);
  const b = await mount(store, "density");
  await a.ready();
  await b.ready();
  expect(a.current.value).toBe(0);
  expect(b.current.value).toBe(0);
  await a.change(store);
  expect(warn).toHaveBeenCalledTimes(2);
  await expect(a.current.set("bad" as unknown as number)).rejects.toThrow("number");
  expect(a.current.pending).toBe(false);
  for (const key of ["", "A", "../x", "a/b", "rail?x", "x#y", "a".repeat(65), " a", "-x"])
    expect(() => validateKey(key)).toThrow(PreferencesError);
  for (const key of [
    "rail",
    "density",
    "onboarding",
    "recentsearches",
    "drive",
    "docs.starred",
    "docs.shared",
    "tasks",
    "notes.pinned",
    "connectors",
    "permissions.view",
    "a".repeat(64),
  ])
    validateKey(key);
  const circular: unknown[] = [];
  circular.push(circular);
  for (const value of [
    undefined,
    () => {},
    Symbol(),
    NaN,
    Infinity,
    1n,
    new Date(),
    new Set(),
    { x: undefined },
    circular,
  ])
    expect(() => encode(value)).toThrowError(expect.objectContaining({ code: "invalid-json" }));
  expect(encode(null)).toBe("null");
  expect(encode(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  expect(encode("x".repeat(65_534))).toHaveLength(65_536);
  const large = await mount(store, "large", any, null);
  await large.ready();
  await expect(large.current.set("é".repeat(32_768))).rejects.toMatchObject({ code: "too-large" });
});

test("no IndexedDB/BroadcastChannel degrades to memory and supports explicit replay without navigator", async () => {
  vi.stubGlobal("indexedDB", undefined);
  vi.stubGlobal("BroadcastChannel", undefined);
  const q = createQueue(webId, rootUrl);
  const row = record();
  await q.acknowledge(row);
  await q.put(row);
  await q.acknowledge({ ...row, token: "other" });
  expect((await q.list())[0]?.pending).toBe(true);
  await q.acknowledge(row);
  expect((await q.list())[0]?.pending).toBe(false);
  const f = await fixture();
  const store = make(f.options);
  const view = await mount(store);
  await view.ready();
  vi.stubGlobal("navigator", undefined);
  await act(() => view.current.set(1));
  expect(view.current.pending).toBe(false);
  await view.unmount();
  await expect(view.current.set(2)).rejects.toMatchObject({ code: "session-changed" });
  store.dispose();
  expect(() => store.flush()).toThrow(PreferencesError);
});

test("WAC provisioning creates an owner-only ACL once, updates with its ETag, and fails closed", async () => {
  const f = await fixture();
  const storage = f.storage;
  const container = (await storage.create(rootUrl, null, { name: "private", kind: "container" }))
    .url;
  const acl = `${container}.acl`;
  const signal = new AbortController().signal;
  const head = storage.head;
  vi.spyOn(storage, "head").mockImplementation(async (...args) => {
    const result = await head(...args);
    if (args[0] === container) result.links = new Map([["acl", [{ target: acl, params: {} }]]]);
    return result;
  });
  await expect(ensureOwnerOnly(storage, container, webId, signal)).rejects.toMatchObject({
    code: "unsupported-access",
  });
  storage.features.accessControl = {
    state: "available",
    evidence: "test",
    detail: { model: "acp" },
  };
  await expect(ensureOwnerOnly(storage, container, webId, signal)).rejects.toMatchObject({
    code: "unsupported-access",
  });
  storage.features.accessControl = {
    state: "available",
    evidence: "test",
    detail: { model: "wac" },
  };
  await ensureOwnerOnly(storage, container, webId, signal);
  const created = readWac((await storage.readRdf(acl)).dataset, container, acl);
  for (const scope of ["resource", "members"] as const)
    expect(
      policiesEqual(scopePolicy(created, scope), scopePolicy(ownerPolicy(webId, true), scope)),
    ).toBe(true);
  const create = vi.spyOn(storage, "create");
  const write = vi.spyOn(storage, "write");
  await ensureOwnerOnly(storage, container, webId, signal);
  expect(create).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  // An ACL the owner changed (e.g. shared their settings) is never rewritten. AUTHORED-BY Claude Opus 5.5
  const old = (await storage.head(acl)).etag as string;
  await storage.write(acl, "", { ifMatch: old, contentType: "text/turtle" });
  write.mockClear();
  await ensureOwnerOnly(storage, container, webId, signal);
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(await (await storage.read(acl)).text()).toBe("");
  const h = vi.spyOn(storage, "head");
  const linked = h.getMockImplementation() as typeof head;
  for (const failure of [
    new Error("offline"),
    new StorageError("forbidden", { method: "HEAD", url: acl }),
  ]) {
    h.mockImplementationOnce(linked).mockRejectedValueOnce(failure);
    await expect(ensureOwnerOnly(storage, container, webId, signal)).rejects.toBe(failure);
  }
  for (const links of [undefined, [], [{ target: acl }, { target: acl }]]) {
    h.mockResolvedValueOnce({
      ...(await head(container)),
      links: new Map(links === undefined ? [] : [["acl", links]]),
    } as never);
    await expect(ensureOwnerOnly(storage, container, webId, signal)).rejects.toMatchObject({
      code: "unsupported-access",
    });
  }
  for (const target of ["https://foreign.example/acl", `${acl}?query`, `${acl}#fragment`]) {
    h.mockResolvedValueOnce({
      ...(await head(container)),
      links: new Map([["acl", [{ target, params: {} }]]]),
    });
    await expect(ensureOwnerOnly(storage, container, webId, signal)).rejects.toMatchObject({
      code: "unsafe-location",
    });
  }
  for (const stage of ["exists", "missing"] as const) {
    const controller = new AbortController();
    h.mockImplementationOnce(linked).mockImplementationOnce(async (url) => {
      const result = stage === "exists" ? await head(url) : undefined;
      controller.abort();
      if (!result) throw new StorageError("not-found", { method: "HEAD", url: acl });
      return result;
    });
    await expect(
      ensureOwnerOnly(storage, container, webId, controller.signal),
    ).rejects.toMatchObject({ code: "session-changed" });
  }
  const lws = await fixture("lws");
  await expect(ensureOwnerOnly(lws.storage, rootUrl, webId, signal)).rejects.toMatchObject({
    code: "unsupported-access",
  });
  // Exercise the public facade's default rather than an injected ACL fake.
  const opts = { ...f.options, ensureOwnerOnly: undefined };
  const remote = createRemote(opts, signal);
  // Supply the server's ACL Link on the newly-created suite too.
  h.mockImplementation(async (...args) => {
    const result = await head(...args);
    if (result.kind === "container")
      result.links = new Map([["acl", [{ target: `${args[0]}.acl`, params: {} }]]]);
    return result;
  });
  await remote.put("rail", "1");
});

test("discovery refuses unsafe/ambiguous pointers and locations; LWS can start without an RDF profile", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const noProfile = { ...f.options, profile: undefined };
  expect(await createRemote(noProfile, signal).read("rail")).toBeUndefined();
  const lws = await fixture("lws");
  expect(
    await createRemote({ ...lws.options, profile: undefined }, signal).read("rail"),
  ).toBeUndefined();
  const rdf = async (body: string) =>
    f.storage.readRdf(
      (
        await f.storage.create(rootUrl, body, {
          name: crypto.randomUUID(),
          contentType: "text/turtle",
        })
      ).url,
    );
  for (const body of [
    `<${webId}> <http://www.w3.org/ns/pim/space#preferencesFile> <https://foreign.example/prefs>.`,
    `<${webId}> <http://www.w3.org/ns/pim/space#preferencesFile> "literal".`,
    `<${webId}> <http://www.w3.org/ns/pim/space#preferencesFile> <${rootUrl}a>, <${rootUrl}b>.`,
  ]) {
    const profile = await rdf(body);
    await expect(
      createRemote({ ...f.options, profile }, signal).read("rail"),
    ).rejects.toMatchObject({ code: "unsafe-location" });
  }
  vi.mocked(f.typeIndex.find).mockResolvedValueOnce([rootUrl, rootUrl]);
  await expect(createRemote(f.options, signal).read("rail")).rejects.toMatchObject({
    code: "unsafe-location",
  });
  vi.spyOn(f.storage, "isWithinStorage").mockReturnValue(true);
  for (const url of [
    `${rootUrl}settings/?x`,
    `${rootUrl}settings/#x`,
    "https://user@pod.example/settings/",
    "https://:pass@pod.example/settings/",
  ]) {
    vi.mocked(f.typeIndex.find).mockResolvedValueOnce([url]);
    await expect(createRemote(f.options, signal).read("rail")).rejects.toMatchObject({
      code: "unsafe-location",
    });
  }
  const duplicate = await fixture("lws");
  const parent = (
    await duplicate.storage.create(rootUrl, null, {
      kind: "container",
      name: "settings",
      links: [{ rel: "type", target: CONFIGURATION }],
    })
  ).url;
  for (let i = 0; i < 2; i++)
    await duplicate.storage.create(parent, null, {
      kind: "container",
      name: `suite${i}`,
      links: [{ rel: "type", target: suiteType }],
    });
  await expect(createRemote(duplicate.options, signal).read("rail")).rejects.toMatchObject({
    code: "unsafe-location",
  });
});

test("container/name races recover only from conflict, missing validators refuse writes, null write ETags are refreshed", async () => {
  const f = await fixture();
  const original = f.storage.create;
  const signal = new AbortController().signal;
  const create = vi.spyOn(f.storage, "create");
  create.mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new StorageError("conflict", { method: "PUT", url: rootUrl });
  });
  const remote = createRemote(f.options, signal);
  expect(await remote.read("rail")).toBeUndefined();
  create.mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new StorageError("conflict", { method: "PUT", url: rootUrl });
  });
  await remote.put("rail", "2");
  const read = f.storage.read;
  const get = vi
    .spyOn(f.storage, "read")
    .mockImplementationOnce(async (...args) => ({ ...(await read(...args)), etag: null }));
  remote.invalidate("rail");
  await expect(remote.put("rail", "3")).rejects.toMatchObject({ code: "missing-etag" });
  get.mockRestore();
  const write = f.storage.write;
  vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => ({
    ...(await write(...args)),
    etag: null,
  }));
  await remote.put("rail", "4");
  await remote.put("rail", "5");
  expect(await remote.read("rail")).toBe("5");
  create.mockRejectedValueOnce(new Error("failed create"));
  await expect(
    createRemote(
      { ...f.options, typeIndex: { ...f.typeIndex, find: async () => [] } },
      signal,
    ).read("rail2"),
  ).resolves.toBeUndefined();
  const fresh = await fixture();
  vi.spyOn(fresh.storage, "create").mockRejectedValue(
    new StorageError("conflict", { method: "PUT", url: rootUrl }),
  );
  await expect(createRemote(fresh.options, signal).read("rail")).rejects.toMatchObject({
    code: "conflict",
  });
  vi.spyOn(fresh.storage, "create").mockRejectedValue(new Error("offline"));
  const retryable = createRemote(fresh.options, signal);
  await expect(retryable.read("rail")).rejects.toThrow("offline");
  await expect(retryable.read("rail")).rejects.toThrow("offline");
  vi.spyOn(fresh.storage, "head").mockRejectedValueOnce(new Error("head error"));
  await expect(createRemote(fresh.options, signal).read("rail")).rejects.toThrow("head error");
  const wrongKind = await fixture();
  const originalHead = wrongKind.storage.head;
  vi.spyOn(wrongKind.storage, "head").mockImplementation(async (...args) => ({
    ...(await originalHead(...args)),
    kind: "resource",
  }));
  await originalHead(rootUrl);
  // Existing container advertised as a resource is never treated as a preferences destination.
  await wrongKind.storage.create(rootUrl, null, { name: "settings", kind: "container" });
  await expect(createRemote(wrongKind.options, signal).read("rail")).rejects.toMatchObject({
    code: "unsafe-location",
  });
});

test("IndexedDB rejects open/transaction failures and acknowledgements cannot clear a newer value", async () => {
  const queue = createQueue(webId, rootUrl);
  const a = record();
  const b = { ...a, json: "2", token: "new", order: a.order + 1 };
  await queue.put(a);
  await queue.put(b);
  await queue.put(a);
  await queue.acknowledge(a);
  expect((await queue.list())[0]).toMatchObject({ json: "2", pending: true });
  await queue.acknowledge(record("missing"));
  await queue.acknowledge(b);
  expect((await queue.list())[0]?.pending).toBe(false);
  const getAll = IDBObjectStore.prototype.getAll;
  vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(function (
    this: IDBObjectStore,
    ...args
  ) {
    const request = getAll.apply(this, args);
    this.transaction.abort();
    return request;
  });
  await expect(queue.list()).rejects.toBeNull();
  const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    const request = { error: new Error("IDB unavailable") } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => request.onerror?.(new Event("error")));
    return request;
  });
  await expect(queue.list()).rejects.toThrow("IDB unavailable");
  const f = await fixture();
  const store = make(f.options);
  const view = await mount(store);
  await view.ready();
  expect(view.current.error).toEqual(new Error("IDB unavailable"));
  await act(() => store.flush());
  await act(() => view.current.set(1));
  expect(view.current.pending).toBe(true);
  open.mockRestore();
  await act(() => store.flush());
  expect(view.current.pending).toBe(false);
  vi.stubGlobal("indexedDB", undefined);
  const memory = createQueue(webId, rootUrl);
  await memory.put(b);
  await memory.put(a);
  expect((await memory.list())[0]?.json).toBe("2");
});

test("profile read failures propagate except non-RDF/missing LWS profiles, and revoked sessions never fetch", async () => {
  const f = await fixture("lws");
  const read = vi.spyOn(f.storage, "readRdf");
  for (const code of ["not-rdf", "not-found"] as const) {
    read.mockRejectedValueOnce(new StorageError(code, { method: "GET", url: webId }));
    expect(
      await createRemote({ ...f.options, profile: undefined }, new AbortController().signal).read(
        "rail",
      ),
    ).toBeUndefined();
  }
  read.mockRejectedValueOnce(new Error("profile error"));
  await expect(
    createRemote({ ...f.options, profile: undefined }, new AbortController().signal).read("rail"),
  ).rejects.toThrow("profile error");
  const solid = await fixture();
  vi.spyOn(solid.storage, "readRdf").mockRejectedValueOnce(
    new StorageError("not-rdf", { method: "GET", url: webId }),
  );
  await expect(
    createRemote({ ...solid.options, profile: undefined }, new AbortController().signal).read(
      "rail",
    ),
  ).rejects.toMatchObject({ code: "not-rdf" });
  const abort = new AbortController();
  abort.abort();
  await expect(createRemote(f.options, abort.signal).read("rail")).rejects.toMatchObject({
    code: "session-changed",
  });
});

function holdOpen(nth: number) {
  const opened = defer<void>();
  const release = defer<void>();
  const original = indexedDB.open.bind(indexedDB);
  let count = 0;
  const spy = vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
    const request = original(...args);
    if (++count !== nth) return request;
    const proxy = {} as IDBOpenDBRequest;
    request.onsuccess = () => {
      Object.defineProperty(proxy, "result", { value: request.result });
      opened.resolve();
      void release.promise.then(() => proxy.onsuccess?.(new Event("success")));
    };
    return proxy;
  });
  return {
    opened: opened.promise,
    release: () => release.resolve(),
    restore: () => spy.mockRestore(),
  };
}

test("cache hydration cannot overwrite an early set, and corrupt persisted values are ignored", async () => {
  const f = await fixture();
  connected = false;
  const q = createQueue(webId, rootUrl);
  await q.put(record("rail", { json: "1", pending: false, order: Date.now() + 10_000 }));
  await q.put(record("corrupt", { json: "no-json" }));
  const held = holdOpen(1);
  const store = make(f.options);
  const view = await mount(store);
  await held.opened;
  let saving!: Promise<void>;
  await act(async () => {
    saving = view.current.set(5);
  });
  held.release();
  await act(async () => {
    await saving;
  });
  held.restore();
  expect(view.current.value).toBe(5);
  expect(view.current.pending).toBe(true);
  expect((await q.list()).find((row) => row.key === "rail")?.json).toBe("5");
  const corrupt = await mount(store, "corrupt");
  await corrupt.ready();
  expect(corrupt.current.value).toBe(0);
});

test("late reads and late cache writes cannot replace an optimistic local value", async () => {
  const f = await fixture();
  await createRemote(f.options, new AbortController().signal).put("rail", "1");
  const original = f.storage.read;
  const reached = defer<void>();
  const release = defer<void>();
  vi.spyOn(f.storage, "read").mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    reached.resolve();
    await release.promise;
    return result;
  });
  const a = await mount(make(f.options));
  await reached.promise;
  await act(() => a.current.set(6));
  await act(async () => {
    release.resolve();
  });
  expect(a.current.value).toBe(6);
  await a.unmount();
  // Hold the cache write after remote.read has already passed its first revision check.
  await createQueue(webId, rootUrl).put(
    record("rail", { json: "6", pending: false, order: Date.now() + 100 }),
  );
  const held = holdOpen(2);
  const b = await mount(make(f.options));
  await held.opened;
  let saving!: Promise<void>;
  await act(async () => {
    saving = b.current.set(7);
  });
  held.release();
  await act(async () => {
    await saving;
  });
  held.restore();
  expect(b.current.value).toBe(7);
});

test("transient cache write errors retain pending values and recover on flush", async () => {
  const f = await fixture();
  const store = make(f.options);
  const view = await mount(store);
  await view.ready();
  const open = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
    const request = { error: new Error("quota") } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => request.onerror?.(new Event("error")));
    return request;
  });
  await act(() => view.current.set(4));
  expect(view.current).toMatchObject({ value: 4, pending: true, error: new Error("quota") });
  vi.spyOn(indexedDB, "open").mockImplementation(open);
  await act(() => store.flush());
  expect(view.current).toMatchObject({ pending: false, error: undefined });
});

test("dispose fences transports that ignore cancellation; pending local edits ignore tab updates", async () => {
  const f = await fixture();
  const gate = defer<string[]>();
  vi.mocked(f.typeIndex.find).mockReturnValueOnce(gate.promise);
  const create = vi.spyOn(f.storage, "create");
  const store = make(f.options);
  const view = await mount(store);
  await act(async () => {
    store.dispose();
    gate.resolve([]);
  });
  expect(create).not.toHaveBeenCalled();
  await expect(view.current.set(2)).rejects.toMatchObject({ code: "session-changed" });
  connected = false;
  const local = await mount(make(f.options));
  await local.ready();
  await act(() => local.current.set(3));
  await act(async () => new Channel("suite-prefs").postMessage(record("rail", { json: "20" })));
  expect(local.current.value).toBe(3);
});

test("server and discarded renders perform no I/O, and a set retained across a key change is fenced", async () => {
  const f = await fixture();
  const store = make(f.options);
  const find = vi.mocked(f.typeIndex.find);
  function Probe() {
    const value = store("rail", number, 0);
    return String(value.value);
  }
  expect(renderToString(createElement(Probe))).toBe("0");
  expect(find).not.toHaveBeenCalled();
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    flushSync(() => root.render(createElement(Probe)));
    flushSync(() => root.unmount());
  });
  expect(find).not.toHaveBeenCalled();
  const view = await mount(store);
  await view.ready();
  const stale = view.current.set;
  await view.change(store, "density");
  await view.ready();
  await expect(stale(2)).rejects.toMatchObject({ code: "session-changed" });
});

test("startup automatically replays every pending key in order, including keys without a consumer", async () => {
  const f = await fixture();
  const queue = createQueue(webId, rootUrl);
  await queue.put(record("density", { json: "2", order: 2 }));
  await queue.put(record("rail", { json: "1", order: 1 }));
  const create = vi.spyOn(f.storage, "create");
  const store = make(f.options);
  const view = await mount(store, "tasks");
  await view.ready();
  await act(() => store.flush());
  expect(
    create.mock.calls
      .filter((args) => args[2]?.contentType === "application/json")
      .map((args) => args[1]),
  ).toEqual(["1", "2"]);
  expect((await queue.list()).every((row) => !row.pending)).toBe(true);
});

test("oversized pod values surface the typed size error and late failed reads cannot replace a successful set", async () => {
  const f = await fixture();
  const remote = createRemote(f.options, new AbortController().signal);
  await remote.put("large", JSON.stringify("x".repeat(65_536)));
  const huge = await mount(make(f.options), "large", any, null);
  await huge.ready();
  expect(huge.current).toMatchObject({ value: null, error: { code: "too-large" } });
  await remote.put("rail", "1");
  const reached = defer<void>();
  const release = defer<void>();
  vi.spyOn(f.storage, "read").mockImplementationOnce(async () => {
    reached.resolve();
    await release.promise;
    throw new Error("old read error");
  });
  const view = await mount(make(f.options));
  await reached.promise;
  await act(() => view.current.set(8));
  await act(async () => {
    release.resolve();
  });
  expect(view.current).toMatchObject({ value: 8, error: undefined, pending: false });
});
