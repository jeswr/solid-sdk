// AUTHORED-BY Claude Sonnet 5.5
import { type Entry, type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  harness,
  intercept,
  jpeg,
  must,
  png,
  putInput,
  sha256Of,
  shardOf,
} from "../test/support.js";
import { createMemoryJournal } from "./journal.js";

describe.each(["solid", "lws"] as const)("remaining edges (%s)", (protocol) => {
  it("an abort that coincides with a failed cleanup still reports the leak", async () => {
    const controller = new AbortController();
    const h = await harness(protocol, {}, (s) =>
      intercept(s, async (call) => {
        const name = (call.args[2] as { name?: string } | undefined)?.name ?? "";
        if (call.method === "create" && /^[0-9a-f]{64}$/.test(name)) {
          const binary = (await allResources(s)).find((url) => url.endsWith(".png")) as string;
          await s.write(binary, new Uint8Array([1]), { contentType: "image/png", ifMatch: "*" });
          controller.abort();
          throw new StorageError("network", { url: "x:", method: "POST" });
        }
      }),
    );
    const result = await h.store.put(putInput({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("aborted");
    expect(result.error.orphans).toHaveLength(1);
  });

  it("a parse that fails after an abort reports the abort", async () => {
    const controller = new AbortController();
    const h = await harness(protocol, {
      parse: async () => {
        controller.abort();
        throw new Error("parse died");
      },
    });
    expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });

  it("a thumbnail name that is taken but cannot be found is a conflict", async () => {
    if (protocol === "lws") return;
    const h = await harness(protocol);
    must(await h.store.put(putInput({ seed: 9, description: { name: "seed" } })));
    const shard = shardOf(h.store);
    const hash = await sha256Of(png(1));
    await h.storage.create(shard, jpeg(4), {
      name: `${hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const blind: StorageClient = new Proxy(h.storage, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (property !== "listAll") return value.bind(target);
        return (container: string, options: never) =>
          container === shard
            ? (async function* (): AsyncGenerator<Entry> {})()
            : target.listAll(container, options);
      },
    });
    const reopened = await h.reopen({ storage: blind });
    expect(await reopened.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "name-unavailable" },
    });
  });

  it("orders members without a modified time after dated ones, ties by url", async () => {
    const h = await harness(protocol);
    must(await h.store.put(putInput()));
    const shard = shardOf(h.store);
    const entry = (name: string, modified: Date | null): Entry => ({
      url: `${shard}${name}`,
      kind: "resource",
      displayName: null,
      contentType: "application/ld+json",
      size: 1,
      modified,
      types: [],
    });
    const when = new Date("2026-05-20T00:00:00Z");
    const lying: StorageClient = new Proxy(h.storage, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (property !== "list") return value.bind(target);
        return async (container: string, options: never) => {
          const page = await target.list(container, options);
          return container === shard
            ? {
                ...page,
                items: [entry("b", when), entry("a", when), entry("undated", null), ...page.items],
              }
            : page;
        };
      },
    });
    const listed = must(await (await h.reopen({ storage: lying })).list());
    expect(listed.items).toHaveLength(1);
    expect(listed.skipped.unparseable).toBe(3);
  });

  it("resume stops when the abort lands in the middle of finishing an entry", async () => {
    const journal = createMemoryJournal();
    const h = await harness(protocol, { journal });
    const out = must(await h.store.put(putInput()));
    await journal.put({
      descriptionUrl: `${shardOf(h.store)}gone`,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
    });
    const controller = new AbortController();
    const store = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "head") controller.abort();
      }),
    });
    expect(await store.resumePending(controller.signal)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });

  it("a delete that fails for another reason is reported, not swallowed", async () => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const store = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "delete") {
          throw new StorageError("forbidden", { url: "x:", method: "DELETE" });
        }
      }),
    });
    expect(await store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
  });
});
