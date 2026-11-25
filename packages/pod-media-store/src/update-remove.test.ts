// AUTHORED-BY Claude Sonnet 5.5
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  type Harness,
  harness,
  intercept,
  jpeg,
  must,
  putInput,
  ROOT,
  shardOf,
  text,
} from "../test/support.js";
import { createMemoryJournal, type DeleteJournal } from "./journal.js";
import type { Current } from "./types.js";

const stored = (current: Current) => JSON.parse(current.body) as Record<string, unknown>;
const jsonld = (value: unknown) => ({
  body: JSON.stringify(value),
  contentType: "application/ld+json",
});
const rename = (name: string) => async (current: Current) => jsonld({ ...stored(current), name });
const boom = () => new StorageError("network", { url: "x:", method: "GET" });

/** A read whose ETag the server did not send. */
function withoutEtag(storage: StorageClient, method: "read" | "head"): StorageClient {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property !== method) return value.bind(target);
      return async (...args: never[]) => {
        const result = await (value as (...a: never[]) => Promise<object>).apply(target, args);
        return { ...result, etag: null };
      };
    },
  });
}

describe.each(["solid", "lws"] as const)("update (%s)", (protocol) => {
  async function one(h: Harness) {
    return must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
  }

  it("edits through mutate and keeps triples another app wrote", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
    const doc = JSON.parse(await text(h.storage, out.descriptionUrl));
    await h.storage.write(out.descriptionUrl, JSON.stringify({ ...doc, other: "kept" }), {
      contentType: "application/ld+json",
      ifMatch: etag,
    });
    const seen: Current[] = [];
    const item = must(
      await h.store.update(out.descriptionUrl, async (current) => {
        seen.push(current);
        return rename("renamed")(current);
      }),
    );
    expect(seen[0]?.url).toBe(out.descriptionUrl);
    expect(seen[0]?.contentType).toBe("application/ld+json");
    expect(item.value.name).toBe("renamed");
    expect(item.value.other).toBe("kept");
    expect(item.etag).not.toBeNull();
    expect(item.modified).toBeNull();
    const after = JSON.parse(await text(h.storage, out.descriptionUrl));
    expect(after.other).toBe("kept");
    expect(after.name).toBe("renamed");
  });

  it("re-reads and reapplies when it loses a race", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    let calls = 0;
    const item = must(
      await h.store.update(out.descriptionUrl, async (current) => {
        calls++;
        if (calls === 1) {
          const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
          await h.storage.write(
            out.descriptionUrl,
            JSON.stringify({ ...stored(current), other: "from another app" }),
            { contentType: "application/ld+json", ifMatch: etag },
          );
        }
        return rename(`attempt ${calls}`)(current);
      }),
    );
    expect(calls).toBe(2);
    expect(item.value.name).toBe("attempt 2");
    expect(item.value.other).toBe("from another app");
  });

  it("gives up with a conflict after the bounded retries, writing nothing of its own", async () => {
    const h = await harness(protocol, { updateAttempts: 3 });
    const out = await one(h);
    let calls = 0;
    const result = await h.store.update(out.descriptionUrl, async (current) => {
      calls++;
      const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
      await h.storage.write(out.descriptionUrl, JSON.stringify({ ...stored(current), n: calls }), {
        contentType: "application/ld+json",
        ifMatch: etag,
      });
      return rename("never lands")(current);
    });
    expect(result).toEqual({ ok: false, error: { kind: "conflict", reason: "retries-exhausted" } });
    expect(calls).toBe(3);
    expect(JSON.parse(await text(h.storage, out.descriptionUrl)).name).toBe("first");
  });

  it("does not write when mutate returns undefined", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    const before = (await h.storage.head(out.descriptionUrl)).etag;
    const item = must(await h.store.update(out.descriptionUrl, async () => undefined));
    expect(item.value.name).toBe("first");
    expect((await h.storage.head(out.descriptionUrl)).etag).toBe(before);
    const shard = shardOf(h.store);
    await h.storage.create(shard, "bad", { name: "bad", contentType: "application/ld+json" });
    const bad = (await allResources(h.storage)).find((url) => url.endsWith("bad")) as string;
    expect(await h.store.update(bad, async () => undefined)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-unparseable" },
    });
  });

  it("refuses a result that is not a valid description and leaves the document alone", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    const before = await text(h.storage, out.descriptionUrl);
    const cases: Array<[() => Promise<never>, string, string]> = [
      [async () => jsonld({ "@type": "ex:Other" }) as never, "failed", "description-invalid"],
      [async () => jsonld({ "@type": "ex:Media" }) as never, "failed", "description-invalid"],
      [
        async () => ({ body: "x", contentType: "text/html" }) as never,
        "failed",
        "description-invalid",
      ],
      [
        async () => ({ body: "", contentType: "application/ld+json" }) as never,
        "failed",
        "description-invalid",
      ],
      [
        async () =>
          jsonld({ "@type": "ex:Media", contentUrl: `${ROOT}private/photo.png` }) as never,
        "failed",
        "description-invalid",
      ],
      [
        async () => jsonld({ "@type": "ex:Media", pad: "x".repeat(2_000_000) }) as never,
        "too-large",
        "description-too-large",
      ],
    ];
    for (const [mutate, kind, reason] of cases) {
      expect(await h.store.update(out.descriptionUrl, mutate)).toEqual({
        ok: false,
        error: { kind, reason },
      });
    }
    expect(await text(h.storage, out.descriptionUrl)).toBe(before);
  });

  it("refuses urls outside the library, pending documents and missing validators", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    expect(await h.store.update(`${ROOT}profile/card`, rename("x"))).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "out-of-scope" },
    });
    await h.storage.create(shardOf(h.store), "", {
      name: "pend",
      contentType: "application/ld+json",
    });
    const pend = (await allResources(h.storage)).find((url) => url.endsWith("pend")) as string;
    expect(await h.store.update(pend, rename("x"))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-pending" },
    });
    const noValidator = await h.reopen({ storage: withoutEtag(h.storage, "read") });
    expect(await noValidator.update(out.descriptionUrl, rename("x"))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "no-validator" },
    });
  });

  it("maps a mutate that throws and a non-conflict storage failure", async () => {
    const h = await harness(protocol);
    const out = await one(h);
    expect(
      await h.store.update(out.descriptionUrl, async () => {
        throw new Error("secret?token=1");
      }),
    ).toEqual({ ok: false, error: { kind: "failed", reason: "unexpected" } });
    const denied = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "write")
          throw new StorageError("forbidden", { url: "x:", method: "PUT" });
      }),
    });
    expect(await denied.update(out.descriptionUrl, rename("x"))).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
  });
});

describe.each(["solid", "lws"] as const)("remove and resumePending (%s)", (protocol) => {
  async function seeded(
    journal: DeleteJournal = createMemoryJournal(),
    wrap?: (s: StorageClient) => StorageClient,
  ) {
    const h = await harness(protocol, { journal }, wrap);
    const out = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    return { h, out, journal };
  }

  it("deletes the description, then the binary and thumbnail, and empties the journal", async () => {
    const { h, out, journal } = await seeded();
    expect(await h.store.remove(out.descriptionUrl)).toEqual({ ok: true, value: undefined });
    expect(await allResources(h.storage)).toEqual([]);
    expect(await journal.list()).toEqual([]);
    expect(await h.store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "storage" },
    });
  });

  it("records the delete before the description goes, and a crash after step one resumes", async () => {
    const journal = createMemoryJournal();
    const h = await harness(protocol, { journal });
    const out = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    const crashing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "head") throw boom();
      }),
    });
    expect(await crashing.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
    const pending = await journal.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.binaryUrl).toBe(out.binaryUrl);
    expect(pending[0]?.thumbnailUrl).toBe(out.thumbnailUrl);
    // Step one happened; the media is still there with nothing pointing at it.
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining([out.binaryUrl, out.thumbnailUrl as string]),
    );
    expect((await h.storage.read(out.descriptionUrl).catch(() => null)) === null).toBe(true);

    const restarted = await h.reopen();
    expect(must(await restarted.resumePending())).toEqual({ completed: 1, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toEqual([]);
    expect(await journal.list()).toEqual([]);
    expect(must(await restarted.resumePending())).toEqual({ completed: 0, failed: 0, rejected: 0 });
  });

  it("resume reports what it cannot finish and keeps those entries", async () => {
    const journal = createMemoryJournal();
    const h = await harness(protocol, { journal });
    const out = must(await h.store.put(putInput()));
    await journal.put({
      descriptionUrl: out.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
    });
    const refusing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "delete")
          throw new StorageError("forbidden", { url: "x:", method: "DELETE" });
      }),
    });
    expect(must(await refusing.resumePending())).toEqual({ completed: 0, failed: 1, rejected: 0 });
    expect(await journal.list()).toHaveLength(1);
    expect(await allResources(h.storage)).toContain(out.binaryUrl);
  });

  it("never deletes outside the item's own shard, whatever the journal says", async () => {
    const journal = createMemoryJournal();
    const h = await harness(protocol, { journal });
    const keep = must(
      await h.store.put(putInput({ seed: 4, createdAt: new Date("2026-03-01T00:00:00Z") })),
    );
    const out = must(await h.store.put(putInput()));
    const secret = await h.storage.create(ROOT, "private photo", {
      name: "secret.png",
      contentType: "image/png",
    });
    const shard = shardOf(h.store);
    await journal.put({
      descriptionUrl: `${shard}gone-1`,
      shardUrl: shard,
      binaryUrl: secret.url,
      thumbnailUrl: keep.binaryUrl,
    });
    await journal.put({
      descriptionUrl: `${ROOT}private/gone-2`,
      shardUrl: `${ROOT}private/`,
      binaryUrl: secret.url,
    });
    await journal.put({
      descriptionUrl: `${shard}gone-3`,
      shardUrl: `${shard}../../../`,
      binaryUrl: out.binaryUrl,
    });
    await journal.put({
      descriptionUrl: `${shard}gone-4`,
      shardUrl: "https://evil.example/alice/media/2026/05/",
      binaryUrl: out.binaryUrl,
    });
    const summary = must(await h.store.resumePending());
    expect(summary.rejected + summary.completed).toBe(4);
    expect(summary.failed).toBe(0);
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining([secret.url, keep.binaryUrl, keep.descriptionUrl, out.binaryUrl]),
    );
    expect(await journal.list()).toEqual([]);
  });

  it("resume with no library fails every entry and an aborted signal stops it", async () => {
    const journal = createMemoryJournal();
    await journal.put({
      descriptionUrl: `${ROOT}media/2026/05/a`,
      shardUrl: `${ROOT}media/2026/05/`,
    });
    const h = await harness(protocol, { journal });
    expect(must(await h.store.resumePending())).toEqual({ completed: 0, failed: 1, rejected: 0 });
    const controller = new AbortController();
    controller.abort();
    expect(await h.store.resumePending(controller.signal)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });

  it("retries a lost race on the description delete, and gives up when it keeps losing", async () => {
    const { h, out } = await seeded();
    let interfered = 0;
    const racing = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (
          call.method === "delete" &&
          String(call.args[0]) === out.descriptionUrl &&
          interfered++ === 0
        ) {
          await h.storage.write(out.descriptionUrl, await text(h.storage, out.descriptionUrl), {
            contentType: "application/ld+json",
            ifMatch: "*",
          });
        }
      }),
    });
    expect((await racing.remove(out.descriptionUrl)).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual([]);

    const again = await seeded();
    const losing = await again.h.reopen({
      storage: intercept(again.h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === again.out.descriptionUrl) {
          await again.h.storage.write(
            again.out.descriptionUrl,
            await text(again.h.storage, again.out.descriptionUrl),
            { contentType: "application/ld+json", ifMatch: "*" },
          );
        }
      }),
    });
    expect(await losing.remove(again.out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "retries-exhausted" },
    });
    expect(await allResources(again.h.storage)).toContain(again.out.descriptionUrl);
  });

  it("tolerates a description or media that someone else already removed", async () => {
    const { h, out } = await seeded();
    const racing = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === out.descriptionUrl) {
          const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
          await h.storage.delete(out.descriptionUrl, { ifMatch: etag });
        }
        if (call.method === "head" && String(call.args[0]) === out.binaryUrl) {
          const etag = (await h.storage.head(out.binaryUrl)).etag as string;
          await h.storage.delete(out.binaryUrl, { ifMatch: etag });
        }
      }),
    });
    expect((await racing.remove(out.descriptionUrl)).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("retries media deletes that race, reports an exhausted one, and needs a validator", async () => {
    const { h, out } = await seeded();
    let raced = 0;
    const racing = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === out.binaryUrl && raced++ === 0) {
          await h.storage.write(out.binaryUrl, new Uint8Array([1]), {
            contentType: "image/png",
            ifMatch: "*",
          });
        }
      }),
    });
    expect((await racing.remove(out.descriptionUrl)).ok).toBe(true);

    const stuck = await seeded();
    const hostile = await stuck.h.reopen({
      storage: intercept(stuck.h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === stuck.out.binaryUrl) {
          await stuck.h.storage.write(stuck.out.binaryUrl, new Uint8Array([2]), {
            contentType: "image/png",
            ifMatch: "*",
          });
        }
      }),
    });
    expect(await hostile.remove(stuck.out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "retries-exhausted" },
    });

    const third = await seeded();
    const blind = await third.h.reopen({ storage: withoutEtag(third.h.storage, "head") });
    expect(await blind.remove(third.out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "no-validator" },
    });
    const noRead = await seeded();
    const unread = await noRead.h.reopen({ storage: withoutEtag(noRead.h.storage, "read") });
    expect(await unread.remove(noRead.out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "no-validator" },
    });
  });

  it("refuses to remove what is not a valid description, and only deletes pointers it trusts", async () => {
    const { h, out } = await seeded();
    const shard = shardOf(h.store);
    await h.storage.create(shard, "", { name: "pend", contentType: "application/ld+json" });
    await h.storage.create(shard, "nope", { name: "bad", contentType: "application/ld+json" });
    const secret = await h.storage.create(ROOT, "private", {
      name: "secret.png",
      contentType: "image/png",
    });
    await h.storage.create(
      shard,
      JSON.stringify({ "@type": "ex:Media", name: "evil", contentUrl: secret.url }),
      { name: "evil", contentType: "application/ld+json" },
    );
    const find = async (suffix: string) =>
      (await allResources(h.storage)).find((url) => url.endsWith(suffix)) as string;
    expect(await h.store.remove(await find("pend"))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-pending" },
    });
    expect(await h.store.remove(await find("bad"))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "description-unparseable" },
    });
    expect((await h.store.remove(await find("evil"))).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining([secret.url, out.binaryUrl, out.descriptionUrl]),
    );
    expect(await h.store.remove(`${ROOT}profile/card`)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "out-of-scope" },
    });
  });

  it("reports a journal that fails as a typed error and never deletes without a record", async () => {
    const broken: DeleteJournal = {
      put: async () => {
        throw new Error("disk full");
      },
      delete: async () => {
        throw new Error("disk full");
      },
      list: async () => {
        throw new Error("disk full");
      },
    };
    const h = await harness(protocol, { journal: broken });
    const out = must(await h.store.put(putInput()));
    expect(await h.store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "journal" },
    });
    expect(await allResources(h.storage)).toContain(out.descriptionUrl);
    expect(await h.store.resumePending()).toEqual({
      ok: false,
      error: { kind: "failed", reason: "journal" },
    });
    const onlyDelete: DeleteJournal = { ...createMemoryJournal(), delete: broken.delete };
    const h2 = await harness(protocol, { journal: onlyDelete });
    const out2 = must(await h2.store.put(putInput({ seed: 8 })));
    expect(await h2.store.remove(out2.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "journal" },
    });
    const dropping: DeleteJournal = createMemoryJournal();
    await dropping.put({ descriptionUrl: `${ROOT}x/y`, shardUrl: `${ROOT}x/` });
    const h3 = await harness(protocol, {
      journal: { ...dropping, delete: broken.delete, list: dropping.list },
    });
    await h3.store.put(putInput({ seed: 9 }));
    expect(await h3.store.resumePending()).toEqual({
      ok: false,
      error: { kind: "failed", reason: "journal" },
    });
  });
});
