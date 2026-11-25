// AUTHORED-BY Claude Sonnet 5.5
// The hard byte budget with header-time reservations, the FIFO wait queue, and its fairness.
import type { StorageClient } from "@jeswr/storage-client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createMediaLoader,
  DEFAULT_ASSUMED_BYTES,
  DEFAULT_BUDGET_WAIT_MS,
  HEAD_BYPASS_LIMIT,
  type MediaHandle,
  type MediaLoader,
  type MediaLoaderEvent,
} from "../src/loader.js";
import {
  deferred,
  type FakeRead,
  fakeStorage,
  fakeUrls,
  flush,
  gatedStream,
  MEDIA,
  padded,
  png,
  probedStream,
  ROOT,
  served,
} from "./helpers.js";

const LIMITS = { maxBytes: 100_000, maxTotalBytes: 300_000, maxEntries: 200, assumedBytes: 1000 };
const at = (name: string) => `${MEDIA}${name}.png`;
const tile = (n = 1000): Uint8Array => padded(png(), n);
const sized = (n: number, extra: FakeRead = {}): FakeRead =>
  served(tile(n), { contentLength: n, ...extra });
type Read = Parameters<typeof fakeStorage>[0];

function rig(overrides: Record<string, unknown> = {}, read?: Read) {
  const urls = fakeUrls();
  const fake = fakeStorage(read ?? (() => sized(1000)));
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

const code = (result: { ok: boolean }): string | undefined =>
  result.ok ? undefined : (result as unknown as { error: { code: string } }).error.code;

afterEach(() => {
  vi.useRealTimers();
});

describe("reservation is the declared length, taken once headers arrive", () => {
  test("a declared Content-Length is reserved, not maxBytes", async () => {
    const gate = gatedStream();
    const { loader } = rig({}, () => ({ body: gate.body, contentLength: 50_000 }));
    const pending = loader.acquire(at("a"));
    await flush();
    expect(loader.stats().reservedBytes).toBe(50_000);
    gate.push(tile(50_000));
    gate.end();
    await must(pending);
    expect(loader.stats()).toMatchObject({ reservedBytes: 0, bytes: 50_000, waiting: 0 });
  });

  test("a 50-tile grid loads completely with a budget that held only three reads before", async () => {
    // Old scheme: every read reserved maxBytes (25 MiB) of a 128 MiB budget: five reads fit.
    const { loader } = rig(
      { maxBytes: 25 << 20, maxTotalBytes: 128 << 20, assumedBytes: undefined },
      () => sized(2000),
    );
    const results = await Promise.all(
      Array.from({ length: 50 }, (_v, i) => loader.acquire(at(`t${i}`))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(loader.stats()).toMatchObject({ entries: 50, bytes: 100_000, reservedBytes: 0 });
  });

  test("with no length at all the grid still loads, on the default assumed size", async () => {
    const { loader } = rig(
      { assumedBytes: undefined, maxBytes: 25 << 20, maxTotalBytes: 128 << 20 },
      () => served(tile(2000)),
    );
    const results = await Promise.all(
      Array.from({ length: 50 }, (_v, i) => loader.acquire(at(`t${i}`))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(DEFAULT_ASSUMED_BYTES).toBe(1 << 20);
  });

  test("a declared length above maxBytes is refused before the body is read", async () => {
    for (const inert of [false, true]) {
      const gate = gatedStream();
      const { loader } = rig({}, () => ({ body: gate.body, contentLength: 100_001 }));
      const result = await loader.acquire(at("a"), { inert });
      expect(code(result)).toBe("too-large");
      expect(gate.state.cancelled).toBe(true);
      expect(loader.stats()).toMatchObject({ reservedBytes: 0, inFlight: 0 });
    }
  });

  test("reads waiting on headers reserve nothing and are bounded by maxConcurrent", async () => {
    const gates = Array.from({ length: 10 }, () => deferred<FakeRead>());
    const { loader, reads } = rig({ maxConcurrent: 3 }, (_u, _o, call) => {
      return (gates[call - 1] as { promise: Promise<FakeRead> }).promise;
    });
    const pending = gates.map((_g, i) => loader.acquire(at(`h${i}`)));
    await flush();
    expect(reads).toHaveLength(3);
    expect(loader.stats()).toMatchObject({ reservedBytes: 0, waiting: 0, inFlight: 10 });
    for (const gate of gates) gate.resolve(sized(1000));
    expect((await Promise.all(pending)).every((r) => r.ok)).toBe(true);
  });

  test.each([
    ["NaN", Number.NaN],
    ["negative", -5],
    ["fractional", 1.5],
    ["a string", "1000"],
    ["null", null],
  ])("an unusable declared length (%s) falls back to assumedBytes", async (_name, declared) => {
    const gate = gatedStream();
    const { loader } = rig({}, () => ({
      body: gate.body,
      contentLength: declared as number | null,
    }));
    const pending = loader.acquire(at("a"));
    await flush();
    expect(loader.stats().reservedBytes).toBe(1000);
    gate.push(tile(300));
    gate.end();
    await must(pending);
  });

  test("assumedBytes is capped at maxBytes", async () => {
    const gate = gatedStream();
    const { loader } = rig({ maxBytes: 5000, assumedBytes: 1_000_000 }, () => ({
      body: gate.body,
    }));
    const pending = loader.acquire(at("a"));
    await flush();
    expect(loader.stats().reservedBytes).toBe(5000);
    gate.push(tile(300));
    gate.end();
    await must(pending);
  });

  test("a declared zero reserves one byte and still grows", async () => {
    const seen: number[] = [];
    const ref: { loader?: MediaLoader } = {};
    const made = rig({}, () => ({
      body: probedStream(tile(500), 500, () => seen.push(ref.loader?.stats().reservedBytes ?? -1)),
      contentLength: 0,
    }));
    ref.loader = made.loader;
    await must(made.loader.acquire(at("a")));
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(500);
  });
});

describe("the reservation grows with the bytes that actually arrive", () => {
  test("absent length: doubling steps, never above the budget at any pull", async () => {
    const seen: number[] = [];
    const ref: { loader?: MediaLoader } = {};
    const made = rig({ maxTotalBytes: 50_000 }, () => ({
      body: probedStream(tile(5000), 300, () => {
        const s = (ref.loader as MediaLoader).stats();
        expect(s.bytes + s.reservedBytes).toBeLessThanOrEqual(50_000);
        seen.push(s.reservedBytes);
      }),
    }));
    ref.loader = made.loader;
    await must(made.loader.acquire(at("a")));
    expect([...new Set(seen)]).toEqual([1000, 2000, 4000, 8000]);
    expect(made.loader.stats()).toMatchObject({ reservedBytes: 0, bytes: 5000 });
  });

  test("the reservation never grows past maxBytes", async () => {
    const seen: number[] = [];
    const ref: { loader?: MediaLoader } = {};
    const made = rig({ maxBytes: 5000, maxTotalBytes: 100_000 }, () => ({
      body: probedStream(tile(4200), 300, () =>
        seen.push((ref.loader as MediaLoader).stats().reservedBytes),
      ),
    }));
    ref.loader = made.loader;
    await must(made.loader.acquire(at("a")));
    expect(Math.max(...seen)).toBe(5000);
  });

  test("a lying (too small) Content-Length grows to the real size", async () => {
    const { loader } = rig({}, () => ({
      body: probedStream(tile(5000), 5000, () => undefined),
      contentLength: 10,
    }));
    const handle = await must(loader.acquire(at("a")));
    expect(handle.bytes).toBe(5000);
    expect(loader.stats()).toMatchObject({ reservedBytes: 0, bytes: 5000 });
  });

  test("growth that cannot fit aborts the read with over-budget and frees the reservation", async () => {
    let call = 0;
    const gate = gatedStream();
    const { loader } = rig({ maxTotalBytes: 6000, maxBytes: 6000 }, () => {
      call++;
      return call === 1 ? sized(4000) : { body: gate.body, contentLength: 10 };
    });
    const held = await must(loader.acquire(at("pinned")));
    const pending = loader.acquire(at("liar"));
    await flush();
    expect(loader.stats().reservedBytes).toBe(10);
    gate.push(tile(5000));
    expect(code(await pending)).toBe("over-budget");
    expect(gate.state.cancelled).toBe(true);
    expect(loader.stats()).toMatchObject({ reservedBytes: 0, bytes: 4000 });
    held.release();
  });

  test("when doubling does not fit the reservation grows exactly, until nothing fits", async () => {
    const run = async (bodyLength: number) => {
      const seen: number[] = [];
      const ref: { loader?: MediaLoader } = {};
      let call = 0;
      const made = rig({ maxTotalBytes: 4500, maxBytes: 4500 }, () => {
        call++;
        if (call === 1) return sized(3000);
        return {
          body: probedStream(tile(bodyLength), 200, () =>
            seen.push((ref.loader as MediaLoader).stats().reservedBytes),
          ),
        };
      });
      ref.loader = made.loader;
      await must(made.loader.acquire(at("pinned")));
      const result = await made.loader.acquire(at("grower"));
      return { result, seen };
    };
    const fits = await run(1400);
    expect(fits.result.ok).toBe(true);
    expect([...new Set(fits.seen)]).toEqual([1000, 1200, 1400]);
    const overflows = await run(1700);
    expect(code(overflows.result)).toBe("over-budget");
  });

  test("bytes + reservations never exceed maxTotalBytes: lying, absent and chunked lengths", async () => {
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const limit = 30_000;
    const ref: { loader?: MediaLoader } = {};
    const worst = { sum: 0, entries: 0 };
    const sample = (): void => {
      const s = (ref.loader as MediaLoader).stats();
      worst.sum = Math.max(worst.sum, s.bytes + s.reservedBytes);
      worst.entries = Math.max(worst.entries, s.entries);
      expect(s.bytes + s.reservedBytes).toBeLessThanOrEqual(limit);
    };
    const made = rig(
      { maxTotalBytes: limit, maxBytes: 12_000, maxEntries: 10, assumedBytes: 700 },
      () => {
        const length = 200 + Math.floor(random() * 11_000);
        const lie = Math.floor(random() * 4);
        const declared =
          lie === 0
            ? undefined
            : lie === 1
              ? length
              : lie === 2
                ? Math.floor(length / 3)
                : length * 2;
        return {
          body: probedStream(tile(length), 150 + Math.floor(random() * 1500), sample),
          ...(declared === undefined ? {} : { contentLength: declared }),
        };
      },
    );
    ref.loader = made.loader;
    const outcomes = await Promise.all(
      Array.from({ length: 80 }, async (_v, i) => {
        const result = await made.loader.acquire(at(`f${i}`));
        sample();
        if (result.ok) result.value.release();
        return code(result) ?? "ok";
      }),
    );
    expect(new Set(outcomes).has("ok")).toBe(true);
    for (const outcome of outcomes) expect(["ok", "over-budget", "too-large"]).toContain(outcome);
    expect(worst.sum).toBeGreaterThan(0);
    expect(worst.entries).toBeLessThanOrEqual(10);
    expect(made.loader.stats()).toMatchObject({ reservedBytes: 0, waiting: 0, inFlight: 0 });
  });
});

describe("a read that does not fit yet waits in a FIFO queue", () => {
  const tight = { maxBytes: 10_000, maxTotalBytes: 10_000, maxConcurrent: 20 };

  test("it waits for an in-flight read that over-reserved, and does not read its body meanwhile", async () => {
    const first = gatedStream();
    const pulls: number[] = [];
    const { loader } = rig(tight, (url) =>
      url.endsWith("a.png")
        ? { body: first.body, contentLength: 6000 }
        : { body: probedStream(tile(6000), 6000, (i) => pulls.push(i)), contentLength: 6000 },
    );
    const a = loader.acquire(at("a"));
    await flush();
    const b = loader.acquire(at("b"));
    await flush();
    expect(loader.stats()).toMatchObject({ reservedBytes: 6000, waiting: 1 });
    expect(pulls).toEqual([]);
    first.push(tile(100));
    first.end();
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(loader.stats()).toMatchObject({ waiting: 0, reservedBytes: 0, bytes: 6100 });
  });

  test("it is refused at once when holders alone leave no room, and succeeds after a release", async () => {
    const first = gatedStream();
    const { loader } = rig(tight, (url) =>
      url.endsWith("a.png") ? { body: first.body, contentLength: 6000 } : sized(6000),
    );
    const a = loader.acquire(at("a"));
    await flush();
    const b = loader.acquire(at("b"));
    await flush();
    expect(loader.stats().waiting).toBe(1);
    first.push(tile(6000));
    first.end();
    const held = await must(a);
    // A's 6000 are now held: B can never fit while they are, so it fails promptly (no 30 s wait).
    expect(code(await b)).toBe("over-budget");
    expect(loader.stats().waiting).toBe(0);
    held.release();
    expect((await loader.acquire(at("b"))).ok).toBe(true);
  });

  test("it gives up with over-budget after budgetWaitMs", async () => {
    vi.useFakeTimers();
    const stuck = gatedStream();
    const second = gatedStream();
    const { loader } = rig({ ...tight, budgetWaitMs: 1000 }, (url) =>
      url.endsWith("a.png")
        ? { body: stuck.body, contentLength: 6000 }
        : { body: second.body, contentLength: 6000 },
    );
    void loader.acquire(at("a"));
    await vi.advanceTimersByTimeAsync(10);
    const b = loader.acquire(at("b"));
    await vi.advanceTimersByTimeAsync(999);
    expect(loader.stats().waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(code(await b)).toBe("over-budget");
    expect(second.state.cancelled).toBe(true);
    expect(loader.stats()).toMatchObject({ waiting: 0, reservedBytes: 6000 });
    loader.purge();
  });

  test("the documented defaults", () => {
    expect(DEFAULT_BUDGET_WAIT_MS).toBe(30_000);
    expect(HEAD_BYPASS_LIMIT).toBe(8);
  });

  test.each(["abort", "purge", "session"])("a waiting read honours %s", async (how) => {
    const stuck = gatedStream();
    const second = gatedStream();
    let who = "alice";
    const { loader } = rig({ ...tight, getSessionKey: () => who }, (url) =>
      url.endsWith("a.png")
        ? { body: stuck.body, contentLength: 6000 }
        : { body: second.body, contentLength: 6000 },
    );
    const a = loader.acquire(at("a"));
    await flush();
    const ac = new AbortController();
    const b = loader.acquire(at("b"), { signal: ac.signal });
    await flush();
    expect(loader.stats().waiting).toBe(1);
    if (how === "abort") ac.abort();
    else if (how === "purge") loader.purge();
    else {
      who = "bob";
      void loader.revalidate(at("zzz"));
    }
    expect(code(await b)).toBe(how === "abort" ? "aborted" : "purged");
    expect(loader.stats().waiting).toBe(0);
    expect(second.state.cancelled).toBe(true);
    if (how === "abort") {
      stuck.push(tile(100));
      stuck.end();
      expect((await a).ok).toBe(true);
    } else {
      expect(code(await a)).toBe("purged");
    }
  });

  test("an abort that lands between the headers and the reservation is honoured", async () => {
    // Only a read that has to wait could be stranded by a missed abort: make this one wait.
    const ac = new AbortController();
    let cancelled = false;
    const reply = (url: string) => {
      const result = Promise.resolve({
        url,
        status: 200,
        etag: null,
        contentType: null,
        contentLength: 6000,
        body: new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      });
      if (url.endsWith("race.png")) result.then(() => ac.abort());
      return result;
    };
    const storage = {
      protocol: "solid",
      root: ROOT,
      isWithinStorage: () => true,
      read: reply,
    } as unknown as StorageClient;
    const loader = createMediaLoader({
      storage,
      scope: [MEDIA],
      ...LIMITS,
      maxBytes: 10_000,
      maxTotalBytes: 10_000,
      objectUrls: fakeUrls().api,
    });
    void loader.acquire(at("stuck"));
    await flush();
    expect(loader.stats().reservedBytes).toBe(6000);
    expect(code(await loader.acquire(at("race"), { signal: ac.signal }))).toBe("aborted");
    await flush();
    expect(cancelled).toBe(true);
    expect(loader.stats().waiting).toBe(0);
    loader.purge();
  });

  test("a small read passes a blocked large one, but not more than HEAD_BYPASS_LIMIT times", async () => {
    const stuck = gatedStream();
    const order: string[] = [];
    const named = (name: string, length: number): FakeRead => ({
      body: probedStream(tile(length), length, (i) => {
        if (i === 0) order.push(name);
      }),
      contentLength: length,
    });
    const { loader } = rig(tight, (url) => {
      const name = url.slice(MEDIA.length, -4);
      return name === "A"
        ? { body: stuck.body, contentLength: 6000 }
        : named(name, name === "H" ? 8000 : 1000);
    });
    const a = loader.acquire(at("A"));
    await flush();
    const head = loader.acquire(at("H"));
    await flush();
    expect(loader.stats().waiting).toBe(1);
    for (let i = 1; i <= HEAD_BYPASS_LIMIT; i++) {
      const handle = await must(loader.acquire(at(`S${i}`)));
      handle.release();
      expect(loader.stats().waiting).toBe(1);
    }
    expect(order).toEqual(Array.from({ length: HEAD_BYPASS_LIMIT }, (_v, i) => `S${i + 1}`));
    // The head has been passed eight times: the ninth small read, which would fit, now waits.
    const ninth = loader.acquire(at("S9"));
    await flush();
    expect(loader.stats().waiting).toBe(2);
    expect(order).not.toContain("S9");
    // Room appears (A fails): the head goes first, then the small read behind it.
    stuck.fail(new Error("boom"));
    expect(code(await a)).toBe("failed");
    expect((await head).ok).toBe(true);
    expect((await ninth).ok).toBe(true);
    expect(order.slice(-2)).toEqual(["H", "S9"]);
    expect(loader.stats()).toMatchObject({ waiting: 0, reservedBytes: 0 });
  });

  test("when the blocking head leaves the queue, the reads it was holding back go", async () => {
    const stuck = gatedStream();
    const { loader } = rig(tight, (url) => {
      if (url.endsWith("A.png")) return { body: stuck.body, contentLength: 6000 };
      return sized(url.endsWith("H.png") ? 8000 : 1000);
    });
    void loader.acquire(at("A"));
    await flush();
    const ac = new AbortController();
    const head = loader.acquire(at("H"), { signal: ac.signal });
    await flush();
    for (let i = 1; i <= HEAD_BYPASS_LIMIT; i++)
      (await must(loader.acquire(at(`S${i}`)))).release();
    const ninth = loader.acquire(at("S9"));
    await flush();
    expect(loader.stats().waiting).toBe(2);
    ac.abort();
    expect(code(await head)).toBe("aborted");
    expect((await ninth).ok).toBe(true);
    expect(loader.stats().waiting).toBe(0);
    loader.purge();
  });

  test("a head that the holders make hopeless is dropped and the queue moves on", async () => {
    const stuck = gatedStream();
    const { loader } = rig(tight, (url) => {
      if (url.endsWith("A.png")) return { body: stuck.body, contentLength: 3000 };
      if (url.endsWith("P.png")) return sized(2000);
      return sized(url.endsWith("H.png") ? 8000 : 1000);
    });
    const a = loader.acquire(at("A"));
    await flush();
    const head = loader.acquire(at("H"));
    await flush();
    const small = loader.acquire(at("S"));
    expect((await small).ok).toBe(true);
    // 3000 reserved + 1000 held + 7000 does not fit; another holder makes it hopeless.
    const pinned = await must(loader.acquire(at("P")));
    stuck.push(tile(3000));
    stuck.end();
    await must(a);
    expect(code(await head)).toBe("over-budget");
    pinned.release();
  });
});

describe("maxEntries counts held entries and follows the same policy", () => {
  test("a read beyond it waits for a slot, and is refused when holders fill it", async () => {
    const gates = { a: gatedStream(), b: gatedStream() };
    const { loader } = rig({ maxEntries: 2 }, (url) => {
      if (url.endsWith("a.png")) return { body: gates.a.body, contentLength: 1000 };
      if (url.endsWith("b.png")) return { body: gates.b.body, contentLength: 1000 };
      return sized(1000);
    });
    const a = loader.acquire(at("a"));
    const b = loader.acquire(at("b"));
    await flush();
    const c = loader.acquire(at("c"));
    await flush();
    expect(loader.stats().waiting).toBe(1);
    gates.a.fail(new Error("boom"));
    expect(code(await a)).toBe("failed");
    const heldC = await must(c);
    gates.b.push(tile(1000));
    gates.b.end();
    const heldB = await must(b);
    // Two holders now pin both entries.
    expect(code(await loader.acquire(at("d")))).toBe("over-budget");
    heldB.release();
    expect((await loader.acquire(at("d"))).ok).toBe(true);
    heldC.release();
  });

  test("unreferenced entries are evicted to make room for the entry bound", async () => {
    const { loader } = rig({ maxEntries: 2 });
    for (let i = 0; i < 5; i++) (await must(loader.acquire(at(`e${i}`)))).release();
    expect(loader.stats().entries).toBeLessThanOrEqual(2);
  });
});

describe("revalidate uses the same reservations", () => {
  test("a declared length above maxBytes retires the cached copy as too-large", async () => {
    let call = 0;
    const gate = gatedStream();
    const { loader } = rig({}, () => {
      call++;
      return call === 1 ? sized(1000) : { body: gate.body, contentLength: 200_000, etag: '"v2"' };
    });
    (await must(loader.acquire(at("a")))).release();
    expect(code(await loader.revalidate(at("a")))).toBe("too-large");
    expect(gate.state.cancelled).toBe(true);
    expect(loader.stats().entries).toBe(0);
  });

  test("a revalidation that cannot grow leaves the cached copy alone", async () => {
    let aReads = 0;
    const gate = gatedStream();
    const { loader, reads } = rig({ maxTotalBytes: 6000, maxBytes: 6000 }, (url) => {
      if (url.endsWith("pinned.png")) return sized(4000);
      aReads++;
      if (aReads === 1) return sized(1000);
      return { body: gate.body, etag: '"v2"' };
    });
    const held = await must(loader.acquire(at("pinned")));
    (await must(loader.acquire(at("a")))).release();
    const pending = loader.revalidate(at("a"));
    await flush();
    gate.push(tile(5000));
    expect(code(await pending)).toBe("over-budget");
    expect(loader.stats().entries).toBe(2);
    const before = reads.length;
    (await must(loader.acquire(at("a")))).release();
    expect(reads).toHaveLength(before);
    held.release();
  });
});

describe("capacity events", () => {
  test("releasing holds emits one coalesced capacity event", async () => {
    const { loader } = rig();
    const events: MediaLoaderEvent[] = [];
    loader.subscribe((event) => events.push(event));
    const one = await must(loader.acquire(at("a")));
    const two = await must(loader.acquire(at("b")));
    await flush();
    expect(events).toEqual([]);
    one.release();
    two.release();
    await flush();
    expect(events).toEqual(["capacity"]);
  });

  test("a read that gives its reservation back without an entry emits capacity", async () => {
    const { loader } = rig({}, () => ({ body: null, status: 200, contentLength: 500 }));
    const events: MediaLoaderEvent[] = [];
    loader.subscribe((event) => events.push(event));
    // An empty body is refused as unsupported: the reservation is returned.
    expect(code(await loader.acquire(at("a")))).toBe("unsupported-type");
    await flush();
    expect(events).toEqual(["capacity"]);
  });

  test("invalidating an unreferenced entry frees room; purge says purge", async () => {
    const { loader } = rig();
    (await must(loader.acquire(at("a")))).release();
    await flush();
    const events: MediaLoaderEvent[] = [];
    loader.subscribe((event) => events.push(event));
    loader.invalidate(at("a"));
    await flush();
    loader.purge();
    expect(events).toEqual(["capacity", "purge"]);
  });

  test("a failing listener does not stop the others", async () => {
    const { loader } = rig();
    const seen = vi.fn();
    loader.subscribe(() => {
      throw new Error("boom");
    });
    loader.subscribe(seen);
    (await must(loader.acquire(at("a")))).release();
    await flush();
    expect(seen).toHaveBeenCalledWith("capacity");
  });
});

describe("options", () => {
  test.each([
    ["assumedBytes", 0],
    ["assumedBytes", 1.5],
    ["budgetWaitMs", 0],
    ["budgetWaitMs", Number.NaN],
  ])("%s %s is rejected", (name, value) => {
    expect(() => rig({ [name]: value })).toThrow(RangeError);
  });
});
