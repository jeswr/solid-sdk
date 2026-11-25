// AUTHORED-BY Claude Sonnet 5.5
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { MediaFailure } from "../src/errors.js";
import { createMediaLoader } from "../src/loader.js";
import { abortion, raceAbort, readBounded } from "../src/read.js";
import { prefixOf } from "../src/view.js";
import {
  deferred,
  fakeStorage,
  fakeUrls,
  gatedStream,
  MEDIA,
  png,
  served,
  streamOf,
} from "./helpers.js";

describe("abortion", () => {
  test("rejects at once for an already aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const { promise, dispose } = abortion(ac.signal);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    dispose();
  });

  test("rejects on abort and stops listening after dispose", async () => {
    const ac = new AbortController();
    const live = abortion(ac.signal);
    ac.abort();
    await expect(live.promise).rejects.toBeInstanceOf(MediaFailure);

    const other = new AbortController();
    const disposed = abortion(other.signal);
    disposed.dispose();
    other.abort();
    const settled = await Promise.race([
      disposed.promise.then(
        () => "x",
        () => "rejected",
      ),
      Promise.resolve("pending"),
    ]);
    expect(settled).toBe("pending");
  });
});

describe("raceAbort", () => {
  test("returns the work's value", async () => {
    const discard = vi.fn();
    expect(await raceAbort(Promise.resolve(7), new AbortController().signal, discard)).toBe(7);
    expect(discard).not.toHaveBeenCalled();
  });

  test("propagates the work's own rejection", async () => {
    const discard = vi.fn();
    await expect(
      raceAbort(Promise.reject(new Error("boom")), new AbortController().signal, discard),
    ).rejects.toThrow("boom");
    expect(discard).not.toHaveBeenCalled();
  });

  test("an abort wins the race and a late value is discarded", async () => {
    const ac = new AbortController();
    const work = deferred<string>();
    const discard = vi.fn();
    const raced = raceAbort(work.promise, ac.signal, discard);
    ac.abort();
    await expect(raced).rejects.toMatchObject({ code: "aborted" });
    work.resolve("late");
    await work.promise;
    await Promise.resolve();
    expect(discard).toHaveBeenCalledWith("late");
  });
});

describe("readBounded", () => {
  const live = new AbortController().signal;

  test("concatenates chunks in order", async () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_v, i) => i % 251);
    const body = await readBounded(streamOf(bytes, 7), 1000, live);
    expect(body.size).toBe(1000);
    expect(body.chunks.length).toBeGreaterThan(1);
    expect(prefixOf(body.chunks, 1000)).toEqual(bytes);
  });

  test("an empty stream and a null body are empty", async () => {
    expect(await readBounded(streamOf(new Uint8Array(0)), 10, live)).toEqual({
      chunks: [],
      size: 0,
    });
    expect(await readBounded(null, 10, live)).toEqual({ chunks: [], size: 0 });
  });

  test("refuses the moment the running total passes the limit", async () => {
    const gate = gatedStream();
    const pending = readBounded(gate.body, 10, live);
    gate.push(new Uint8Array(6));
    gate.push(new Uint8Array(5));
    await expect(pending).rejects.toMatchObject({ code: "too-large" });
    await vi.waitFor(() => expect(gate.state.cancelled).toBe(true));
  });

  test("accepts a Uint8Array from another realm (webview, iframe)", async () => {
    const foreign = runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array;
    expect(foreign instanceof Uint8Array).toBe(false);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(foreign);
        controller.close();
      },
    });
    const read = await readBounded(body, 10, live);
    expect(prefixOf(read.chunks, 10)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("refuses non-byte chunks", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(42);
        controller.close();
      },
    });
    await expect(readBounded(body as ReadableStream<Uint8Array>, 10, live)).rejects.toMatchObject({
      code: "failed",
    });
  });

  test("an abort that lands with the last chunk still counts as an abort", async () => {
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    const pending = readBounded(body, 10, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  test("a pre-aborted signal refuses before any byte is consumed", async () => {
    const ac = new AbortController();
    ac.abort();
    const gate = gatedStream();
    await expect(readBounded(gate.body, 10, ac.signal)).rejects.toMatchObject({ code: "aborted" });
    await vi.waitFor(() => expect(gate.state.cancelled).toBe(true));
  });
});

describe("object URL revocation", () => {
  test("a revoke that throws neither escapes nor leaves the entry behind", async () => {
    const urls = fakeUrls();
    const loader = createMediaLoader({
      storage: fakeStorage(() => served(png())).storage,
      scope: [MEDIA],
      maxBytes: 1 << 20,
      maxTotalBytes: 1 << 20,
      maxEntries: 4,
      objectUrls: {
        createObjectURL: urls.api.createObjectURL,
        revokeObjectURL() {
          throw new Error("revoke failed");
        },
      },
    });
    const result = await loader.acquire(`${MEDIA}a.png`);
    expect(result.ok).toBe(true);
    expect(() => loader.purge()).not.toThrow();
    expect(loader.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});
