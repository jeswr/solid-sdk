// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";

const { IDBFactory, IDBObjectStore, IDBDatabase } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
  IDBDatabase: { prototype: IDBDatabase };
};
const url = "https://ledger.test/private/";
const required = { acl: `${url}.acl`, from: url, turtle: "" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("commits requirements in IndexedDB, shares across reloads, and durably clears verified protection", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const ledger = protectionLedger(fetch);
  expect(await ledger.get(url)).toBeUndefined();
  await ledger.set(url, required);
  vi.resetModules();
  const { protectionLedger: fresh } = await import(
    "../src/apps/drive/lib/client/protection-ledger"
  );
  const reloaded = fresh(fetch);
  expect(await reloaded.get(url)).toEqual(required);
  await reloaded.clear(url);
  expect(await ledger.get(url)).toBeUndefined();
});

it("isolates non-browser transports and refuses non-durable browser provisioning", async () => {
  vi.stubGlobal("indexedDB", undefined);
  vi.stubGlobal("window", undefined);
  const transport: typeof fetch = async () => new Response();
  const ledger = protectionLedger(transport);
  await ledger.set(url, required);
  expect(await protectionLedger(transport).get(url)).toEqual(required);
  expect(await protectionLedger(fetch).get(url)).toBeUndefined();
  await ledger.clear(url);
  expect(await ledger.get(url)).toBeUndefined();
  vi.stubGlobal("window", {});
  await expect(ledger.set(url, required)).rejects.toThrow(/could not be established or verified/);
  await expect(ledger.get(url)).rejects.toThrow(/could not be established or verified/);
  await expect(ledger.clear(url)).rejects.toThrow(/could not be established or verified/);
});

it.each(["error", "blocked"])("fails closed when IndexedDB open reports %s", async (mode) => {
  const request = { error: new Error("Storage denied"), onerror: () => {}, onblocked: () => {} };
  vi.stubGlobal("indexedDB", {
    open: () => {
      queueMicrotask(() => (mode === "error" ? request.onerror() : request.onblocked()));
      return request;
    },
  });
  await expect(protectionLedger(fetch).get(url)).rejects.toThrow(
    /could not be established or verified/,
  );
});

it.each([
  "abort",
  "error",
  "throw",
])("rejects an uncommitted requirement on transaction %s", async (mode) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const ledger = protectionLedger(fetch);
  await ledger.get(url);
  if (mode === "throw")
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("Storage offline");
    });
  else
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore) {
      if (mode === "abort") this.transaction.abort();
      else queueMicrotask(() => this.transaction.onerror?.(new Event("error")));
      return {} as IDBRequest<IDBValidKey>;
    });
  await expect(ledger.set(url, required)).rejects.toThrow(/could not be established or verified/);
});
