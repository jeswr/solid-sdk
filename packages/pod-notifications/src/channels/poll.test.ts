// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthFetch } from "@jeswr/storage-client";
import { createLwsBackend } from "@jeswr/storage-client/lws";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, test, vi } from "vitest";
import { FakeTimers } from "../testing.js";
import type { ChangeEvent } from "../types.js";
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
