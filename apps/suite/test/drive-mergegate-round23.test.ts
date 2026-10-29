// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
import {
  classifyDelete,
  deletionControl,
  isDeletionFailure,
} from "../src/apps/drive/lib/client/deletion";
import { deletionLedger, protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { deleteOutcomes, refusedDelete, unknownDelete } from "./drive-delete-outcomes";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};
const source = "https://delete.test/source";
const recovery = "https://delete.test/recovery";
const errorFor = (status: number, url: string) =>
  new DriveError(status === 412 ? "conflict" : "failed", status, url);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(
  Array.from({ length: 500 }, (_, index) => index + 100),
)("classifies HTTP %s into exactly one DELETE outcome", (status) => {
  const done = [...Array.from({ length: 100 }, (_, index) => index + 200), 404, 410].filter(
    (value) => value !== 202,
  );
  const refused = Array.from({ length: 100 }, (_, index) => index + 400).filter(
    (value) => ![404, 408, 410, 429].includes(value),
  );
  expect(classifyDelete(status)).toBe(
    done.includes(status) ? "done" : refused.includes(status) ? "not-performed" : "unknown",
  );
});

it("classifies lost responses as unknown without marking unrelated failures as DELETE failures", () => {
  expect(classifyDelete(undefined)).toBe("unknown");
  expect(isDeletionFailure(undefined)).toBe(false);
  expect(isDeletionFailure(new Error("Unrelated"))).toBe(false);
});

it.each(
  deleteOutcomes.filter(refusedDelete),
)("DELETE %s retires only deletion guards without polling or discarding ACL protection", async (status) => {
  const http = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "HEAD"
      ? new Response(null, { headers: { etag: '"old"' } })
      : unknownDelete(status),
  );
  const protection = { acl: `${source}.acl`, from: source, turtle: "required ACL" };
  await protectionLedger(http).set(source, protection);
  await expect(
    deletionControl(http, errorFor).remove(source, '"old"', recovery),
  ).rejects.toMatchObject({
    status,
  });
  expect(http.mock.calls.map(([, init]) => init?.method)).toEqual(["HEAD", "DELETE"]);
  expect(await deletionLedger(http).get(source)).toBeUndefined();
  expect(await deletionLedger(http).get(recovery)).toBeUndefined();
  expect(await protectionLedger(http).get(source)).toEqual(protection);
});

it.each([
  [200, '"old"', true],
  [200, null, true],
  [200, 'W/"old"', true],
  [200, 'W/"new"', true],
  [200, '"new"', false],
  [204, '"new"', false],
  [404, null, false],
  [410, null, false],
  [403, '"new"', true],
  [408, '"new"', true],
  [429, '"new"', true],
  [503, '"new"', true],
  ["network", null, true],
  ["aborted", null, true],
  ["timed out", null, true],
] as const)("Retry HEAD %s with ETag %s leaves pending=%s", async (status, etag, pending) => {
  let retry = false;
  const http = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 202 });
    if (!retry) return new Response(null, { headers: { etag: '"old"' } });
    if (typeof status === "string") return unknownDelete(status);
    return new Response(null, { status, ...(etag ? { headers: { etag } } : {}) });
  });
  const control = deletionControl(http, errorFor);
  await expect(control.remove(source, '"old"', recovery)).rejects.toMatchObject({
    kind: "delete-pending",
  });
  retry = true;
  const check = control.guard(recovery);
  if (pending) await expect(check).rejects.toMatchObject({ kind: "delete-pending" });
  else await check;
  expect(Boolean(await deletionLedger(http).get(source))).toBe(pending);
  expect(Boolean(await deletionLedger(http).get(recovery))).toBe(pending);
  expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it.each([
  202, 408, 429, 500, 599,
])("an immediate changed-ETag re-read of DELETE %s settles as a retryable conflict", async (status) => {
  const http: typeof fetch = async (_url, init) =>
    init?.method === "DELETE"
      ? new Response(null, { status })
      : new Response(null, {
          headers: { etag: new Headers(init?.headers).has("if-match") ? '"old"' : '"new"' },
        });
  await expect(
    deletionControl(http, errorFor).remove(source, '"old"', recovery),
  ).rejects.toMatchObject({
    kind: "conflict",
    status: 412,
  });
  expect(await deletionLedger(http).keys()).toEqual([]);
});

it("reload rechecks every persisted source once, including guards orphaned during retirement", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const gone = "https://delete.test/gone";
  const orphan = "https://delete.test/orphan";
  const unresolved = "https://delete.test/unresolved";
  const foreign = "https://other.test/source";
  const http = vi.fn<typeof fetch>(
    async (url) =>
      new Response(null, {
        status: String(url) === gone ? 410 : 200,
        headers: { etag: '"new"' },
      }),
  );
  const ledger = deletionLedger(http);
  await ledger.set(source, { sources: [source], etag: '"old"', recovery });
  await ledger.set(recovery, { sources: [source] });
  await ledger.set(orphan, { sources: [gone] });
  // Legacy records without a validator stay conservative but can still settle by absence.
  await ledger.set(unresolved, { sources: [unresolved] });
  await ledger.set(foreign, { sources: [foreign] });
  await ledger.set("https://delete.test/foreign-reference", { sources: [foreign] });
  await protectionLedger(http).set(source, { acl: "acl", from: source, turtle: "archive" });
  const freshTransport: typeof fetch = (url, init) => http(url, init);
  const fresh = createSolidDriveClient({
    storageUrl: "https://delete.test/",
    fetch: freshTransport,
  });
  expect(await fresh.recheckDeletions?.()).toEqual([unresolved]);
  expect(http.mock.calls.map(([url]) => url).sort()).toEqual([source, gone, unresolved].sort());
  expect(
    http.mock.calls.every(([, init]) => init?.method === "HEAD" && init.cache === "no-store"),
  ).toBe(true);
  expect(await ledger.keys()).toEqual(expect.arrayContaining([unresolved, foreign]));
  expect(await ledger.get(source)).toBeUndefined();
  expect(await ledger.get(recovery)).toBeUndefined();
  expect(await ledger.get(orphan)).toBeUndefined();
  expect(await protectionLedger(http).get(source)).toBeDefined();
});

it("load tolerates another tab retiring a guard between enumeration and lookup", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const http = vi.fn<typeof fetch>();
  await deletionLedger(http).set(source, { sources: [source], etag: '"old"' });
  const readKeys = IDBObjectStore.prototype.getAllKeys;
  vi.spyOn(IDBObjectStore.prototype, "getAllKeys").mockImplementation(function (
    this: IDBObjectStore,
  ) {
    const request = readKeys.call(this);
    request.addEventListener("success", () => {
      const tx = this.transaction.db.transaction("requirements", "readwrite");
      tx.objectStore("requirements").delete(`delete:${source}`);
    });
    return request;
  });
  expect(await deletionControl(http, errorFor).recheck("https://delete.test/")).toEqual([]);
  expect(http).not.toHaveBeenCalled();
});
