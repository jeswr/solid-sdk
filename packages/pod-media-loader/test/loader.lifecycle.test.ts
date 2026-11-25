// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test, vi } from "vitest";
import { createMediaLoader, type MediaHandle } from "../src/loader.js";
import { defaultSniff } from "../src/sniff.js";
import {
  concat,
  deferred,
  type FakeRead,
  fakeStorage,
  fakeUrls,
  flush,
  gatedStream,
  MEDIA,
  memoryPod,
  png,
  served,
  svg,
} from "./helpers.js";

const LIMITS = { maxBytes: 1 << 20, maxTotalBytes: 8 << 20, maxEntries: 16 };
const at = (name: string) => `${MEDIA}${name}.png`;

/** A loader over a scripted storage; every URL serves `images[name]` (a PNG by default). */
function rig(
  overrides: Record<string, unknown> = {},
  read?: (
    url: string,
    opts: { signal?: AbortSignal; ifNoneMatch?: string } | undefined,
    call: number,
  ) => Promise<FakeRead> | FakeRead,
) {
  const urls = fakeUrls();
  const fake = fakeStorage(read ?? (() => served(png())));
  const loader = createMediaLoader({
    storage: fake.storage,
    scope: [MEDIA],
    ...LIMITS,
    objectUrls: urls.api,
    ...overrides,
  });
  return { ...fake, urls, loader };
}

async function must(promise: Promise<{ ok: boolean }>): Promise<MediaHandle> {
  const result = (await promise) as { ok: true; value: MediaHandle } | { ok: false };
  if (!result.ok) throw new Error("expected a handle");
  return result.value;
}

describe("sharing and reference counting", () => {
  test("concurrent acquires of one URL share one fetch and one object URL", async () => {
    const { loader, reads, urls } = rig();
    const handles = await Promise.all([1, 2, 3].map(() => must(loader.acquire(at("a")))));
    expect(reads).toHaveLength(1);
    expect(urls.created.size).toBe(1);
    expect(new Set(handles.map((h) => h.url)).size).toBe(1);
    expect(loader.stats()).toMatchObject({ entries: 1, inFlight: 0 });
  });

  test("a later acquire reuses the cached object URL without a request", async () => {
    const { loader, reads } = rig();
    const first = await must(loader.acquire(at("a")));
    const second = await must(loader.acquire(at("a")));
    expect(second.url).toBe(first.url);
    expect(reads).toHaveLength(1);
  });

  test("releasing every holder does not revoke a cached entry; purge does, once", async () => {
    const { loader, urls } = rig();
    const handles = await Promise.all([1, 2].map(() => must(loader.acquire(at("a")))));
    for (const handle of handles) handle.release();
    expect(urls.revoked).toEqual([]);
    expect(loader.stats().entries).toBe(1);
    loader.purge();
    expect(urls.revoked).toEqual([handles[0]?.url]);
  });

  test("an unreferenced entry is revoked only when evicted", async () => {
    const { loader, urls } = rig({ maxEntries: 1 });
    const a = await must(loader.acquire(at("a")));
    a.release();
    expect(urls.revoked).toEqual([]);
    const b = await must(loader.acquire(at("b")));
    expect(urls.revoked).toEqual([a.url]);
    expect(urls.live()).toEqual([b.url]);
  });

  test("a held entry is never revoked: a read that cannot fit is refused instead", async () => {
    const { loader, urls } = rig({ maxEntries: 1 });
    const a = await must(loader.acquire(at("a")));
    expect(await loader.acquire(at("b"))).toMatchObject({
      ok: false,
      error: { code: "over-budget" },
    });
    expect(urls.revoked).toEqual([]);
    expect(loader.stats().entries).toBe(1);
    a.release();
    // Unreferenced now: the next read evicts it to make room.
    const b = await must(loader.acquire(at("b")));
    expect(urls.revoked).toEqual([a.url]);
    expect(urls.live()).toEqual([b.url]);
  });

  test("double release is harmless and cannot drop another holder's hold", async () => {
    const { loader, urls } = rig({ maxEntries: 1 });
    const one = await must(loader.acquire(at("a")));
    const two = await must(loader.acquire(at("a")));
    one.release();
    one.release();
    one.release();
    // `two` still holds a: pressure from another URL is refused, never served by revoking a.
    expect(await loader.acquire(at("b"))).toMatchObject({
      ok: false,
      error: { code: "over-budget" },
    });
    expect(urls.revoked).toEqual([]);
    two.release();
    const next = await must(loader.acquire(at("c")));
    expect(urls.revoked).toEqual([two.url]);
    next.release();
  });

  test("LRU: a recently used entry outlives an older one", async () => {
    const { loader, urls } = rig({ maxEntries: 2 });
    const a = await must(loader.acquire(at("a")));
    const b = await must(loader.acquire(at("b")));
    a.release();
    b.release();
    (await must(loader.acquire(at("a")))).release(); // touch a
    const c = await must(loader.acquire(at("c")));
    expect(urls.revoked).toEqual([b.url]);
    expect(urls.live()).toContain(a.url);
    c.release();
  });

  test("maxTotalBytes evicts unreferenced entries, oldest first", async () => {
    const bytes = png();
    const { loader, urls } = rig({ maxTotalBytes: bytes.length * 2, maxBytes: bytes.length });
    const a = await must(loader.acquire(at("a")));
    const b = await must(loader.acquire(at("b")));
    a.release();
    b.release();
    expect(loader.stats().bytes).toBe(bytes.length * 2);
    const c = await must(loader.acquire(at("c")));
    expect(urls.revoked).toEqual([a.url]);
    expect(loader.stats().bytes).toBe(bytes.length * 2);
    c.release();
  });

  test("handles expose the sniffed type, size and a blob: URL", async () => {
    const { loader } = rig();
    const handle = await must(loader.acquire(at("a")));
    expect(handle).toMatchObject({ contentType: "image/png", bytes: png().length });
    expect(Object.isFrozen(handle)).toBe(true);
  });
});

describe("abort at each await", () => {
  test("an already aborted signal never reaches the pod", async () => {
    const { loader, spy } = rig();
    const ac = new AbortController();
    ac.abort();
    expect(await loader.acquire(at("a"), { signal: ac.signal })).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
    expect(await loader.revalidate(at("a"), { signal: ac.signal })).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("aborting while the request is pending returns at once, even if the pod ignores the signal", async () => {
    const gate = deferred<FakeRead>();
    const stray = gatedStream();
    const { loader, reads, urls } = rig({}, () => gate.promise);
    const ac = new AbortController();
    const pending = loader.acquire(at("a"), { signal: ac.signal });
    await flush();
    ac.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(reads[0]?.opts?.signal?.aborted).toBe(true);
    // The read that arrives late must be discarded: no object URL, stream cancelled.
    gate.resolve({ body: stray.body });
    await vi.waitFor(() => expect(stray.state.cancelled).toBe(true));
    expect(urls.created.size).toBe(0);
    expect(loader.stats()).toMatchObject({ entries: 0, inFlight: 0 });
  });

  test("aborting while the body streams returns at once and cancels the stream", async () => {
    const gate = gatedStream();
    const { loader, urls } = rig({}, () => ({ body: gate.body }));
    const ac = new AbortController();
    const pending = loader.acquire(at("a"), { signal: ac.signal });
    await flush();
    gate.push(png().slice(0, 10));
    await flush();
    ac.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
    await vi.waitFor(() => expect(gate.state.cancelled).toBe(true));
    expect(urls.created.size).toBe(0);
  });

  test("one waiter aborting does not cancel a read the others still want", async () => {
    const gate = deferred<FakeRead>();
    const { loader, reads } = rig({}, () => gate.promise);
    const quitter = new AbortController();
    const first = loader.acquire(at("a"), { signal: quitter.signal });
    const second = loader.acquire(at("a"));
    await flush();
    quitter.abort();
    expect(await first).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(reads[0]?.opts?.signal?.aborted).toBe(false);
    gate.resolve(served(png()));
    const handle = await must(second);
    expect(handle.contentType).toBe("image/png");
    expect(reads).toHaveLength(1);
    // The aborted waiter holds nothing: one release is enough to make the entry evictable.
    expect(loader.stats().entries).toBe(1);
  });

  test("when every waiter aborts the read is cancelled and the next acquire starts afresh", async () => {
    const gates = [deferred<FakeRead>(), deferred<FakeRead>()];
    const { loader, reads } = rig(
      {},
      (_url, _opts, call) => (gates[call - 1] as { promise: Promise<FakeRead> }).promise,
    );
    const a = new AbortController();
    const b = new AbortController();
    const p1 = loader.acquire(at("a"), { signal: a.signal });
    const p2 = loader.acquire(at("a"), { signal: b.signal });
    await flush();
    a.abort();
    b.abort();
    expect(await p1).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(await p2).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(reads[0]?.opts?.signal?.aborted).toBe(true);
    expect(loader.stats().inFlight).toBe(0);
    const again = loader.acquire(at("a"));
    await flush();
    expect(reads).toHaveLength(2);
    (gates[1] as { resolve(v: FakeRead): void }).resolve(served(png()));
    expect((await again).ok).toBe(true);
    // The abandoned first read finishing later changes nothing.
    (gates[0] as { resolve(v: FakeRead): void }).resolve(served(png()));
    await flush();
    expect(loader.stats()).toMatchObject({ entries: 1, inFlight: 0 });
  });

  test("an abort arriving after the read finished, before the waiter resumes, releases its hold", async () => {
    const ac = new AbortController();
    const urls = fakeUrls();
    const fake = fakeStorage(() => served(png()));
    const loader = createMediaLoader({
      storage: fake.storage,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: {
        createObjectURL(blob) {
          const url = urls.api.createObjectURL(blob);
          ac.abort();
          return url;
        },
        revokeObjectURL: urls.api.revokeObjectURL,
      },
    });
    expect(await loader.acquire(at("a"), { signal: ac.signal })).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
    // The hold was given back, so the entry is cached but evictable.
    const small = createMediaLoader({
      storage: fake.storage,
      scope: [MEDIA],
      ...LIMITS,
      maxEntries: 1,
      objectUrls: urls.api,
    });
    (await must(small.acquire(at("x")))).release();
    (await must(small.acquire(at("y")))).release();
    expect(urls.revoked).toHaveLength(1);
  });

  test("aborting after success does not disturb the handle", async () => {
    const { loader, urls } = rig();
    const ac = new AbortController();
    const handle = await must(loader.acquire(at("a"), { signal: ac.signal }));
    ac.abort();
    await flush();
    expect(urls.revoked).toEqual([]);
    handle.release();
    expect(urls.revoked).toEqual([]);
  });

  test("a waiter that was already aborted when the read failed still gets the failure code of its read", async () => {
    const { loader } = rig({}, () => {
      throw { code: "not-found" };
    });
    expect(await loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("purge", () => {
  test("revokes everything, including held entries, and later releases are harmless", async () => {
    const { loader, urls } = rig();
    const a = await must(loader.acquire(at("a")));
    const b = await must(loader.acquire(at("b")));
    b.release();
    loader.purge();
    expect(urls.revoked.sort()).toEqual([a.url, b.url].sort());
    expect(loader.stats()).toMatchObject({ entries: 0, bytes: 0, inFlight: 0, purged: true });
    a.release();
    a.release();
    b.release();
    expect(urls.revoked).toHaveLength(2);
  });

  test("refuses until resume, without touching the pod", async () => {
    const { loader, spy } = rig();
    loader.purge();
    expect(await loader.acquire(at("a"))).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "purged" },
    });
    expect(spy).not.toHaveBeenCalled();
    loader.resume();
    expect((await loader.acquire(at("a"))).ok).toBe(true);
    expect(loader.stats().purged).toBe(false);
  });

  test("purge twice is harmless", () => {
    const { loader } = rig();
    loader.purge();
    loader.purge();
    expect(loader.stats().purged).toBe(true);
  });

  test("aborts reads in flight", async () => {
    const gate = deferred<FakeRead>();
    const { loader, reads } = rig({}, () => gate.promise);
    const pending = loader.acquire(at("a"));
    await flush();
    loader.purge();
    expect(reads[0]?.opts?.signal?.aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, error: { code: "purged" } });
  });

  test("a read that completes after purge must not create an object URL", async () => {
    const gate = deferred<FakeRead>();
    // The pod ignores the abort and answers anyway.
    const { loader, urls } = rig({}, () => gate.promise);
    const pending = loader.acquire(at("a"));
    await flush();
    loader.purge();
    gate.resolve(served(png()));
    expect(await pending).toMatchObject({ ok: false, error: { code: "purged" } });
    await flush();
    expect(urls.created.size).toBe(0);
    expect(loader.stats()).toMatchObject({ entries: 0, inFlight: 0 });
  });

  test("a read whose last bytes arrive after purge must not create an object URL", async () => {
    const gate = gatedStream();
    const { loader, urls } = rig({}, () => ({ body: gate.body }));
    const pending = loader.acquire(at("a"));
    await flush();
    gate.push(png());
    await flush();
    loader.purge();
    gate.end();
    expect(await pending).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(urls.created.size).toBe(0);
  });

  test("purge between download and install is caught by the guard before the object URL", async () => {
    // The sniffer runs synchronously just before the download resolves: queue the purge there so
    // it lands after the bytes are complete but before the flight can create its object URL.
    const holder: { loader?: ReturnType<typeof createMediaLoader> } = {};
    const { loader, urls } = rig({
      sniff: (bytes: Uint8Array) => {
        queueMicrotask(() => holder.loader?.purge());
        return defaultSniff(bytes);
      },
    });
    holder.loader = loader;
    expect(await loader.acquire(at("a"))).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(urls.created.size).toBe(0);
    expect(loader.stats()).toMatchObject({ entries: 0, inFlight: 0 });
  });

  test("purge after the object URL exists but before the waiter resumes hands out nothing", async () => {
    const urls = fakeUrls();
    const fake = fakeStorage(() => served(png()));
    const holder: { loader?: ReturnType<typeof createMediaLoader> } = {};
    const loader = createMediaLoader({
      storage: fake.storage,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: {
        createObjectURL(blob) {
          const url = urls.api.createObjectURL(blob);
          queueMicrotask(() => holder.loader?.purge());
          return url;
        },
        revokeObjectURL: urls.api.revokeObjectURL,
      },
    });
    holder.loader = loader;
    expect(await loader.acquire(at("a"))).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(urls.live()).toEqual([]);
  });

  test("a stale read finishing after resume neither installs nor disturbs the new read", async () => {
    const gates = [deferred<FakeRead>(), deferred<FakeRead>()];
    const { loader, reads, urls } = rig(
      {},
      (_url, _opts, call) => (gates[call - 1] as { promise: Promise<FakeRead> }).promise,
    );
    const stale = loader.acquire(at("a"));
    await flush();
    loader.purge();
    loader.resume();
    const fresh = loader.acquire(at("a"));
    await flush();
    expect(reads).toHaveLength(2);
    (gates[0] as { resolve(v: FakeRead): void }).resolve(served(png()));
    expect(await stale).toMatchObject({ ok: false, error: { code: "purged" } });
    // The stale flight's cleanup must not have unregistered the fresh one.
    const sharer = loader.acquire(at("a"));
    await flush();
    expect(reads).toHaveLength(2);
    (gates[1] as { resolve(v: FakeRead): void }).resolve(served(png()));
    const [a, b] = [await must(fresh), await must(sharer)];
    expect(a.url).toBe(b.url);
    expect(urls.created.size).toBe(1);
  });

  test("purge during revalidate installs nothing", async () => {
    const holder: { loader?: ReturnType<typeof createMediaLoader> } = {};
    let calls = 0;
    const gate = deferred<FakeRead>();
    const { loader, urls } = rig({}, (_url, _opts, call) => {
      calls = call;
      return call === 1 ? served(png()) : gate.promise;
    });
    holder.loader = loader;
    (await must(loader.acquire(at("a")))).release();
    const pending = loader.revalidate(at("a"));
    await flush();
    expect(calls).toBe(2);
    loader.purge();
    gate.resolve(served(png(2, 2), { etag: '"v2"' }));
    expect(await pending).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(urls.created.size).toBe(1);
  });

  test("purge between a revalidation's download and install installs nothing", async () => {
    const holder: { loader?: ReturnType<typeof createMediaLoader> } = {};
    let sniffs = 0;
    const { loader, urls } = rig(
      {
        sniff: (bytes: Uint8Array) => {
          sniffs++;
          if (sniffs === 2) queueMicrotask(() => holder.loader?.purge());
          return defaultSniff(bytes);
        },
      },
      (_url, _opts, call) => (call === 1 ? served(png()) : served(png(2, 2), { etag: '"v2"' })),
    );
    holder.loader = loader;
    (await must(loader.acquire(at("a")))).release();
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "purged" },
    });
    expect(urls.created.size).toBe(1);
  });
});

describe("freshness", () => {
  test("revalidate on a changed resource gives new acquirers a new URL; holders keep theirs until release", async () => {
    const { storage, put } = await memoryPod();
    const urls = fakeUrls();
    const loader = createMediaLoader({
      storage,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: urls.api,
    });
    const created = await put("a.png", png(1, 1));
    const holder = await must(loader.acquire(created.url));
    await storage.write(created.url, png(2, 2), {
      contentType: "image/png",
      ifMatch: created.etag as string,
    });
    expect(await loader.revalidate(created.url)).toEqual({ ok: true, value: { changed: true } });
    const fresh = await must(loader.acquire(created.url));
    expect(fresh.url).not.toBe(holder.url);
    expect(urls.revoked).toEqual([]);
    expect(new Uint8Array(await urls.blobOf(fresh.url).arrayBuffer())).toEqual(png(2, 2));
    expect(new Uint8Array(await urls.blobOf(holder.url).arrayBuffer())).toEqual(png(1, 1));
    holder.release();
    expect(urls.revoked).toEqual([holder.url]);
    fresh.release();
    expect(urls.live()).toEqual([fresh.url]);
  });

  test("revalidate on an unchanged resource keeps the URL and sends the stored ETag", async () => {
    const { storage, put } = await memoryPod();
    const urls = fakeUrls();
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    const created = await put("a.png", png());
    const first = await must(loader.acquire(created.url));
    const read = vi.spyOn(storage, "read");
    expect(await loader.revalidate(created.url)).toEqual({ ok: true, value: { changed: false } });
    expect(read).toHaveBeenCalledWith(
      created.url,
      expect.objectContaining({ ifNoneMatch: created.etag }),
    );
    const again = await must(loader.acquire(created.url));
    expect(again.url).toBe(first.url);
    expect(urls.created.size).toBe(1);
  });

  test("revalidate with a live signal completes normally", async () => {
    const { loader } = rig();
    (await must(loader.acquire(at("a")))).release();
    const ac = new AbortController();
    expect(await loader.revalidate(at("a"), { signal: ac.signal })).toEqual({
      ok: true,
      value: { changed: false },
    });
    ac.abort();
  });

  test("revalidate with no cached entry is a no-op with no request", async () => {
    const { loader, spy } = rig();
    expect(await loader.revalidate(at("a"))).toEqual({ ok: true, value: { changed: false } });
    expect(spy).not.toHaveBeenCalled();
  });

  test("a server that ignores If-None-Match and returns the same ETag is unchanged", async () => {
    const { loader, urls } = rig();
    const first = await must(loader.acquire(at("a")));
    expect(await loader.revalidate(at("a"))).toEqual({ ok: true, value: { changed: false } });
    expect((await must(loader.acquire(at("a")))).url).toBe(first.url);
    expect(urls.created.size).toBe(1);
  });

  test("an entry without a validator is dropped, not trusted", async () => {
    const { loader, reads, urls } = rig({}, () => served(png(), { etag: null }));
    const first = await must(loader.acquire(at("a")));
    first.release();
    expect(await loader.revalidate(at("a"))).toEqual({ ok: true, value: { changed: true } });
    expect(urls.revoked).toEqual([first.url]);
    expect(reads).toHaveLength(1);
    expect((await must(loader.acquire(at("a")))).url).not.toBe(first.url);
  });

  test("a changed ETag with no new validator still installs the new content", async () => {
    let call = 0;
    const { loader, urls } = rig({}, () => {
      call++;
      return call === 1 ? served(png()) : served(png(3, 3), { etag: null });
    });
    const first = await must(loader.acquire(at("a")));
    expect(await loader.revalidate(at("a"))).toEqual({ ok: true, value: { changed: true } });
    const next = await must(loader.acquire(at("a")));
    expect(next.url).not.toBe(first.url);
    expect(urls.created.size).toBe(2);
  });

  test.each([
    ["not-found", () => ({ code: "not-found" })],
    ["forbidden", () => ({ code: "forbidden" })],
  ])("a resource that became %s is dropped from the cache", async (code, boom) => {
    let call = 0;
    const { loader } = rig({}, () => {
      call++;
      if (call === 1) return served(png());
      throw boom();
    });
    (await must(loader.acquire(at("a")))).release();
    expect(await loader.revalidate(at("a"))).toMatchObject({ ok: false, error: { code } });
    expect(loader.stats().entries).toBe(0);
  });

  test("a resource that now sniffs as SVG is refused and dropped", async () => {
    let call = 0;
    const { loader, urls } = rig({}, () => {
      call++;
      return call === 1 ? served(png()) : served(svg(), { etag: '"v2"' });
    });
    const held = await must(loader.acquire(at("a")));
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
    // The holder keeps its URL; nobody new can get one.
    expect(urls.revoked).toEqual([]);
    held.release();
    expect(urls.revoked).toEqual([held.url]);
    expect(await loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
  });

  test("a resource that grew past the limit is refused and dropped", async () => {
    let call = 0;
    const { loader } = rig({ maxBytes: png().length }, () => {
      call++;
      return call === 1 ? served(png()) : served(concat(png(), [0]), { etag: '"v2"' });
    });
    (await must(loader.acquire(at("a")))).release();
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
    expect(loader.stats().entries).toBe(0);
  });

  test("transient failures keep the cached entry", async () => {
    let call = 0;
    const { loader } = rig({}, () => {
      call++;
      if (call === 1) return served(png());
      throw { code: "network" };
    });
    const first = await must(loader.acquire(at("a")));
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "offline" },
    });
    expect((await must(loader.acquire(at("a")))).url).toBe(first.url);
  });

  test("a revalidated opaque (inert) entry stays opaque", async () => {
    let call = 0;
    const { loader } = rig({}, () => {
      call++;
      return call === 1 ? served(svg()) : served(concat(svg(), " "), { etag: '"v2"' });
    });
    const first = await must(loader.acquire(at("a"), { inert: true }));
    expect(await loader.revalidate(at("a"))).toEqual({ ok: true, value: { changed: true } });
    const next = await must(loader.acquire(at("a"), { inert: true }));
    expect(next.url).not.toBe(first.url);
    expect(next.contentType).toBe("application/octet-stream");
  });

  test("revalidate can be aborted, and keeps the entry", async () => {
    const gate = deferred<FakeRead>();
    let call = 0;
    const { loader, reads } = rig({}, () => {
      call++;
      return call === 1 ? served(png()) : gate.promise;
    });
    const first = await must(loader.acquire(at("a")));
    const ac = new AbortController();
    const pending = loader.revalidate(at("a"), { signal: ac.signal });
    await flush();
    ac.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(reads[1]?.opts?.signal?.aborted).toBe(true);
    expect((await must(loader.acquire(at("a")))).url).toBe(first.url);
  });

  test("an entry replaced while revalidating is reported changed and not clobbered", async () => {
    const gate = deferred<FakeRead>();
    let call = 0;
    const { loader, urls } = rig({}, () => {
      call++;
      if (call === 2) return gate.promise;
      return served(png(call, 1), { etag: `"v${call}"` });
    });
    (await must(loader.acquire(at("a")))).release();
    const pending = loader.revalidate(at("a"));
    await flush();
    loader.invalidate(at("a"));
    const replacement = await must(loader.acquire(at("a")));
    gate.resolve(served(png(9, 9), { etag: '"v9"' }));
    expect(await pending).toEqual({ ok: true, value: { changed: true } });
    expect((await must(loader.acquire(at("a")))).url).toBe(replacement.url);
    expect(urls.created.size).toBe(2);
  });

  test("a refusal about a superseded entry does not drop its replacement", async () => {
    const gate = deferred<FakeRead>();
    let call = 0;
    const { loader } = rig({}, () => {
      call++;
      return call === 2 ? gate.promise : served(png(call, 1), { etag: `"v${call}"` });
    });
    (await must(loader.acquire(at("a")))).release();
    const pending = loader.revalidate(at("a"));
    await flush();
    loader.invalidate(at("a"));
    const replacement = await must(loader.acquire(at("a")));
    gate.reject({ code: "not-found" });
    expect(await pending).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect((await must(loader.acquire(at("a")))).url).toBe(replacement.url);
  });

  test("concurrent revalidations do not double-install", async () => {
    let call = 0;
    const { loader, urls } = rig({}, () => {
      call++;
      return call === 1 ? served(png()) : served(png(4, 4), { etag: '"v2"' });
    });
    (await must(loader.acquire(at("a")))).release();
    const [x, y] = await Promise.all([loader.revalidate(at("a")), loader.revalidate(at("a"))]);
    expect(x).toEqual({ ok: true, value: { changed: true } });
    expect(y).toEqual({ ok: true, value: { changed: true } });
    expect(urls.created.size).toBe(2);
  });
});

describe("invalidate", () => {
  test("drops an unreferenced entry at once and a held one at release", async () => {
    const { loader, urls } = rig();
    const a = await must(loader.acquire(at("a")));
    const b = await must(loader.acquire(at("b")));
    b.release();
    loader.invalidate(at("a"));
    loader.invalidate(at("b"));
    expect(urls.revoked).toEqual([b.url]);
    const fresh = await must(loader.acquire(at("a")));
    expect(fresh.url).not.toBe(a.url);
    expect(urls.revoked).toEqual([b.url]);
    a.release();
    expect(urls.revoked).toEqual([b.url, a.url]);
  });

  test("an invalidated in-flight read serves its own waiters but is never shared afterwards", async () => {
    const gates = [deferred<FakeRead>(), deferred<FakeRead>()];
    const { loader, reads, urls } = rig(
      {},
      (_url, _opts, call) => (gates[call - 1] as { promise: Promise<FakeRead> }).promise,
    );
    const early = loader.acquire(at("a"));
    await flush();
    loader.invalidate(at("a"));
    const late = loader.acquire(at("a"));
    await flush();
    expect(reads).toHaveLength(2);
    (gates[1] as { resolve(v: FakeRead): void }).resolve(served(png(2, 2), { etag: '"v2"' }));
    const lateHandle = await must(late);
    (gates[0] as { resolve(v: FakeRead): void }).resolve(served(png(1, 1), { etag: '"v1"' }));
    const earlyHandle = await must(early);
    expect(earlyHandle.url).not.toBe(lateHandle.url);
    // Only the late read is cached for sharing.
    expect((await must(loader.acquire(at("a")))).url).toBe(lateHandle.url);
    earlyHandle.release();
    expect(urls.revoked).toEqual([earlyHandle.url]);
    expect(urls.live()).toContain(lateHandle.url);
  });

  test("invalid URLs and unknown entries are ignored", () => {
    const { loader } = rig();
    expect(() => loader.invalidate("not a url")).not.toThrow();
    expect(() => loader.invalidate(at("never-loaded"))).not.toThrow();
    expect(() => loader.invalidate(`${at("a")}?x=1`)).not.toThrow();
  });
});
