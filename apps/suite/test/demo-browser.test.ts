// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Reuse the workspace's installed IndexedDB fixture; no added dependency.
const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};

class TestChannel {
  static peers = new Set<TestChannel>();
  onmessage?: (event: { data: unknown }) => void;
  constructor(readonly name: string) {
    TestChannel.peers.add(this);
  }
  postMessage(data: unknown) {
    for (const peer of TestChannel.peers)
      if (peer !== this && peer.name === this.name)
        queueMicrotask(() => peer.onmessage?.({ data }));
  }
  close() {
    TestChannel.peers.delete(this);
  }
}

function storage(broadcast = false) {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", broadcast ? TestChannel : undefined);
}

async function tab() {
  vi.resetModules();
  return import("../src/lib/demo-pod/browser");
}

async function stored(value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("solid-suite-demo", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pods");
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction("pods", "readwrite");
    tx.objectStore("pods").put(value, DEMO_ROOT);
    tx.oncomplete = () => resolve();
  });
  db.close();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  TestChannel.peers.clear();
});

it("preserves uploads from stale tabs and reloads both resources", async () => {
  storage();
  const first = await (await tab()).getDemoPod();
  const second = await (await tab()).getDemoPod();
  await first.fetch(`${DEMO_ROOT}drive/from-a`, { method: "PUT", body: "A" });
  await second.fetch(`${DEMO_ROOT}drive/from-b`, { method: "PUT", body: "B" });
  const reloaded = await (await tab()).getDemoPod();
  expect(await (await reloaded.fetch(`${DEMO_ROOT}drive/from-a`)).text()).toBe("A");
  expect(await (await reloaded.fetch(`${DEMO_ROOT}drive/from-b`)).text()).toBe("B");
});

it("retries concurrent snapshot commits without dropping unrelated uploads", async () => {
  storage();
  const moduleA = await tab();
  const pendingA = moduleA.getDemoPod();
  const moduleB = await tab();
  const [a, b] = await Promise.all([pendingA, moduleB.getDemoPod()]);
  expect(a).not.toBe(b);
  const responses = await Promise.all([
    a.fetch(`${DEMO_ROOT}drive/a`, { method: "PUT", body: "A" }),
    b.fetch(`${DEMO_ROOT}drive/b`, { method: "PUT", body: "B" }),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const reloaded = await (await tab()).getDemoPod();
  expect(await (await reloaded.fetch(`${DEMO_ROOT}drive/a`)).text()).toBe("A");
  expect(await (await reloaded.fetch(`${DEMO_ROOT}drive/b`)).text()).toBe("B");
});

it("rechecks conditional creates and edits across concurrent tabs", async () => {
  storage();
  const a = await (await tab()).getDemoPod();
  const b = await (await tab()).getDemoPod();
  const url = `${DEMO_ROOT}drive/same`;
  const responses = await Promise.all(
    [a, b].map((pod, i) =>
      pod.fetch(url, {
        method: "PUT",
        body: new Blob([String(i)]),
        headers: { "if-none-match": "*" },
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 412]);
  const etag = (await a.fetch(url)).headers.get("etag") as string;
  const edits = await Promise.all(
    [a, b].map((pod, i) =>
      pod.fetch(
        new Request(url, {
          method: "PUT",
          body: `edit ${i}`,
          headers: { "if-match": etag, "content-type": "text/custom" },
        }),
      ),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual([205, 412]);
  expect((await b.fetch(url)).headers.get("content-type")).toBe("text/custom");
});

it("does not resurrect files deleted in another tab", async () => {
  storage();
  const a = await (await tab()).getDemoPod();
  const b = await (await tab()).getDemoPod();
  const url = `${DEMO_ROOT}drive/notes.md`;
  expect((await a.fetch(url, { method: "DELETE" })).status).toBe(205);
  await b.fetch(`${DEMO_ROOT}drive/b`, { method: "PUT", body: "B" });
  expect((await (await (await tab()).getDemoPod()).fetch(url)).status).toBe(404);
});

it("answers conditional reads from the durable pod before another tab's change arrives", async () => {
  // No channel: b's view stays stale, as when a broadcast has not been delivered yet.
  storage();
  const a = await (await tab()).getDemoPod();
  const url = `${DEMO_ROOT}drive/survivor`;
  await a.fetch(url, { method: "PUT", body: "S" });
  const b = await (await tab()).getDemoPod();
  const etag = (await b.fetch(url)).headers.get("etag") as string;
  expect((await a.fetch(url, { method: "DELETE" })).status).toBe(205);
  expect((await b.fetch(url, { method: "HEAD", headers: { "if-match": etag } })).status).toBe(404);
  expect((await b.fetch(url, { headers: { "if-none-match": "*" } })).status).toBe(404);
});

it("broadcasts durable changes and reloads other tabs before notifying subscribers", async () => {
  storage(true);
  const a = await (await tab()).getDemoPod();
  const b = await (await tab()).getDemoPod();
  const url = `${DEMO_ROOT}drive/broadcast`;
  const notification = new Promise<void>((resolve) => {
    const unsubscribe = b.subscribe((changed) => {
      expect(changed).toBe(url);
      expect(b.has(url)).toBe(true);
      unsubscribe();
      resolve();
    });
  });
  const listener = vi.fn();
  const unsubscribe = a.subscribe(listener);
  await a.fetch(url, { method: "PUT", body: "broadcast" });
  await notification;
  expect(listener).toHaveBeenCalledWith(url);
  expect(a.snapshot().resources.some(([storedUrl]) => storedUrl === url)).toBe(true);
  unsubscribe();
  expect(await (await b.fetch(url)).text()).toBe("broadcast");
});

it("resets persisted files and invalidates the old facade", async () => {
  storage(true);
  const module = await tab();
  const pod = await module.getDemoPod();
  expect(await module.getDemoPod()).toBe(pod);
  const url = `${DEMO_ROOT}drive/custom`;
  await pod.fetch(url, { method: "PUT", body: "custom" });
  await module.resetDemoPod();
  await expect(pod.fetch(url)).rejects.toThrow("reset");
  const fresh = await module.getDemoPod();
  expect(fresh.has(url)).toBe(false);
  expect(fresh.has(`${DEMO_ROOT}drive/notes.md`)).toBe(true);
});

it("migrates a legacy persisted snapshot without losing bytes", async () => {
  storage();
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: [{ path: "legacy", body: "old", contentType: "text/plain" }],
  });
  await stored(pod.snapshot());
  const migrated = await (await tab()).getDemoPod();
  expect(await (await migrated.fetch(`${DEMO_ROOT}legacy`)).text()).toBe("old");
  await migrated.fetch(`${DEMO_ROOT}new`, { method: "PUT", body: "new" });
  expect(await (await (await (await tab()).getDemoPod()).fetch(`${DEMO_ROOT}legacy`)).text()).toBe(
    "old",
  );
});

it("rejects failed durable commits without acknowledging or exposing the trial write", async () => {
  storage();
  const pod = await (await tab()).getDemoPod();
  const url = `${DEMO_ROOT}drive/uncommitted`;
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
  ) {
    this.transaction.abort();
    return {} as IDBRequest<IDBValidKey>;
  });
  await expect(pod.fetch(url, { method: "PUT", body: "uncommitted" })).rejects.toBeDefined();
  expect(pod.has(url)).toBe(false);
  put.mockRestore();
  const reloaded = await (await tab()).getDemoPod();
  expect((await reloaded.fetch(url)).status).toBe(404);
});

it("refuses to start rather than accept edits when IndexedDB cannot open", async () => {
  vi.stubGlobal("indexedDB", {
    open() {
      const request = { error: new DOMException("denied", "SecurityError") } as {
        error: DOMException;
        onerror?: () => void;
      };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  });
  vi.stubGlobal("BroadcastChannel", undefined);
  const module = await tab();
  await expect(module.getDemoPod()).rejects.toBeInstanceOf(module.DemoStorageError);
});

it("falls back to memory when IndexedDB is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  vi.stubGlobal("BroadcastChannel", undefined);
  const module = await tab();
  const pod = await module.getDemoPod();
  expect((await pod.fetch(`${DEMO_ROOT}file`, { method: "PUT", body: "memory" })).status).toBe(201);
  expect(await (await pod.fetch(`${DEMO_ROOT}file`)).text()).toBe("memory");
  await module.resetDemoPod();
  expect((await module.getDemoPod()).has(`${DEMO_ROOT}file`)).toBe(false);
});

it("shares one durable snapshot commit for concurrent mutations, including their notifications", async () => {
  storage(true);
  const pod = await (await tab()).getDemoPod();
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  const notification = vi.fn();
  pod.subscribe(notification);
  const responses = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      pod.fetch(`${DEMO_ROOT}drive/batch-${index}`, { method: "PUT", body: String(index) }),
    ),
  );
  expect(responses.every((response) => response.status === 201)).toBe(true);
  expect(put).toHaveBeenCalledTimes(1);
  expect(notification).toHaveBeenCalledTimes(16);
  const reloaded = await (await tab()).getDemoPod();
  for (let index = 0; index < 16; index++)
    expect(reloaded.has(`${DEMO_ROOT}drive/batch-${index}`)).toBe(true);
});

it("replays batched conditional creates after another tab wins without losing unrelated writes", async () => {
  storage(true);
  const a = await (await tab()).getDemoPod();
  const b = await (await tab()).getDemoPod();
  const responses = await Promise.all(
    [a, b].map(async (pod, tabIndex) =>
      Promise.all([
        pod.fetch(`${DEMO_ROOT}drive/shared-batch`, {
          method: "PUT",
          body: String(tabIndex),
          headers: { "if-none-match": "*" },
        }),
        ...Array.from({ length: 8 }, (_, index) =>
          pod.fetch(`${DEMO_ROOT}drive/tab-${tabIndex}-${index}`, {
            method: "PUT",
            body: String(index),
          }),
        ),
      ]),
    ),
  );
  expect(responses.map((batch) => batch[0]?.status).sort()).toEqual([201, 412]);
  expect(
    responses.flatMap((batch) => batch.slice(1)).every((response) => response.status === 201),
  ).toBe(true);
  const reloaded = await (await tab()).getDemoPod();
  for (let tabIndex = 0; tabIndex < 2; tabIndex++)
    for (let index = 0; index < 8; index++)
      expect(reloaded.has(`${DEMO_ROOT}drive/tab-${tabIndex}-${index}`)).toBe(true);
});

it("rejects the entire batch after a failed commit and never exposes or broadcasts trial writes", async () => {
  storage(true);
  const pod = await (await tab()).getDemoPod();
  const other = await (await tab()).getDemoPod();
  const changed = vi.fn();
  pod.subscribe(changed);
  other.subscribe(changed);
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
  ) {
    this.transaction.abort();
    return {} as IDBRequest<IDBValidKey>;
  });
  const urls = ["first", "second"].map((name) => `${DEMO_ROOT}drive/failed-${name}`);
  const results = await Promise.allSettled(
    urls.map((url) => pod.fetch(url, { method: "PUT", body: "uncommitted" })),
  );
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(urls.every((url) => !pod.has(url) && !other.has(url))).toBe(true);
  put.mockRestore();
  const reloaded = await (await tab()).getDemoPod();
  expect(urls.every((url) => !reloaded.has(url))).toBe(true);
  expect((await pod.fetch(urls[0] as string, { method: "PUT", body: "retry" })).status).toBe(201);
});

it.each([
  62, 100,
])("profiles compacted Docs trash and Undo with %i updates against durable browser storage", async (updateCount) => {
  storage();
  const doc = new Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  for (let index = 0; index < updateCount; index++) doc.getText("body").insert(index, "x");
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: [
      ...(await buildDemoSeed(Date.now())),
      { path: "docs/plan.ttl", body: "snapshot", contentType: "text/turtle" },
      ...updates.map((body, index) => ({
        path: `docs/plan/updates/${index}`,
        body,
        contentType: "application/octet-stream",
      })),
    ],
  });
  await stored({ revision: "profile", snapshot: pod.snapshot() });
  const browser = await (await tab()).getDemoPod();
  const commits = vi.spyOn(IDBObjectStore.prototype, "put");
  const session = {
    storageUrl: DEMO_ROOT,
    webId: `${DEMO_ROOT}profile#me`,
    fetch: browser.fetch,
  } as PodSession;
  const start = performance.now();
  const result = await deleteDocument(`${DEMO_ROOT}docs/plan.ttl`, session);
  const trashTime = performance.now() - start;
  const trashCommits = commits.mock.calls.length;
  expect(result.failed).toEqual([]);
  commits.mockClear();
  const undoStart = performance.now();
  expect((await restoreDocument(result.done, session)).failed).toEqual([]);
  console.log("Browser Docs profile", {
    updateCount,
    trashTime,
    undoTime: performance.now() - undoStart,
    trashCommits,
    undoCommits: commits.mock.calls.length,
  });
  expect(trashCommits).toBeLessThanOrEqual(16);
  expect(commits.mock.calls.length).toBeLessThanOrEqual(11);
  doc.destroy();
});
