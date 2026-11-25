// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import {
  allResources,
  descriptions,
  type Harness,
  harness,
  intercept,
  jpeg,
  must,
  type Protocol,
  putInput,
} from "../test/support.js";
import { openMediaStore } from "./index.js";

const aborted = {
  ok: false,
  error: expect.objectContaining({ kind: "failed", reason: "aborted" }),
};

/** A harness whose storage aborts `controller` just before its `n`th hooked call. */
async function abortingAt(protocol: Protocol, n: number, controller: AbortController) {
  let calls = 0;
  return harness(protocol, {}, (s) =>
    intercept(s, () => {
      if (++calls === n) controller.abort();
    }),
  );
}

/** How many hooked storage calls `run` makes on a healthy store. */
async function countCalls(protocol: Protocol, run: (h: Harness) => Promise<unknown>) {
  let calls = 0;
  const h = await harness(protocol, {}, (s) =>
    intercept(s, () => {
      calls++;
    }),
  );
  await run(h);
  return calls;
}

describe.each(["solid", "lws"] as const)("abort (%s)", (protocol) => {
  it("put: aborting before any storage call leaves nothing behind", async () => {
    const h = await harness(protocol);
    const controller = new AbortController();
    controller.abort();
    expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual(aborted);
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("put: abort at every storage call completes or leaves only retryable media", async () => {
    const put = (h: Harness, signal?: AbortSignal) =>
      h.store.put(putInput({ thumbnail: { bytes: jpeg(1) }, ...(signal ? { signal } : {}) }));
    const total = await countCalls(protocol, (h) => put(h, new AbortController().signal));
    expect(total).toBeGreaterThan(8);
    let aborts = 0;
    for (let n = 1; n <= total + 1; n++) {
      const controller = new AbortController();
      const h = await abortingAt(protocol, n, controller);
      const result = await put(h, controller.signal);
      const found = await descriptions(h.storage);
      if (result.ok) {
        expect(await allResources(h.storage), `n=${n}`).toHaveLength(3);
        continue;
      } else {
        aborts++;
        expect(result.error, `n=${n}`).toMatchObject({ kind: "failed", reason: "aborted" });
        // Never an empty or half-written description: it is complete or absent.
        for (const url of found) {
          expect(
            (await h.storage.read(url).then((r) => r.text())).length,
            `n=${n}`,
          ).toBeGreaterThan(0);
        }
      }
      // Whatever was left, the same put works afterwards and the sweep clears any duplicates.
      const retry = await put({ ...h, store: await h.reopen() } as Harness);
      expect(retry.ok, `n=${n}`).toBe(true);
      await (await h.reopen()).sweepOrphans({ minAgeMs: 0 });
      expect(await allResources(h.storage), `n=${n}`).toHaveLength(3);
    }
    expect(aborts).toBeGreaterThanOrEqual(total - 1);
  });

  it("put: abort between awaits that are not storage calls", async () => {
    const stages: Array<(c: AbortController) => Partial<Parameters<typeof harness>[1]>> = [
      (c) => ({
        sniff: (bytes) => {
          c.abort();
          return { contentType: "image/png", extension: ".png", ...(bytes ? {} : {}) };
        },
      }),
      (c) => ({
        build: async (url, binaryUrl) => {
          c.abort();
          return {
            contentType: "application/ld+json",
            body: JSON.stringify({ "@type": "ex:Media", contentUrl: binaryUrl, "@id": url }),
          };
        },
      }),
      (c) => ({
        findByHash: async () => {
          c.abort();
          return undefined;
        },
      }),
    ];
    for (const stage of stages) {
      const controller = new AbortController();
      const h = await harness(protocol, stage(controller) as never);
      expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual(aborted);
      expect(await descriptions(h.storage)).toEqual([]);
    }
    const controller = new AbortController();
    const h = await harness(protocol);
    const blob = new (class extends Blob {
      override async arrayBuffer() {
        controller.abort();
        return super.arrayBuffer();
      }
    })([putInput().bytes as Uint8Array<ArrayBuffer>]);
    expect(await h.store.put(putInput({ bytes: blob, signal: controller.signal }))).toEqual(
      aborted,
    );
    const parsing = new AbortController();
    const p = await harness(protocol, {
      parse: async (url, body) => {
        parsing.abort();
        return JSON.parse(body) && { id: url, name: "x", binaryUrl: "y" };
      },
    });
    expect(await p.store.put(putInput({ signal: parsing.signal }))).toEqual(aborted);
    expect(await descriptions(p.storage)).toEqual([]);
  });

  it("a hung type index, registration or build ends at the abort", async () => {
    const never = new Promise<never>(() => {});
    const soon = () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5);
      return controller.signal;
    };
    const h = await harness(protocol);
    const hungLookup = { findAll: () => never, register: () => never };
    expect(await openMediaStore({ ...h.options, typeIndex: hungLookup, signal: soon() })).toEqual(
      aborted,
    );
    const hungRegister = {
      findAll: async () => new Map<string, string[]>(),
      register: () => never,
    };
    const registering = await h.reopen({ typeIndex: hungRegister });
    expect(await registering.put(putInput({ signal: soon() }))).toEqual(aborted);
    const building = await h.reopen({ build: () => never });
    expect(await building.put(putInput({ signal: soon() }))).toEqual(aborted);
  });

  it("list, get, update, remove and resume honour an abort at every storage call", async () => {
    const seed = async (h: Harness) => {
      const first = must(await h.store.put(putInput()));
      must(await h.store.put(putInput({ seed: 2, createdAt: new Date("2026-04-01T00:00:00Z") })));
      return first;
    };
    const operations: Array<(h: Harness, url: string, signal: AbortSignal) => Promise<unknown>> = [
      (h, _url, signal) => h.store.list({ limit: 1, signal }),
      (h, url, signal) => h.store.get(url, signal),
      (h, url, signal) =>
        h.store.update(
          url,
          async (current) => ({ body: current.body, contentType: "application/ld+json" }),
          { signal },
        ),
      (h, url, signal) => h.store.remove(url, signal),
      (h, _url, signal) => h.store.checkExposure(signal),
    ];
    for (const operation of operations) {
      const counter = await harness(protocol);
      const first = await seed(counter);
      let total = 0;
      const counting = await counter.reopen({
        storage: intercept(counter.storage, () => {
          total++;
        }),
      });
      await operation(
        { ...counter, store: counting } as Harness,
        first.descriptionUrl,
        new AbortController().signal,
      );
      for (let n = 1; n <= total; n++) {
        const controller = new AbortController();
        const h = await harness(protocol);
        const item = await seed(h);
        let calls = 0;
        const store = await h.reopen({
          storage: intercept(h.storage, () => {
            if (++calls === n) controller.abort();
          }),
        });
        const result = (await operation(
          { ...h, store } as Harness,
          item.descriptionUrl,
          controller.signal,
        )) as { ok: boolean };
        expect(result, `n=${n}`).toEqual(aborted);
      }
    }
  });

  it("resume stops at the next entry once aborted", async () => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const controller = new AbortController();
    const crashing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "delete") controller.abort();
      }),
    });
    const removed = await crashing.remove(out.descriptionUrl, controller.signal);
    expect(removed).toEqual(aborted);
    const resumed = await crashing.resumePending(controller.signal);
    expect(resumed).toEqual(aborted);
  });
});
