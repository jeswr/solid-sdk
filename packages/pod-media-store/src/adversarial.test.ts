// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  descriptions,
  harness,
  intercept,
  jpeg,
  must,
  png,
  putInput,
  serverNames,
  sha256Of,
  shardOf,
  text,
  withoutResponseEtags,
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
const offline = { ok: false, error: expect.objectContaining({ kind: "offline" }) };

describe.each([
  "solid",
  "lws",
] as const)("a failed put leaves nothing that blocks a retry (%s)", (protocol) => {
  const withThumb = () => putInput({ thumbnail: { bytes: jpeg(1) } });

  it.each([
    ["thumbnail create", isThumbCreate],
    ["description create", isDescriptionCreate],
    ["description write", isWrite],
  ])("V1: when the %s fails the media stay, are reported, and the retry converges", async (_label, when) => {
    // Solid never creates an empty description, so it has no write step to fail.
    if (protocol === "solid" && when === isWrite) return;
    let failing = true;
    const h = await harness(protocol, {}, (s) =>
      intercept(s, (call) => {
        if (failing && when(call)) throw boom();
      }),
    );
    const result = await h.store.put(withThumb());
    expect(result).toEqual(offline);
    if (result.ok) return;
    // Nothing is deleted by guesswork and nothing is half-written: every description that
    // remains is complete, and every resource that remains is either reported or a media file.
    for (const url of await descriptions(h.storage)) {
      expect((await text(h.storage, url)).length).toBeGreaterThan(0);
    }
    const media = (await allResources(h.storage)).filter((url) => !/[0-9a-f]{64}$/.test(url));
    expect([...(result.error.orphans ?? [])].sort()).toEqual(
      (await allResources(h.storage)).filter((url) => media.includes(url) || false).sort(),
    );
    failing = false;
    // The same put, in this session and in a fresh one, succeeds: no poisoned hash.
    expect((await h.store.put(withThumb())).ok).toBe(true);
    expect(must(await (await h.reopen()).list()).items.length).toBeGreaterThanOrEqual(1);
    await h.store.sweepOrphans({ minAgeMs: 0 });
    expect((await descriptions(h.storage)).length).toBeGreaterThanOrEqual(1);
  });

  it("a failure leaves the media, never a half-written description, and sweepOrphans clears them", async () => {
    const h = await harness(protocol, {
      build: async () => ({ body: "{}", contentType: "text/html" }),
    });
    const result = await h.store.put(withThumb());
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "description-invalid" }),
    });
    expect(await descriptions(h.storage)).toEqual([]);
    expect(await allResources(h.storage)).toHaveLength(2);
    expect(must(await h.store.sweepOrphans())).toEqual({
      deleted: 0,
      retained: 2,
      shardsSkipped: 0,
    });
    expect(must(await h.store.sweepOrphans({ minAgeMs: 0 }))).toEqual({
      deleted: 2,
      retained: 0,
      shardsSkipped: 0,
    });
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("rejects what build gets wrong without leaking a server message", async () => {
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
      expect(await descriptions(h.storage)).toEqual([]);
    }
    const huge = await harness(protocol, { maxDescriptionBytes: 8 });
    expect(await huge.store.put(withThumb())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "too-large", reason: "description-too-large" }),
    });
    const pointsAway = await harness(protocol, {
      build: async (url) => ({
        contentType: "application/ld+json",
        body: JSON.stringify({ "@type": "ex:Media", contentUrl: `${url}-elsewhere` }),
      }),
    });
    expect(await pointsAway.store.put(withThumb())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "failed", reason: "description-invalid" }),
    });
    const forgetsThumbnail = await harness(protocol, {
      build: async (url, binaryUrl) => ({
        contentType: "application/ld+json",
        body: JSON.stringify({ "@id": url, "@type": "ex:Media", contentUrl: binaryUrl }),
      }),
    });
    expect(await forgetsThumbnail.store.put(withThumb())).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "description-invalid" }),
    });
    expect((await harness(protocol, { parse: async () => undefined })).store.put).toBeDefined();
    const unparseable = await harness(protocol, { parse: async () => undefined });
    expect((await unparseable.store.put(withThumb())).ok).toBe(false);
    const throwingLocate = await harness(protocol, {
      locate: () => {
        throw new Error("nope");
      },
    });
    expect((await throwingLocate.store.put(withThumb())).ok).toBe(false);
    expect(await descriptions(throwingLocate.storage)).toEqual([]);
  });

  it("never deletes a resource it found: an adopted binary survives a later failure", async () => {
    if (protocol === "lws") return;
    const h = await harness(protocol);
    const first = must(await h.store.put(putInput()));
    await h.storage.delete(first.descriptionUrl, {
      ifMatch: (await h.storage.head(first.descriptionUrl)).etag as string,
    });
    const device = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isDescriptionCreate(call)) throw boom();
      }),
    });
    const failed = await device.put(putInput());
    expect(failed.ok).toBe(false);
    // The adopted binary was not created by this call, so it is not reported either.
    expect(failed.ok === false && failed.error.orphans).toBeUndefined();
    expect(await allResources(h.storage)).toEqual([first.binaryUrl]);
  });
});

describe("LWS: the empty document made for a description is never left to poison anything", () => {
  const failingWrite = (extra?: (call: Call) => void) => (s: Parameters<typeof intercept>[0]) =>
    intercept(s, (call) => {
      extra?.(call);
      if (isWrite(call)) throw boom();
    });

  it("is removed when the put fails after creating it", async () => {
    const h = await harness("lws", {}, failingWrite());
    const result = await h.store.put(putInput());
    expect(result).toEqual(offline);
    expect(await allResources(h.storage)).toHaveLength(1);
    expect(result.ok === false && result.error.orphans).toEqual(await allResources(h.storage));
  });

  it("is reported, then collected by sweepOrphans, when it cannot be removed", async () => {
    const h = await harness("lws", {}, (s) =>
      intercept(s, (call) => {
        if (isWrite(call)) throw boom();
        if (call.method === "delete")
          throw new StorageError("forbidden", { url: "x:", method: "DELETE" });
      }),
    );
    const result = await h.store.put(putInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.orphans).toHaveLength(2);
    // An empty description is a visible, removable state: `remove` deletes it.
    const shell = (await descriptions(h.storage))[0] as string;
    const store = await h.reopen({ storage: h.storage });
    expect(must(await store.list()).skipped.pending).toBe(1);
    expect(await store.remove(shell)).toEqual({ ok: true, value: undefined });
    expect(await descriptions(h.storage)).toEqual([]);
  });

  it("leaves a shell that someone has filled in the meantime", async () => {
    const h = await harness("lws", {}, (s) =>
      intercept(s, async (call) => {
        if (isWrite(call)) {
          const url = (await descriptions(s))[0] as string;
          await s.write(url, "{}", {
            contentType: "application/ld+json",
            ifMatch: (await s.head(url)).etag as string,
          });
          throw boom();
        }
      }),
    );
    const result = await h.store.put(putInput());
    expect(result.ok === false && result.error.orphans).toHaveLength(2);
  });

  it("treats a shell that is already gone as removed", async () => {
    const h = await harness("lws", {}, (s) =>
      intercept(s, async (call) => {
        if (isWrite(call)) {
          const url = (await descriptions(s))[0] as string;
          await s.delete(url, { ifMatch: (await s.head(url)).etag as string });
          throw boom();
        }
      }),
    );
    const result = await h.store.put(putInput());
    expect(result.ok === false && result.error.orphans).toHaveLength(1);
  });

  it("writes on the validator it observed, from a HEAD when the create gave none, never on *", async () => {
    const writes: unknown[] = [];
    const h = await harness("lws", {}, (s) =>
      intercept(withoutResponseEtags(s, null), (call) => {
        if (isWrite(call)) writes.push((call.args[2] as { ifMatch: string }).ifMatch);
      }),
    );
    expect((await h.store.put(putInput())).ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/\S/);
    expect(writes[0]).not.toBe("*");
    const blind = await harness("lws", {}, (s) =>
      intercept(withoutResponseEtags(s, null), async (call) => {
        void call;
      }),
    );
    const headless = await blind.reopen({
      storage: new Proxy(blind.seen, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (property !== "head") return typeof value === "function" ? value.bind(target) : value;
          return async (...args: Parameters<typeof target.head>) => ({
            ...(await target.head(...args)),
            etag: null,
          });
        },
      }),
    });
    expect(await headless.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "failed", reason: "no-validator" }),
    });
  });
});

describe.each([
  "solid",
  "lws",
] as const)("a server without create-response ETags (%s)", (protocol) => {
  for (const mode of ["follow-up", null] as const) {
    it(`F-02: the whole put and remove cycle works on ${mode ?? "no"} validators from the create`, async () => {
      const written: unknown[] = [];
      const h = await harness(protocol, {}, (s) =>
        intercept(withoutResponseEtags(s, mode), (call) => {
          if (isWrite(call) || call.method === "delete") {
            written.push(
              (call.args[1] ?? call.args[2]) && (call.args[2] as { ifMatch?: string })?.ifMatch,
            );
          }
        }),
      );
      const put = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
      expect(await allResources(h.storage)).toHaveLength(3);
      const edited = await h.store.update(put.descriptionUrl, async (current) => ({
        body: current.body.replace("first", "second"),
        contentType: current.contentType,
      }));
      expect(edited.ok).toBe(true);
      expect(await h.store.remove(put.descriptionUrl)).toEqual({ ok: true, value: undefined });
      expect(await allResources(h.storage)).toEqual([]);
      for (const ifMatch of written) expect(ifMatch).not.toBe("*");
    });

    it(`F-02: a put that fails on ${mode ?? "no"} validators leaves media and no empty description`, async () => {
      const h = await harness(protocol, {}, (s) =>
        intercept(withoutResponseEtags(s, mode), (call) => {
          if (isWrite(call) || isDescriptionCreate(call)) throw boom();
        }),
      );
      expect((await h.store.put(putInput())).ok).toBe(false);
      for (const url of await descriptions(h.storage)) {
        expect((await text(h.storage, url)).length).toBeGreaterThan(0);
      }
      expect(
        must(await (await h.reopen()).sweepOrphans({ minAgeMs: 0 })).deleted,
      ).toBeGreaterThanOrEqual(1);
    });
  }
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

  it("V3: a failed writer deletes nothing, so the other's description never points at nothing", async () => {
    const h = await harness("solid");
    const b = await h.reopen();
    let bResult: unknown;
    const a = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        // A has created the binary; before A builds its description B completes a whole put.
        if (isDescriptionCreate(call)) {
          bResult = await b.put(putInput());
          throw boom();
        }
      }),
    });
    expect(await a.put(putInput())).toEqual(offline);
    const value = must(bResult as never) as { descriptionUrl: string; binaryUrl: string };
    expect((await b.get(value.descriptionUrl)).ok).toBe(true);
    const bytes = await (await h.storage.read(value.binaryUrl)).bytes();
    expect(await sha256Of(bytes)).toBe(await sha256Of(png(1)));
    expect(await allResources(h.storage)).toHaveLength(2);
  });

  it("loses the create race to a complete description and adopts it", async () => {
    const h = await harness("solid");
    const winner = await h.reopen();
    let raced = false;
    const loser = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (isDescriptionCreate(call) && !raced) {
          raced = true;
          must(await winner.put(putInput({ description: { name: "winner" } })));
        }
      }),
    });
    const result = must(await loser.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    // The loser made the binary itself, so not everything "already existed".
    expect(result.existed).toBe(false);
    // The winner's description has no thumbnail, so the caller is told to attach one.
    expect(result.thumbnailUrl).toBeUndefined();
    expect(result.thumbnailMissing).toBe(true);
    const stored = must(await h.store.get(result.descriptionUrl));
    expect(stored.value.name).toBe("winner");
  });

  it("gives up with a conflict when the name keeps being taken by something that is not there", async () => {
    const h = await harness("solid", {}, (s) =>
      intercept(s, (call) => {
        if (isDescriptionCreate(call)) {
          throw new StorageError("conflict", { url: "x:", method: "PUT", status: 412 });
        }
      }),
    );
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "conflict", reason: "retries-exhausted" }),
    });
  });

  it("refuses a create that answers at another URL than the one the description was built for", async () => {
    const h = await harness(
      "solid",
      {},
      (s) =>
        new Proxy(s, {
          get(target, property) {
            const value = Reflect.get(target, property) as unknown;
            if (typeof value !== "function") return value;
            if (property !== "create") return value.bind(target);
            return async (...args: Parameters<typeof target.create>) => {
              const made = await target.create(...args);
              return /^[0-9a-f]{64}$/.test(args[2]?.name ?? "")
                ? { ...made, url: `${made.url}x` }
                : made;
            };
          },
        }),
    );
    const result = await h.store.put(putInput());
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "failed", reason: "name-unavailable" }),
    });
  });
});

describe("hostile or half-finished resources at the content name (Solid)", () => {
  async function seeded() {
    const h = await harness("solid");
    must(await h.store.put(putInput({ seed: 9, description: { name: "seed" } })));
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
      error: expect.objectContaining({ kind: "conflict", reason: "hash-mismatch" }),
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
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "conflict", reason: "description-mismatch" }),
    });
    expect(await text(h.storage, desc.url)).toBe(body);
    expect((await h.storage.head(binary.url)).etag).toBe(binary.etag);
  });

  it("an unparseable document at the description name is a conflict", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, "{}", { name: hash, contentType: "application/ld+json" });
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "conflict", reason: "description-mismatch" }),
    });
  });

  it("an empty shell at the description name is taken over on its own validator", async () => {
    const { h, shard, hash } = await seeded();
    const shell = await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const writes: unknown[] = [];
    const store = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isWrite(call)) writes.push((call.args[2] as { ifMatch: string }).ifMatch);
      }),
    });
    const result = must(await store.put(putInput()));
    expect(result.descriptionUrl).toBe(shell.url);
    expect(result.existed).toBe(false);
    expect(writes).toEqual([shell.etag]);
    expect((await store.get(shell.url)).ok).toBe(true);
  });

  it("an empty shell without a validator cannot be taken over", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const blind = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "read") return value.bind(target);
          return async (...args: Parameters<typeof target.read>) => {
            const result = await target.read(...args);
            return String(args[0]).endsWith(hash) ? Object.assign(result, { etag: null }) : result;
          };
        },
      }),
    });
    expect(await blind.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "failed", reason: "no-validator" }),
    });
  });

  it("a shell someone else fills first is adopted after the lost conditional write", async () => {
    const { h, shard, hash } = await seeded();
    const shell = await h.storage.create(shard, "", { name: hash, contentType: "text/turtle" });
    const rival = await h.reopen();
    const racing = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (isWrite(call) && call.args[0] === shell.url) {
          await h.storage.delete(shell.url, {
            ifMatch: (await h.storage.head(shell.url)).etag as string,
          });
          must(await rival.put(putInput({ description: { name: "rival" } })));
        }
      }),
    });
    const result = must(await racing.put(putInput()));
    expect(result.descriptionUrl).toBe(shell.url);
    expect(must(await h.store.get(shell.url)).value.name).toBe("rival");
  });

  it("a name that is taken but cannot be found again is a conflict", async () => {
    const { h } = await seeded();
    const liar = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isBinaryCreate(call)) {
          throw new StorageError("conflict", { url: "x:", method: "PUT", status: 412 });
        }
      }),
    });
    expect(await liar.put(putInput({ seed: 3 }))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "conflict", reason: "name-unavailable" }),
    });
    const other = await liar.put(putInput({ seed: 3, thumbnail: { bytes: jpeg(1) } }));
    expect(other.ok).toBe(false);
    const readFails = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (isBinaryCreate(call)) {
          throw new StorageError("conflict", { url: "x:", method: "PUT", status: 412 });
        }
        if (call.method === "read" && String(call.args[0]).endsWith(".png")) {
          throw new StorageError("forbidden", { url: "x:", method: "GET" });
        }
      }),
    });
    expect(await readFails.put(putInput({ seed: 3 }))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "forbidden" }),
    });
  });

  it("adopts a thumbnail already at its name when it is an image, rejects one that is not", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, jpeg(4), {
      name: `${hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    expect((await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).ok).toBe(true);
    const h2 = await seeded();
    await h2.h.storage.create(h2.shard, new TextEncoder().encode("<svg/>"), {
      name: `${h2.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    expect(await h2.h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "conflict", reason: "hash-mismatch" }),
    });
    const h4 = await seeded();
    await h4.h.storage.create(h4.shard, jpeg(4), {
      name: `${h4.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const big = await h4.h.reopen({ maxThumbnailBytes: 30 });
    expect((await big.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).ok).toBe(true);
    const h5 = await seeded();
    await h5.h.storage.create(h5.shard, new Uint8Array(40).fill(0xff), {
      name: `${h5.hash}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    const small = await h5.h.reopen({ maxThumbnailBytes: 30 });
    expect(await small.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "too-large", reason: "bytes-too-large" }),
    });
  });

  it("refuses to adopt a binary larger than maxBytes", async () => {
    const { h, shard, hash } = await seeded();
    await h.storage.create(shard, png(1, 64), { name: `${hash}.png`, contentType: "image/png" });
    const strict = await h.reopen({ maxBytes: 40 });
    expect(await strict.put(putInput({ bytes: png(1, 32) }))).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "too-large", reason: "bytes-too-large" }),
    });
  });
});

describe("a thumbnail for an item that already exists (F-08)", () => {
  it("is not uploaded, is reported as missing, and attachThumbnail links it", async () => {
    const h = await harness("solid");
    const first = must(await h.store.put(putInput()));
    const second = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    expect(second).toMatchObject({
      existed: true,
      thumbnailUrl: undefined,
      thumbnailMissing: true,
    });
    expect(await allResources(h.storage)).toHaveLength(2);
    const attached = must(
      await h.store.attachThumbnail(first.descriptionUrl, {
        bytes: jpeg(1),
        mutate: async (current, thumbnailUrl) => ({
          contentType: current.contentType,
          body: JSON.stringify({ ...JSON.parse(current.body), thumbnailUrl }),
        }),
      }),
    );
    expect(attached.thumbnailUrl).toBeDefined();
    expect(await allResources(h.storage)).toHaveLength(3);
    // Linked now: put reports it and remove deletes it with the rest.
    expect(must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).thumbnailUrl).toBe(
      attached.thumbnailUrl,
    );
    expect((await h.store.remove(first.descriptionUrl)).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual([]);
  });
});

describe("server-chosen names (LWS)", () => {
  it("never derives a URL: it uses what each create returned", async () => {
    const h = await harness("lws", {}, serverNames);
    const result = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    for (const url of [result.binaryUrl, result.descriptionUrl, result.thumbnailUrl as string]) {
      expect(url).not.toContain(result.sha256);
    }
    const stored = must(await h.store.get(result.descriptionUrl));
    expect(stored.value.binaryUrl).toBe(result.binaryUrl);
    expect(must(await h.store.list()).items).toHaveLength(1);
  });

  it("V5: a new session still sees the shards, because their titles were stored", async () => {
    const h = await harness("lws", {}, serverNames);
    must(await h.store.put(putInput()));
    const next = await h.reopen();
    expect(must(await next.list()).items).toHaveLength(1);
    must(await next.put(putInput({ seed: 2 })));
    expect(must(await (await h.reopen()).list()).items).toHaveLength(2);
    const years: string[] = [];
    for await (const entry of h.storage.listAll(next.library as string)) years.push(entry.url);
    expect(years).toHaveLength(1);
  });

  it("fails loudly when the title cannot be stored", async () => {
    const refusing = async (patch: (s: Parameters<typeof intercept>[0]) => unknown) => {
      const h = await harness("lws", {}, (s) => patch(serverNames(s)) as never);
      return h.store.put(putInput());
    };
    const shardTitle = {
      ok: false,
      error: expect.objectContaining({ kind: "failed", reason: "shard-title" }),
    };
    expect(
      await refusing(
        (s) =>
          new Proxy(s, {
            get(target, property) {
              const value = Reflect.get(target, property) as unknown;
              if (property === "setMetadata") {
                return async () => {
                  throw new StorageError("forbidden", { url: "x:", method: "PATCH" });
                };
              }
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
      ),
    ).toEqual(shardTitle);
    expect(
      await refusing(
        (s) =>
          new Proxy(s, {
            get(target, property) {
              const value = Reflect.get(target, property) as unknown;
              if (property === "metadata") {
                return async (...args: Parameters<typeof target.metadata>) => ({
                  ...(await target.metadata(...args)),
                  etag: null,
                });
              }
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
      ),
    ).toEqual(shardTitle);
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
    const first = must(await dedupe.store.put(putInput()));
    index.set(first.sha256, first.descriptionUrl);
    const second = await dedupe.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }));
    expect(second).toEqual({
      ok: true,
      value: { ...first, existed: true, thumbnailMissing: true },
    });
    expect(await allResources(dedupe.storage)).toHaveLength(2);
  });

  it("findByHash hits are verified, and a stale or foreign hit is a miss, not a failure", async () => {
    const h = await harness("lws", {}, serverNames);
    const first = must(await h.store.put(putInput()));
    const stale = { descriptionUrl: first.descriptionUrl };
    const shape = (hit: unknown) => h.reopen({ findByHash: async () => hit as never });
    // The bytes behind the binary no longer match the content hash.
    await h.storage.write(first.binaryUrl, new Uint8Array([9]), {
      contentType: "image/png",
      ifMatch: (await h.storage.head(first.binaryUrl)).etag as string,
    });
    expect((await (await shape(stale)).put(putInput())).ok).toBe(false);
    // Vanished, outside the library, not a description, garbage, or no library yet: all misses.
    for (const hit of [
      { descriptionUrl: `${first.descriptionUrl}-gone` },
      { descriptionUrl: "https://pod.example/alice/profile/card" },
      {},
      undefined,
      { descriptionUrl: 42 },
    ]) {
      expect((await (await shape(hit)).put(putInput({ seed: 5 }))).ok, JSON.stringify(hit)).toBe(
        true,
      );
    }
    const foreign = await shape({ descriptionUrl: first.binaryUrl });
    expect((await foreign.put(putInput({ seed: 6 }))).ok).toBe(false);
    const fresh = await harness("lws", {
      findByHash: async () => ({ descriptionUrl: "https://pod.example/alice/x" }),
    });
    expect((await fresh.store.put(putInput())).ok).toBe(true);
    const broken = await h.reopen({
      findByHash: async () => stale,
      storage: intercept(h.storage, (call) => {
        if (call.method === "read")
          throw new StorageError("forbidden", { url: "x:", method: "GET" });
      }),
    });
    expect(await broken.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "forbidden", reason: "storage" }),
    });
  });
});
