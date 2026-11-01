// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import type { AuthFetch } from "@jeswr/storage-client";
import { createLwsBackend } from "@jeswr/storage-client/lws";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import ts from "typescript";
import { expect, test, vi } from "vitest";
import { createNotifications } from "../index.js";
import { FakeTimers } from "../testing.js";
import type { ChangeEvent, NotificationsDependencies } from "../types.js";
import { createPollChannel } from "./poll.js";

test("polling revalidates cacheable HEADs and all listing pages to observe changes", async () => {
  const root = "https://pod.example/";
  const hot = `${root}hot`;
  let changed = false;
  const calls: [string, string | undefined][] = [];
  const fetch: AuthFetch = async (input, init) => {
    const url = String(input);
    calls.push([url, init?.cache]);
    // Model a fresh cached response remaining stale until the caller requests revalidation.
    const fresh = changed && init?.cache === "no-cache";
    const headers = { "cache-control": "max-age=3600", etag: fresh ? '"new"' : '"old"' };
    if (init?.method === "HEAD") return new Response(null, { headers });
    const first = url === root;
    return Response.json(
      {
        type: "Container",
        items: [{ id: first ? "hot" : fresh ? "new" : "old", type: "DataResource" }],
      },
      {
        headers: {
          ...headers,
          "content-type": "application/lws+json",
          ...(first ? { link: '<?page=2>; rel="next"' } : {}),
        },
      },
    );
  };
  const storage = createLwsBackend({ root, fetch });
  const timers = new FakeTimers();
  const sub = createPollChannel({
    storage,
    topics: [root, hot],
    intervalMs: 10,
    timers,
    now: timers.now,
  });
  const changes: ChangeEvent[] = [];
  sub.on("change", (event) => changes.push(event));
  await timers.advanceBy(0);
  expect(changes).toEqual([]);
  changed = true;
  await timers.advanceBy(10);
  expect(changes.map((event) => [event.type, event.object])).toEqual([
    ["Update", root],
    ["Create", `${root}new`],
    ["Delete", `${root}old`],
    ["Update", hot],
  ]);
  expect(calls).toEqual(
    [...Array(2)].flatMap(() =>
      [root, root, `${root}?page=2`, hot].map((url) => [url, "no-cache"]),
    ),
  );
  await sub.close();
});

test("direct polling channel handles an already-aborted signal without scheduling work", () => {
  const storage = createMemoryStorage();
  const timers = new FakeTimers();
  const abort = new AbortController();
  abort.abort();
  const sub = createPollChannel({
    storage,
    topics: [storage.root],
    intervalMs: 10,
    timers,
    now: timers.now,
    signal: abort.signal,
  });
  expect(sub.state).toBe("closed");
  expect(timers.pending).toBe(0);
});

test("setup resync waits for a complete baseline and emits only once after a failed page", async () => {
  const storage = createMemoryStorage({ pageSize: 1 });
  const child = await storage.create(storage.root, "new", {
    contentType: "text/plain",
    name: "new",
  });
  const listAll = storage.listAll.bind(storage);
  vi.spyOn(storage, "listAll").mockImplementationOnce(async function* (...args) {
    yield* listAll(...args);
    throw new Error("Final listing page failed");
  });
  const timers = new FakeTimers(100);
  const sub = createPollChannel({
    storage,
    topics: [storage.root, child.url],
    intervalMs: 10,
    timers,
    now: timers.now,
  });
  const resync = vi.fn();
  const changes = vi.fn();
  sub.on("resync", resync);
  sub.on("change", changes);
  await timers.advanceBy(0);
  expect(resync).not.toHaveBeenCalled();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(storage, "listAll").mockImplementationOnce(async function* (...args) {
    yield* listAll(...args);
    started.resolve();
    await release.promise;
  });
  const tick = timers.advanceBy(10);
  await started.promise;
  expect(resync).not.toHaveBeenCalled();
  release.resolve();
  await tick;
  expect(resync).toHaveBeenCalledExactlyOnceWith(new Date(0));
  await timers.advanceBy(20);
  expect(resync).toHaveBeenCalledOnce();
  expect(changes).not.toHaveBeenCalled();
  await sub.close();
  expect(timers.pending).toBe(0);
});

test("the recipe reconciles a change absorbed by the polling baseline without another mutation", async () => {
  const markdown = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  const code = /```ts\n([\s\S]*?)```/.exec(markdown)?.[1];
  if (!code) throw new Error("Missing notification recipe");
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const timers = new FakeTimers(100);
  const storage = createMemoryStorage();
  const watchCollection = new Function(
    "require",
    "exports",
    `${outputText}\nreturn exports.watchCollection;`,
  )((specifier: string) => {
    expect(specifier).toBe("@jeswr/pod-notifications");
    return {
      createNotifications: (deps: NotificationsDependencies) =>
        createNotifications({ ...deps, timers, now: timers.now }),
    };
  }, {});
  let cached: string[] = [];
  const reconcile = vi.fn(async () => {
    const members = [];
    for await (const entry of storage.listAll(storage.root)) members.push(entry.url);
    cached = members;
  });
  const invalidate = vi.fn();
  const reportError = vi.fn();
  const cleanup = await watchCollection(
    vi.fn(),
    storage,
    `${storage.root}missing`,
    invalidate,
    reconcile,
    reportError,
  );
  expect(cached).toEqual([]);
  const child = await storage.create(storage.root, "new", {
    contentType: "text/plain",
    name: "new",
  });
  // The first poll absorbs this mutation into its quiet baseline.
  await timers.advanceBy(0);
  await vi.waitFor(() => expect(cached).toEqual([child.url]));
  expect(reconcile.mock.calls).toEqual([[new Date(0)], [new Date(0)]]);
  await timers.advanceBy(30_000);
  expect(invalidate).not.toHaveBeenCalled();
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(reportError).not.toHaveBeenCalled();
  await cleanup();
  expect(timers.pending).toBe(0);
});
