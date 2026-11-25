// AUTHORED-BY Claude Sonnet 5.5
import { type Entry, type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  harness,
  intercept,
  jpeg,
  must,
  putInput,
  ROOT,
  shardOf,
} from "../test/support.js";
import { encodeCursor } from "./cursor.js";

const entry = (url: string, over: Partial<Entry> = {}): Entry => ({
  url,
  kind: "resource",
  displayName: null,
  contentType: "application/ld+json",
  size: 10,
  modified: new Date("2026-05-20T00:00:00Z"),
  types: [],
  ...over,
});

/** A listing that also reports members the server should never have. */
function withMembers(storage: StorageClient, extra: (container: string) => Entry[]): StorageClient {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property !== "list") return value.bind(target);
      return async (container: string, options: never) => {
        const page = await target.list(container, options);
        return { ...page, items: [...page.items, ...extra(container)] };
      };
    },
  });
}

const month = (n: number) => new Date(Date.UTC(2026, n - 1, 15));

describe.each(["solid", "lws"] as const)("list and get (%s)", (protocol) => {
  async function populate(h: Awaited<ReturnType<typeof harness>>) {
    const urls: string[] = [];
    for (const [seed, when, name] of [
      [1, month(3), "march"],
      [2, month(5), "may-a"],
      [3, month(5), "may-b"],
      [4, month(1), "january"],
      [5, new Date("2025-12-31T23:00:00Z"), "december"],
    ] as const) {
      urls.push(
        must(await h.store.put(putInput({ seed, createdAt: when, description: { name } })))
          .descriptionUrl,
      );
    }
    return urls;
  }

  it("lists newest shard first and pages with an opaque cursor", async () => {
    const h = await harness(protocol);
    await populate(h);
    const names: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = must(await h.store.list({ limit: 2, ...(cursor ? { cursor } : {}) }));
      names.push(...page.items.map((item) => item.value.name));
      cursor = page.next ?? undefined;
      pages++;
      expect(page.items.length).toBeLessThanOrEqual(2);
    } while (cursor);
    expect(pages).toBe(3);
    expect(names).toHaveLength(5);
    expect(names.slice(0, 2).sort()).toEqual(["may-a", "may-b"]);
    expect(names.slice(2)).toEqual(["march", "january", "december"]);
    const all = must(await h.store.list({ limit: 200 }));
    expect(all.items).toHaveLength(5);
    expect(all.next).toBeNull();
    expect(all.skipped).toEqual({ foreign: 0, unparseable: 0, pending: 0, outOfScope: 0 });
    for (const item of all.items) {
      expect(h.store.isInsideLibrary(item.binaryUrl)).toBe(true);
      expect(item.etag).not.toBeNull();
    }
  });

  it("returns the next shard's cursor when a page ends exactly at a shard boundary", async () => {
    const h = await harness(protocol);
    await populate(h);
    const first = must(await h.store.list({ limit: 2 }));
    expect(first.next).not.toBeNull();
    const resumedFresh = await h.reopen();
    const second = must(await resumedFresh.list({ limit: 2, cursor: first.next as string }));
    expect(second.items.map((item) => item.value.name)).toEqual(["march", "january"]);
    const third = must(await resumedFresh.list({ limit: 1, cursor: second.next as string }));
    expect(third.items.map((item) => item.value.name)).toEqual(["december"]);
    expect(third.next).toBeNull();
  });

  it("continues within a shard across storage pages (LWS) and survives a vanished shard", async () => {
    const h = await harness(protocol, {}, (s) => s, 2);
    for (let i = 1; i <= 5; i++) {
      must(await h.store.put(putInput({ seed: i, description: { name: `item${i}` } })));
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = must(await h.store.list({ limit: 2, ...(cursor ? { cursor } : {}) }));
      for (const item of page.items) seen.add(item.value.name);
      cursor = page.next ?? undefined;
    } while (cursor);
    expect([...seen].sort()).toEqual(["item1", "item2", "item3", "item4", "item5"]);
    const gone = encodeCursor({
      shard: "2020/01",
      shardUrl: `${h.store.library}2020/01/`,
      page: null,
      offset: 0,
    });
    expect(must(await h.store.list({ cursor: gone })).items).toEqual([]);
  });

  it("rejects bad cursors and limits, and a page cursor that leaves the shard", async () => {
    const h = await harness(protocol);
    await populate(h);
    const invalid = { ok: false, error: { kind: "failed", reason: "invalid-cursor" } };
    expect(await h.store.list({ cursor: "!!!" })).toEqual(invalid);
    expect(
      await h.store.list({
        cursor: encodeCursor({
          shard: "2026/05",
          shardUrl: `${h.store.library}2026/05/`,
          page: null,
          offset: -1,
        }),
      }),
    ).toEqual(invalid);
    const elsewhere = encodeCursor({
      shard: "2026/05",
      shardUrl: `${h.store.library}2026/05/`,
      page: `${ROOT}private/`,
      offset: 0,
    });
    expect(await h.store.list({ cursor: elsewhere })).toEqual(invalid);
    for (const limit of [0, 201, 1.5]) {
      expect(await h.store.list({ limit })).toEqual({
        ok: false,
        error: { kind: "failed", reason: "invalid-input" },
      });
    }
  });

  it("lists nothing when there is no library yet", async () => {
    const h = await harness(protocol);
    expect(must(await h.store.list())).toEqual({
      items: [],
      next: null,
      skipped: { foreign: 0, unparseable: 0, pending: 0, outOfScope: 0 },
    });
    expect(await h.store.get(`${ROOT}media/2026/05/x`)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "no-library" },
    });
  });

  it("skips and counts unparseable, pending, foreign and out-of-scope members, per item", async () => {
    const h = await harness(protocol);
    must(await h.store.put(putInput({ description: { name: "good" } })));
    const shard = shardOf(h.store);
    await h.storage.create(shard, "not json", { name: "junk", contentType: "application/ld+json" });
    await h.storage.create(shard, JSON.stringify({ "@type": "ex:Other" }), {
      name: "alien",
      contentType: "application/ld+json",
    });
    await h.storage.create(shard, "", { name: "pending", contentType: "application/ld+json" });
    await h.storage.create(shard, null, { kind: "container", name: "nested" });
    await h.storage.create(shard, new Uint8Array(32).fill(1), {
      name: "big.bin",
      contentType: "application/octet-stream",
    });
    const lying = withMembers(h.storage, (container) =>
      container === shard
        ? [
            entry("https://evil.example/alice/media/2026/05/x"),
            entry(`${ROOT}private/secret`),
            entry(`${shard}unknown-type`, { contentType: null, size: null }),
            entry(`${shard}huge-unknown`, { contentType: null, size: 10 * 1024 * 1024 }),
          ]
        : [],
    );
    const page = must(await (await h.reopen({ storage: lying })).list());
    expect(page.items.map((item) => item.value.name)).toEqual(["good"]);
    expect(page.skipped.pending).toBe(1);
    expect(page.skipped.foreign).toBeGreaterThanOrEqual(2);
    expect(page.skipped.unparseable).toBeGreaterThanOrEqual(3);
    expect(page.skipped.outOfScope).toBeGreaterThanOrEqual(1);
    expect(h.store.library).not.toBeNull();
  });

  it("drops descriptions whose media pointers leave the library, keeps the item without a bad thumbnail", async () => {
    const h = await harness(protocol);
    const good = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    const shard = shardOf(h.store);
    await h.storage.create(
      shard,
      JSON.stringify({
        "@type": "ex:Media",
        name: "steals",
        contentUrl: `${ROOT}private/photo.png`,
      }),
      { name: "steal", contentType: "application/ld+json" },
    );
    await h.storage.create(
      shard,
      JSON.stringify({
        "@type": "ex:Media",
        name: "elsewhere",
        contentUrl: "https://evil.example/a.png",
      }),
      { name: "steal2", contentType: "application/ld+json" },
    );
    await h.storage.create(shard, JSON.stringify({ "@type": "ex:Media", name: "nobinary" }), {
      name: "steal3",
      contentType: "application/ld+json",
    });
    await h.storage.create(
      shard,
      JSON.stringify({
        "@type": "ex:Media",
        name: "badthumb",
        contentUrl: good.binaryUrl,
        thumbnailUrl: `${ROOT}private/thumb.jpg`,
      }),
      { name: "badthumb", contentType: "application/ld+json" },
    );
    const page = must(await h.store.list());
    expect(page.items.map((item) => item.value.name).sort()).toEqual(["badthumb", "first"]);
    expect(page.items.find((item) => item.value.name === "badthumb")?.thumbnailUrl).toBeUndefined();
    expect(page.skipped.outOfScope).toBe(3);
    const got = await h.store.get(`${shard}steal`);
    expect(got).toEqual({ ok: false, error: { kind: "failed", reason: "out-of-scope" } });
  });

  it("get returns one item, and refuses URLs outside a shard of the library", async () => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const item = must(await h.store.get(out.descriptionUrl));
    expect(item.binaryUrl).toBe(out.binaryUrl);
    expect(item.value.name).toBe("first");
    for (const url of [
      `${ROOT}profile/card`,
      "https://evil.example/x",
      `${h.store.library}x`,
      `${ROOT}media/2026/05/`,
    ]) {
      expect(await h.store.get(url)).toEqual({
        ok: false,
        error: { kind: "not-found", reason: "out-of-scope" },
      });
    }
    const shard = shardOf(h.store);
    await h.storage.create(shard, "", { name: "pend", contentType: "application/ld+json" });
    await h.storage.create(shard, "nope", { name: "bad", contentType: "application/ld+json" });
    const pend = (await allResources(h.storage)).find((url) => url.endsWith("pend")) as string;
    const bad = (await allResources(h.storage)).find((url) => url.endsWith("bad")) as string;
    expect(await h.store.get(pend)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-pending" },
    });
    expect(await h.store.get(bad)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-unparseable" },
    });
    expect(await h.store.get(`${shard}missing`)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: protocol === "solid" ? "storage" : "out-of-scope" },
    });
  });

  it("a member that cannot be read is skipped, but an offline pod fails the page", async () => {
    const h = await harness(protocol);
    must(await h.store.put(putInput()));
    const forbidden = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "read")
          throw new StorageError("forbidden", { url: "x:", method: "GET" });
      }),
    });
    expect(must(await forbidden.list()).skipped.unparseable).toBe(1);
    const offline = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "read") throw new StorageError("network", { url: "x:", method: "GET" });
      }),
    });
    expect(await offline.list()).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
  });

  it("refuses an oversized description without keeping any of it", async () => {
    const h = await harness(protocol);
    must(await h.store.put(putInput()));
    const tiny = await h.reopen({ maxDescriptionBytes: 8 });
    expect(must(await tiny.list()).skipped.unparseable).toBe(1);
    expect(await tiny.get(must(await h.store.list()).items[0]?.descriptionUrl as string)).toEqual({
      ok: false,
      error: { kind: "too-large", reason: "description-too-large" },
    });
  });

  it("reads descriptions with bounded concurrency", async () => {
    const h = await harness(protocol);
    for (let i = 1; i <= 6; i++)
      must(await h.store.put(putInput({ seed: i, description: { name: `n${i}` } })));
    let inFlight = 0;
    let peak = 0;
    const counted = await h.reopen({
      concurrency: 2,
      storage: intercept(
        h.storage,
        async (call) => {
          if (call.method !== "read") return;
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
        },
        (call) => {
          if (call.method === "read") inFlight--;
        },
      ),
    });
    expect(must(await counted.list()).items).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
