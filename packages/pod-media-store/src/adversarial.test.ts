// AUTHORED-BY Claude Sonnet 5.5
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  harness,
  intercept,
  jpeg,
  png,
  putInput,
  serverNames,
  sha256Of,
  shardOf,
  text,
} from "../test/support.js";

type Call = { method: string; args: unknown[] };
const opts = (call: Call) => (call.args[2] ?? {}) as { name?: string; contentType?: string };
const isDescriptionCreate = (call: Call) =>
  call.method === "create" && /^[0-9a-f]{64}$/.test(opts(call).name ?? "");
const isBinaryCreate = (call: Call) =>
  call.method === "create" && /^[0-9a-f]{64}\.png$/.test(opts(call).name ?? "");
const isThumbCreate = (call: Call) =>
  call.method === "create" && (opts(call).name ?? "").includes("-thumb");
const isWrite = (call: Call) => call.method === "write";
const boom = () =>
  new StorageError("network", { url: "https://pod.example/alice/", method: "POST" });

describe.each(["solid", "lws"] as const)("compensation (%s)", (protocol) => {
  const withThumb = () => putInput({ thumbnail: { bytes: jpeg(1) } });

  it.each([
    ["thumbnail create", isThumbCreate],
    ["description create", isDescriptionCreate],
    ["description write", isWrite],
  ])("removes everything this call created when %s fails", async (_label, when) => {
    const h = await harness(protocol, {}, (s) =>
      intercept(s, (call) => {
        if (when(call)) throw boom();
      }),
    );
    const result = await h.store.put(withThumb());
    expect(result).toEqual({ ok: false, error: { kind: "offline", reason: "storage" } });
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("removes everything when build throws, returns junk, a wrong type, or too much", async () => {
    const cases: Array<() => Promise<unknown>> = [
      async () => {
        throw new Error("secret?token=1");
      },
      async () => ({ body: "{}", contentType: "application/ld+json" }),
      async () => ({ body: "{}", contentType: "text/html" }),
      async () => ({ body: 5 as unknown as string, contentType: "text/turtle" }),
    ];
    for (const build of cases) {
      const h = await harness(protocol, { build: build as never });
      const result = await h.store.put(withThumb());
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(await allResources(h.storage)).toEqual([]);
    }
    const huge = await harness(protocol, {
      maxDescriptionBytes: 8,
    });
    expect(await huge.store.put(withThumb())).toEqual({
      ok: false,
      error: { kind: "too-large", reason: "description-too-large" },
    });
    expect(await allResources(huge.storage)).toEqual([]);
    const pointsAway = await harness(protocol, {
      build: async (url) => ({
        contentType: "application/ld+json",
        body: JSON.stringify({ "@type": "ex:Media", contentUrl: `${url}-elsewhere` }),
      }),
    });
    expect(await pointsAway.store.put(withThumb())).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-invalid" },
    });
    const unparseable = await harness(protocol, { parse: async () => undefined });
    expect((await unparseable.store.put(withThumb())).ok).toBe(false);
    const throwingLocate = await harness(protocol, {
      locate: () => {
        throw new Error("nope");
      },
    });
    expect((await throwingLocate.store.put(withThumb())).ok).toBe(false);
    expect(await allResources(throwingLocate.storage)).toEqual([]);
  });

  it("never deletes a resource it found: an adopted binary survives a later failure", async () => {
    if (protocol === "lws") return;
    const h = await harness(protocol);
    const first = await h.store.put(putInput());
    if (!first.ok) throw new Error("setup");
    await h.storage.delete(first.value.descriptionUrl, {
      ifMatch: (await h.storage.head(first.value.descriptionUrl)).etag as string,
    });
    const second = await harness(protocol, {}, (s) =>
      intercept(s, (call) => {
        if (isDescriptionCreate(call)) throw boom();
      }),
    );
    // Same pod, a second device that fails at the description step.
    const device = await second.reopen({
      storage: intercept(h.storage, (call) => {
        if (isDescriptionCreate(call)) throw boom();
      }),
    });
    expect((await device.put(putInput())).ok).toBe(false);
    expect(await allResources(h.storage)).toEqual([first.value.binaryUrl]);
  });

  it("deletes conditionally on its own create ETag: a modified binary is reported, not deleted", async () => {
    const h = await harness(protocol, {}, (s) =>
      intercept(s, async (call) => {
        if (isDescriptionCreate(call)) {
          // Another writer replaces the binary after this call created it.
          const binary = (await allResources(s)).find((url) => /\.png$/.test(url)) as string;
          await s.write(binary, new Uint8Array([1, 2, 3]), {
            contentType: "image/png",
            ifMatch: "*",
          });
          throw boom();
        }
      }),
    );
    const result = await h.store.put(putInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.orphans).toHaveLength(1);
    const remaining = await allResources(h.storage);
    expect(remaining).toEqual(result.error.orphans);
    const kept = await (await h.storage.read(remaining[0] as string)).bytes();
    expect(Array.from(kept)).toEqual([1, 2, 3]);
  });

  it("reports resources it cannot delete conditionally (no response ETag, or delete refused)", async () => {
    const noEtag = await harness(
      protocol,
      {},
      (s) =>
        new Proxy(
          intercept(s, (call) => {
            if (isDescriptionCreate(call)) throw boom();
          }),
          {
            get(target, property, receiver) {
              if (property !== "create") return Reflect.get(target, property, receiver);
              return async (...args: Parameters<StorageClient["create"]>) => ({
                ...(await target.create(...args)),
                etagSource: "follow-up" as const,
              });
            },
          },
        ),
    );
    const result = await noEtag.store.put(putInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.orphans).toHaveLength(1);
    expect(await allResources(noEtag.storage)).toEqual(result.error.orphans);

    const refused = await harness(protocol, {}, (s) =>
      intercept(s, (call) => {
        if (isDescriptionCreate(call)) throw boom();
        if (call.method === "delete")
          throw new StorageError("forbidden", { url: "x:", method: "DELETE" });
      }),
    );
    const denied = await refused.store.put(putInput());
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.orphans).toHaveLength(1);
  });

  it("treats a resource that vanished during cleanup as already removed", async () => {
    const h = await harness(protocol, {}, (s) =>
      intercept(s, async (call) => {
        if (isDescriptionCreate(call)) {
          const binary = (await allResources(s)).find((url) => /\.png$/.test(url)) as string;
          await s.delete(binary, { ifMatch: (await s.head(binary)).etag as string });
          throw boom();
        }
      }),
    );
    const result = await h.store.put(putInput());
    expect(result).toEqual({ ok: false, error: { kind: "offline", reason: "storage" } });
  });
});

describe("two writers of the same bytes (Solid)", () => {
  it("converge on one pair when they run concurrently", async () => {
    const h = await harness("solid");
    const other = await h.reopen();
    const [a, b] = await Promise.all([h.store.put(putInput()), other.put(putInput())]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.descriptionUrl).toBe(b.value.descriptionUrl);
    expect(a.value.binaryUrl).toBe(b.value.binaryUrl);
    expect(await allResources(h.storage)).toHaveLength(2);
    expect((await h.store.get(a.value.descriptionUrl)).ok).toBe(true);
  });

  it("D1: A's compensation does not delete the bytes B's description now points at", async () => {
    const h = await harness("solid");
    const b = await h.reopen();
    let bResult: unknown;
    const a = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        // A has created the binary; before A creates its description B completes a whole put.
        if (isDescriptionCreate(call)) {
          bResult = await b.put(putInput());
          throw boom();
        }
      }),
    });
    const result = await a.put(putInput());
    expect(result).toEqual({ ok: false, error: { kind: "offline", reason: "storage" } });
    expect((bResult as { ok: boolean }).ok).toBe(true);
    const value = (bResult as { value: { descriptionUrl: string; binaryUrl: string } }).value;
    // B's description is intact and its bytes still hash to the content name.
    const listed = await b.get(value.descriptionUrl);
    expect(listed.ok).toBe(true);
    const bytes = await (await h.storage.read(value.binaryUrl)).bytes();
    expect(await sha256Of(bytes)).toBe(await sha256Of(png(1)));
    expect(await allResources(h.storage)).toHaveLength(2);
  });

  it("keeps the bytes when the description lookup in cleanup itself fails", async () => {
    const h = await harness("solid");
    let armed = false;
    const a = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isDescriptionCreate(call)) {
          armed = true;
          throw boom();
        }
        if (armed && call.method === "listAll") throw boom();
      }),
    });
    const result = await a.put(putInput());
    expect(result.ok).toBe(false);
    expect(await allResources(h.storage)).toHaveLength(1);
  });
});

describe("hostile or half-finished resources at the content name (Solid)", () => {
  async function seeded() {
    const h = await harness("solid");
    const seed = await h.store.put(putInput({ seed: 9, description: { name: "seed" } }));
    if (!seed.ok) throw new Error("setup");
    const shard = shardOf(h.store);
    const hash = await sha256Of(png(1));
    return { h, shard, hash };
  }

  it("wrong bytes at the binary name: conflict, nothing overwritten", async () => {
    const { h, shard, hash } = await seeded();
    const evil = await h.storage.create(shard, png(5), {
      name: `${hash}.png`,
      contentType: "image/png",
    });
    const before = await allResources(h.storage);
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "hash-mismatch" },
    });
    expect(await allResources(h.storage)).toEqual(before);
    expect(Array.from(await (await h.storage.read(evil.url)).bytes())).toEqual(Array.from(png(5)));
  });

  it("right bytes but a parseable description pointing elsewhere: conflict, kept as found", async () => {
    const { h, shard, hash } = await seeded();
    const binary = await h.storage.create(shard, png(1), {
      name: `${hash}.png`,
      contentType: "image/png",
    });
    const other = (await allResources(h.storage)).find(
      (url) => url.endsWith(".png") && url !== binary.url,
    ) as string;
    const body = JSON.stringify({ "@type": "ex:Media", name: "mine now", contentUrl: other });
    const desc = await h.storage.create(shard, body, {
      name: hash,
      contentType: "application/ld+json",
    });
    const result = await h.store.put(putInput());
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "description-mismatch" },
    });
    expect(await text(h.storage, desc.url)).toBe(body);
    expect((await h.storage.head(binary.url)).etag).toBe(binary.etag);
  });

  it("an unparseable document at the description name is a conflict", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, "{}", { name: hash, contentType: "application/ld+json" });
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "description-mismatch" },
    });
  });

  it("a description that stays empty is reported as pending and left alone", async () => {
    const { h, shard, hash } = await seeded();
    const empty = await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const result = await h.store.put(putInput());
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "description-pending" },
    });
    expect((await h.storage.head(empty.url)).etag).toBe(empty.etag);
  });

  it("waits for a description another writer fills, then reports it existed", async () => {
    const { h, shard, hash } = await seeded();
    const first = await h.store.put(putInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = await text(h.storage, first.value.descriptionUrl);
    await h.storage.delete(first.value.descriptionUrl, {
      ifMatch: (await h.storage.head(first.value.descriptionUrl)).etag as string,
    });
    const empty = await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const waiting = await h.reopen({
      sleep: async () => {
        await h.storage.write(empty.url, original, {
          contentType: "application/ld+json",
          ifMatch: "*",
        });
      },
    });
    expect(await waiting.put(putInput())).toEqual({
      ok: true,
      value: { ...first.value, existed: true },
    });
  });

  it("recreates a description that vanished while it was being awaited", async () => {
    const { h, shard, hash } = await seeded();
    const empty = await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const waiting = await h.reopen({
      sleep: async () => {
        await h.storage.delete(empty.url, { ifMatch: "*" }).catch(async () => {
          await h.storage.delete(empty.url, {
            ifMatch: (await h.storage.head(empty.url)).etag as string,
          });
        });
      },
    });
    const result = await waiting.put(putInput());
    expect(result.ok).toBe(true);
  });

  it("gives up when the description keeps disappearing between create and read", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const flaky = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "read" && String(call.args[0]).endsWith(`/${hash}`)) {
          throw new StorageError("not-found", { url: "x:", method: "GET" });
        }
      }),
    });
    expect(await flaky.put(putInput())).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "description-pending" },
    });
  });

  it("a name that is taken but cannot be found again is a conflict", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, png(1), { name: `${hash}.png`, contentType: "image/png" });
    const blind = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "listAll" && call.args[0] === shard)
          throw new StorageError("not-found", { url: "x:", method: "GET" });
      }),
    });
    expect((await blind.put(putInput())).ok).toBe(false);
    const liar = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isBinaryCreate(call))
          throw new StorageError("conflict", { url: "x:", method: "PUT", status: 412 });
      }),
    });
    expect(await liar.put(putInput({ seed: 3 }))).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "name-unavailable" },
    });
  });

  it("adopts a thumbnail already at its name when it is an image, rejects one that is not", async () => {
    const { h, shard, hash } = await seeded();
    const name = `${hash}-thumb.jpg`;
    await h.storage.create(shard, jpeg(4), { name, contentType: "image/jpeg" });
    const ok = await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }));
    expect(ok.ok).toBe(true);
    const h2 = await seeded();
    await h2.h.storage.create(h2.shard, new TextEncoder().encode("<svg/>"), {
      name: `${h2.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    expect(await h2.h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "hash-mismatch" },
    });
    const h3 = await seeded();
    await h3.h.storage.create(h3.shard, jpeg(4), {
      name: `${h3.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const blind = await h3.h.reopen({
      storage: intercept(h3.h.storage, (call) => {
        if (call.method === "listAll" && call.args[0] === h3.shard)
          throw new StorageError("not-found", { url: "x:", method: "GET" });
      }),
    });
    expect((await blind.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).ok).toBe(false);
    const h4 = await seeded();
    await h4.h.storage.create(h4.shard, jpeg(4), {
      name: `${h4.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const big = await h4.h.reopen({ maxThumbnailBytes: 30 });
    expect(await big.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: true,
      value: expect.anything(),
    });
    const h5 = await seeded();
    await h5.h.storage.create(h5.shard, new Uint8Array(40).fill(0xff), {
      name: `${h5.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const small = await h5.h.reopen({ maxThumbnailBytes: 30 });
    expect(await small.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: { kind: "too-large", reason: "bytes-too-large" },
    });
  });

  it("refuses to adopt a binary larger than maxBytes", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, png(1, 64), { name: `${hash}.png`, contentType: "image/png" });
    const strict = await h.reopen({ maxBytes: 40 });
    expect(await strict.put(putInput({ bytes: png(1, 32) }))).toEqual({
      ok: false,
      error: { kind: "too-large", reason: "bytes-too-large" },
    });
  });
});

describe("server-chosen names (LWS)", () => {
  it("never derives a URL: it uses what each create returned", async () => {
    const h = await harness("lws", {}, serverNames);
    const result = await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }));
    if (!result.ok) throw new Error(result.error.reason);
    const hash = result.value.sha256;
    for (const url of [
      result.value.binaryUrl,
      result.value.descriptionUrl,
      result.value.thumbnailUrl as string,
    ]) {
      expect(url).not.toContain(hash);
    }
    const stored = await h.store.get(result.value.descriptionUrl);
    expect(stored.ok && stored.value.value.binaryUrl).toBe(result.value.binaryUrl);
    const listed = await h.store.list();
    expect(listed.ok && listed.value.items).toHaveLength(1);
  });

  it("without findByHash the same bytes make a second pair; with it they converge", async () => {
    const h = await harness("lws", {}, serverNames);
    await h.store.put(putInput());
    await h.store.put(putInput());
    expect(await allResources(h.storage)).toHaveLength(4);

    const index = new Map<string, string>();
    const dedupe = await harness(
      "lws",
      {
        findByHash: async (hash) =>
          index.has(hash) ? { descriptionUrl: index.get(hash) as string } : undefined,
      },
      serverNames,
    );
    const first = await dedupe.store.put(putInput());
    if (!first.ok) throw new Error("first");
    index.set(first.value.sha256, first.value.descriptionUrl);
    const second = await dedupe.store.put(putInput());
    expect(second).toEqual({ ok: true, value: { ...first.value, existed: true } });
    expect(await allResources(dedupe.storage)).toHaveLength(2);
  });

  it("findByHash hits are verified: wrong bytes, wrong description, vanished, no library", async () => {
    const h = await harness("lws", {}, serverNames);
    const first = await h.store.put(putInput());
    if (!first.ok) throw new Error("first");
    const stale = { descriptionUrl: first.value.descriptionUrl };
    // Bytes behind the binary no longer match the content hash.
    await h.storage
      .write(first.value.binaryUrl, new Uint8Array([9]), { contentType: "image/png", ifMatch: "*" })
      .catch(() => undefined);
    const hit = await h.reopen({ findByHash: async () => stale });
    const mismatch = await hit.put(putInput());
    expect(mismatch.ok).toBe(false);

    const gone = await h.reopen({
      findByHash: async () => ({ descriptionUrl: `${first.value.descriptionUrl}-gone` }),
    });
    const recreated = await gone.put(putInput({ seed: 5 }));
    expect(recreated.ok).toBe(true);

    const foreign = await h.reopen({
      findByHash: async () => ({ descriptionUrl: first.value.binaryUrl }),
    });
    expect((await foreign.put(putInput({ seed: 6 }))).ok).toBe(false);

    const fresh = await harness("lws", {
      findByHash: async () => ({ descriptionUrl: `${ROOT_LIB}x` }),
    });
    expect(await fresh.store.put(putInput())).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "no-library" },
    });
    const broken = await h.reopen({
      findByHash: async () => stale,
      storage: intercept(h.storage, (call) => {
        if (call.method === "read")
          throw new StorageError("forbidden", { url: "x:", method: "GET" });
      }),
    });
    expect(await broken.put(putInput())).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
  });
});

const ROOT_LIB = "https://pod.example/alice/media/2026/05/";
