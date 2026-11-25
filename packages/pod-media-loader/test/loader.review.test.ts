// AUTHORED-BY Claude Sonnet 5.5
// Regression tests for the independent review of 5810c65 (M1-M5, L1-L9, nits).
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMediaLoader, INERT_TYPE, type MediaHandle } from "../src/loader.js";
import {
  avis,
  concat,
  deferred,
  type FakeRead,
  fakeStorage,
  fakeUrls,
  flush,
  gatedStream,
  gifFrames,
  MEDIA,
  png,
  served,
  svg,
} from "./helpers.js";

const LIMITS = { maxBytes: 1 << 20, maxTotalBytes: 8 << 20, maxEntries: 16 };
const at = (name: string) => `${MEDIA}${name}.png`;
type Read = Parameters<typeof fakeStorage>[0];

function rig(overrides: Record<string, unknown> = {}, read?: Read) {
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

afterEach(() => {
  vi.useRealTimers();
});

describe("M1: an abort that lands with the last bytes leaks no object URL", () => {
  test.each([false, true])("detached by invalidate: %s", async (detach) => {
    for (let delay = 0; delay <= 8; delay++) {
      const gate = gatedStream();
      const { loader, urls } = rig({ maxEntries: 1 }, (url) =>
        url.endsWith("probe.png") ? served(png()) : { body: gate.body },
      );
      const ac = new AbortController();
      const pending = loader.acquire(at("a"), { signal: ac.signal });
      await flush();
      if (detach) loader.invalidate(at("a"));
      gate.push(png());
      gate.end();
      for (let i = 0; i < delay; i++) await Promise.resolve();
      ac.abort();
      const result = await pending;
      await flush();
      if (result.ok) result.value.release();
      // A detached read is unreachable once it is abandoned: nothing may remain of it.
      if (detach && !result.ok) expect(urls.live(), `delay ${delay}`).toEqual([]);
      // Whatever remains must be evictable: a hard one-entry budget still admits another read.
      const probe = await loader.acquire(at("probe"));
      expect(probe.ok, `delay ${delay}`).toBe(true);
    }
  });
});

describe("M3/M4 through the loader: pixel bypasses are refused", () => {
  test("a GIF whose frame is far larger than its logical screen", async () => {
    const { loader } = rig({ maxPixels: 1_000_000 }, () =>
      served(gifFrames([1, 1], [[65535, 65535]])),
    );
    expect(await loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  test("an AVIF sequence with a decoy ispe and a huge track", async () => {
    const { loader } = rig({ maxPixels: 1_000_000 }, () =>
      served(avis(60000, 60000, { ispe: [1, 1] })),
    );
    expect(await loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });
});

describe("M5: a hard budget and a bounded number of reads", () => {
  test("held bytes can never exceed maxTotalBytes: the read that does not fit is refused", async () => {
    const size = png().length;
    const { loader } = rig({ maxBytes: size, maxTotalBytes: size * 3, maxEntries: 50 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_v, i) => loader.acquire(at(`n${i}`))),
    );
    const handles = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    expect(handles).toHaveLength(3);
    expect(refused).toHaveLength(17);
    for (const r of refused) expect(r).toMatchObject({ error: { code: "over-budget" } });
    expect(loader.stats().bytes).toBeLessThanOrEqual(size * 3);
    expect(loader.stats().inFlight).toBe(0);
  });

  test("the entry bound is hard too, counting reads in flight", async () => {
    const { loader } = rig({ maxEntries: 2 });
    const results = await Promise.all([1, 2, 3, 4].map((i) => loader.acquire(at(`e${i}`))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.error.code === "over-budget")).toHaveLength(2);
  });

  test("a reservation is returned when a read fails, so later reads fit", async () => {
    const size = png().length;
    let call = 0;
    const { loader } = rig({ maxBytes: size, maxTotalBytes: size }, () => {
      call++;
      if (call === 1) throw { code: "not-found" };
      return served(png());
    });
    expect(await loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect((await loader.acquire(at("b"))).ok).toBe(true);
  });

  test("maxConcurrent limits reads; the rest wait in order", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<FakeRead>());
    const order: string[] = [];
    const { loader } = rig({ maxConcurrent: 2 }, (url, _opts, call) => {
      order.push(url.slice(-6));
      return (gates[call - 1] as { promise: Promise<FakeRead> }).promise;
    });
    const pending = [0, 1, 2, 3, 4].map((i) => loader.acquire(at(`q${i}`)));
    await flush();
    expect(order).toEqual(["q0.png", "q1.png"]);
    (gates[0] as { resolve(v: FakeRead): void }).resolve(served(png()));
    await vi.waitFor(() => expect(order).toEqual(["q0.png", "q1.png", "q2.png"]));
    (gates[1] as { resolve(v: FakeRead): void }).resolve(served(png()));
    (gates[2] as { resolve(v: FakeRead): void }).resolve(served(png()));
    await vi.waitFor(() =>
      expect(order).toEqual(["q0.png", "q1.png", "q2.png", "q3.png", "q4.png"]),
    );
    (gates[3] as { resolve(v: FakeRead): void }).resolve(served(png()));
    (gates[4] as { resolve(v: FakeRead): void }).resolve(served(png()));
    expect((await Promise.all(pending)).every((r) => r.ok)).toBe(true);
  });

  test("a queued read whose waiter aborts never starts, and the queue moves on", async () => {
    const gate = deferred<FakeRead>();
    const { loader, reads } = rig({ maxConcurrent: 1 }, (_url, _opts, call) =>
      call === 1 ? gate.promise : served(png()),
    );
    const first = loader.acquire(at("a"));
    const ac = new AbortController();
    const queued = loader.acquire(at("b"), { signal: ac.signal });
    const third = loader.acquire(at("c"));
    await flush();
    expect(reads).toHaveLength(1);
    ac.abort();
    expect(await queued).toMatchObject({ ok: false, error: { code: "aborted" } });
    gate.resolve(served(png()));
    expect((await first).ok).toBe(true);
    expect((await third).ok).toBe(true);
    expect(reads.map((r) => r.url.slice(-5))).toEqual(["a.png", "c.png"]);
  });

  test("purge cancels queued reads too", async () => {
    const gate = deferred<FakeRead>();
    const { loader, reads } = rig({ maxConcurrent: 1 }, () => gate.promise);
    const first = loader.acquire(at("a"));
    const queued = loader.acquire(at("b"));
    await flush();
    loader.purge();
    expect(await first).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(await queued).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(reads).toHaveLength(1);
  });

  test("the Blob is built from the received chunks", async () => {
    const { loader, urls } = rig();
    const handle = await must(loader.acquire(at("a")));
    expect(new Uint8Array(await urls.blobOf(handle.url).arrayBuffer())).toEqual(png());
  });
});

describe("L1/L2: inert never fails for type or pixels", () => {
  test.each([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ])("an inert caller joining a strict read %i ticks in", async (ticks) => {
    const { loader } = rig({}, () => served(svg()));
    const strict = loader.acquire(at("a"));
    for (let i = 0; i < ticks; i++) await Promise.resolve();
    const inert = await loader.acquire(at("a"), { inert: true });
    expect(await strict).toMatchObject({ ok: false, error: { code: "unsupported-type" } });
    expect(inert.ok && inert.value.contentType).toBe(INERT_TYPE);
  });

  test("an oversized or unreadable image comes back inert instead of failing", async () => {
    const big = rig({ maxPixels: 1000 }, () => served(png(5000, 5000)));
    const result = await big.loader.acquire(at("a"), { inert: true });
    expect(result.ok && result.value.contentType).toBe(INERT_TYPE);
    expect(await big.loader.acquire(at("b"))).toMatchObject({ ok: false });
    const unreadable = rig({}, () => served(png().slice(0, 20)));
    const other = await unreadable.loader.acquire(at("a"), { inert: true });
    expect(other.ok && other.value.contentType).toBe(INERT_TYPE);
  });

  test("inert is still bound by the byte limit", async () => {
    const { loader } = rig({ maxBytes: 10 }, () => served(svg()));
    expect(await loader.acquire(at("a"), { inert: true })).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });
});

describe("L4: the session key guards the cache", () => {
  test("an account switch with no explicit purge serves nothing from the old session", async () => {
    let who = "https://alice.example/profile#me";
    const { loader, reads, urls } = rig({ getSessionKey: () => who });
    const alice = await must(loader.acquire(at("a")));
    expect(reads).toHaveLength(1);
    who = "https://bob.example/profile#me";
    const bob = await must(loader.acquire(at("a")));
    // Re-read as Bob, and Alice's URL is gone for everyone holding it.
    expect(reads).toHaveLength(2);
    expect(bob.url).not.toBe(alice.url);
    expect(urls.revoked).toEqual([alice.url]);
    // Bob's loader is usable, not left purged.
    expect(loader.stats().purged).toBe(false);
  });

  test("a changed key aborts reads in flight before they can install", async () => {
    let who = "alice";
    const gate = deferred<FakeRead>();
    const { loader, urls } = rig({ getSessionKey: () => who }, () => gate.promise);
    const pending = loader.acquire(at("a"));
    await flush();
    who = "bob";
    const other = loader.revalidate(at("zzz"));
    expect(await other).toMatchObject({ ok: true });
    gate.resolve(served(png()));
    expect(await pending).toMatchObject({ ok: false, error: { code: "purged" } });
    expect(urls.created.size).toBe(0);
  });

  test("subscribers are told when the session changes, and revalidate checks it too", async () => {
    let who = "alice";
    const { loader } = rig({ getSessionKey: () => who });
    const seen = vi.fn();
    loader.subscribe(seen);
    await must(loader.acquire(at("a")));
    who = "bob";
    await loader.revalidate(at("a"));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(loader.stats().entries).toBe(0);
  });

  test("an unchanged key never purges; a throwing key function is a closed failure", async () => {
    const { loader, reads } = rig({ getSessionKey: () => "same" });
    (await must(loader.acquire(at("a")))).release();
    (await must(loader.acquire(at("a")))).release();
    expect(reads).toHaveLength(1);
    const broken = rig({
      getSessionKey: () => {
        throw new Error("no session");
      },
    });
    expect(await broken.loader.acquire(at("a"))).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(broken.spy).not.toHaveBeenCalled();
  });
});

describe("L3: purge notifies subscribers synchronously", () => {
  test("listeners run inside purge(); one that throws does not stop the rest; unsubscribe works", async () => {
    const { loader } = rig();
    const order: string[] = [];
    loader.subscribe(() => {
      order.push("bad");
      throw new Error("boom");
    });
    const off = loader.subscribe(() => order.push("good"));
    await must(loader.acquire(at("a")));
    loader.purge();
    expect(order).toEqual(["bad", "good"]);
    off();
    loader.purge();
    expect(order).toEqual(["bad", "good", "bad"]);
  });
});

describe("L5: reads after invalidation and revalidation bypass the HTTP cache", () => {
  test("only reads that follow an invalidation (or revalidate) ask for fresh bytes", async () => {
    const { loader, reads } = rig();
    (await must(loader.acquire(at("a")))).release();
    expect(reads[0]?.opts).not.toHaveProperty("headers");
    loader.invalidate(at("a"));
    (await must(loader.acquire(at("a")))).release();
    expect(reads[1]?.opts).toMatchObject({ headers: { "Cache-Control": "no-cache" } });
    // The flag is spent once the fresh copy is installed.
    loader.invalidate(at("a"));
    loader.purge();
    loader.resume();
    (await must(loader.acquire(at("a")))).release();
    expect(reads[2]?.opts).not.toHaveProperty("headers");
    await loader.revalidate(at("a"));
    expect(reads[3]?.opts).toMatchObject({
      headers: { "Cache-Control": "no-cache" },
      ifNoneMatch: '"v1"',
    });
  });

  test("an invalidated in-flight read keeps the next read fresh", async () => {
    const gate = deferred<FakeRead>();
    const { loader, reads } = rig({}, (_u, _o, call) =>
      call === 1 ? gate.promise : served(png()),
    );
    const first = loader.acquire(at("a"));
    await flush();
    loader.invalidate(at("a"));
    (await must(loader.acquire(at("a")))).release();
    expect(reads[1]?.opts).toMatchObject({ headers: { "Cache-Control": "no-cache" } });
    gate.resolve(served(png()));
    await first;
  });
});

describe("nits", () => {
  test("a signal that is not an AbortSignal fails closed without a phantom waiter", async () => {
    const { loader, reads } = rig();
    const bogus = { aborted: false } as unknown as AbortSignal;
    expect(await loader.acquire(at("a"), { signal: bogus })).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(
      await loader.revalidate(at("a"), { signal: null as unknown as AbortSignal }),
    ).toMatchObject({
      ok: false,
    });
    expect(reads).toHaveLength(0);
    expect(loader.stats()).toMatchObject({ entries: 0, inFlight: 0 });
    // A real acquire afterwards is unaffected and its entry is evictable (no stray hold).
    const handle = await must(loader.acquire(at("a")));
    handle.release();
  });

  test("revalidate reports a purge even when there is nothing cached", async () => {
    const { loader } = rig();
    loader.purge();
    expect(await loader.revalidate(at("a"))).toMatchObject({
      ok: false,
      error: { code: "purged" },
    });
  });

  test("a storage error whose code getter throws is a closed failure, and waiters do not hang", async () => {
    const hostile = {
      get code(): string {
        throw new Error("boom");
      },
    };
    const { loader } = rig({}, () => {
      throw hostile;
    });
    const [a, b] = await Promise.all([loader.acquire(at("a")), loader.acquire(at("a"))]);
    expect(a).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(b).toMatchObject({ ok: false, error: { code: "failed" } });
  });

  test("a read that never finishes is abandoned as offline after readTimeoutMs", async () => {
    vi.useFakeTimers();
    const { loader, reads } = rig(
      { readTimeoutMs: 1000 },
      () => new Promise<FakeRead>(() => undefined),
    );
    const pending = loader.acquire(at("a"));
    await vi.advanceTimersByTimeAsync(999);
    expect(reads[0]?.opts?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toMatchObject({ ok: false, error: { code: "offline" } });
    expect(reads[0]?.opts?.signal?.aborted).toBe(true);
    expect(loader.stats().inFlight).toBe(0);
  });

  test("a body that trickles forever is also abandoned, and a revalidation times out too", async () => {
    vi.useFakeTimers();
    const gate = gatedStream();
    let call = 0;
    const { loader } = rig({ readTimeoutMs: 1000 }, () => {
      call++;
      return call === 1
        ? served(png())
        : call === 2
          ? { body: gate.body }
          : new Promise<FakeRead>(() => undefined);
    });
    (await must(loader.acquire(at("ok")))).release();
    const slow = loader.acquire(at("slow"));
    await vi.advanceTimersByTimeAsync(1100);
    expect(await slow).toMatchObject({ ok: false, error: { code: "offline" } });
    const revalidating = loader.revalidate(at("ok"));
    await vi.advanceTimersByTimeAsync(1100);
    expect(await revalidating).toMatchObject({ ok: false, error: { code: "offline" } });
    // The entry is kept after a transient failure.
    expect(loader.stats().entries).toBe(1);
  });

  test("timers are cleared once a read finishes", async () => {
    vi.useFakeTimers();
    const { loader } = rig();
    (await must(loader.acquire(at("a")))).release();
    await loader.revalidate(at("a"));
    expect(vi.getTimerCount()).toBe(0);
  });

  test("invalid creation options and containers throw fixed-message errors", () => {
    const fake = fakeStorage(() => served(png()));
    expect(() =>
      createMediaLoader({
        storage: fake.storage,
        scope: ["https://pod.example/a%2fb/"],
        ...LIMITS,
      }),
    ).toThrow(new TypeError("scope containers must be absolute http(s) container URLs"));
    for (const bad of [{ maxConcurrent: 0 }, { readTimeoutMs: 0 }, { maxPixels: 1.5 }]) {
      expect(() =>
        createMediaLoader({ storage: fake.storage, scope: [MEDIA], ...LIMITS, ...bad }),
      ).toThrow(RangeError);
    }
  });

  test("a PNG that mentions html in a text chunk is still a PNG (type from magic only)", async () => {
    const withText = concat(png(), "<html><body onload=alert(1)>");
    const { loader, urls } = rig({}, () => served(withText));
    const handle = await must(loader.acquire(at("a")));
    expect(urls.blobOf(handle.url).type).toBe("image/png");
  });
});
