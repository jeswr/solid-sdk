// AUTHORED-BY Claude Sonnet 5.5
// Regression tests for the findings of the independent review of f59655f (F-01..F-21).
import { type StorageClient, StorageError } from "@jeswr/storage-client";
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
  ROOT,
  serverNames,
  sha256Of,
  shardOf,
  text,
} from "../test/support.js";
import { encodeCursor } from "./cursor.js";
import { isInsideLibrary, openMediaStore } from "./index.js";
import { createMemoryJournal, type DeleteJournal } from "./journal.js";

type Call = { method: string; args: unknown[] };
const forbidden = () => new StorageError("forbidden", { url: "x:", method: "DELETE" });
const invalid = {
  ok: false,
  error: expect.objectContaining({ kind: "failed", reason: "invalid-input" }),
};
const etagOf = async (storage: StorageClient, url: string) =>
  (await storage.head(url)).etag as string;

describe("open validates what it is given (F-16)", () => {
  it("never throws on missing or malformed options", async () => {
    const h = await harness("solid");
    const base = h.options;
    for (const broken of [
      undefined,
      null,
      { ...base, storage: undefined },
      { ...base, typeIndex: undefined },
      { ...base, features: undefined },
      { ...base, classes: undefined },
      { ...base, classes: [] },
      { ...base, defaultContainerName: 5 },
      { ...base, defaultContainerName: "a/b" },
      { ...base, exposureTtlMs: -1 },
      { ...base, exposureTtlMs: Number.NaN },
      { ...base, maxBytes: 0 },
    ]) {
      expect(
        await openMediaStore(broken as never),
        JSON.stringify(broken && Object.keys(broken)),
      ).toEqual(invalid);
    }
    expect((await openMediaStore({ ...base, exposureTtlMs: 0 })).ok).toBe(true);
  });

  it.each([
    "solid",
    "lws",
  ] as const)("operations take garbage arguments as invalid input (%s)", async (protocol) => {
    const h = await harness(protocol);
    must(await h.store.put(putInput()));
    expect(await h.store.put(undefined as never)).toEqual(invalid);
    expect(await h.store.get(42 as never)).toEqual(invalid);
    expect(await h.store.update(42 as never, async () => undefined)).toEqual(invalid);
    expect(await h.store.remove(42 as never)).toEqual(invalid);
    expect(
      await h.store.attachThumbnail(42 as never, { bytes: jpeg(), mutate: async () => undefined }),
    ).toEqual(invalid);
    expect(await h.store.attachThumbnail("x", undefined as never)).toEqual(invalid);
    expect(h.store.isInsideLibrary(42 as never)).toBe(false);
    expect(await h.store.list({ cursor: "" })).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "invalid-cursor" }),
    });
    expect(await h.store.sweepOrphans({ minAgeMs: -1 })).toEqual(invalid);
    expect(await h.store.sweepOrphans({ minAgeMs: Number.NaN })).toEqual(invalid);
  });
});

describe("F-03: a failed remove never costs the media of an item that stays", () => {
  async function seeded(wrap?: (s: StorageClient) => StorageClient) {
    const journal = createMemoryJournal();
    const h = await harness("solid", { journal }, wrap);
    const out = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    return { h, out, journal };
  }

  it("V2: a refused description delete reports it, withdraws the intent, and resume leaves the item whole", async () => {
    let refuse = true;
    const { h, out, journal } = await seeded((s) =>
      intercept(s, (call) => {
        if (refuse && call.method === "delete") throw forbidden();
      }),
    );
    expect(await h.store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
    expect(await journal.list()).toEqual([]);
    refuse = false;
    expect(must(await h.store.resumePending())).toEqual({ completed: 0, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toHaveLength(3);
    expect((await h.store.get(out.descriptionUrl)).ok).toBe(true);
  });

  it("V2b: losing the ETag race three times leaves everything, and the entry is withdrawn", async () => {
    let races = 0;
    const { h, out, journal } = await seeded((s) =>
      intercept(s, async (call) => {
        if (call.method === "delete" && races++ < 3) {
          const url = call.args[0] as string;
          const current = await s.read(url);
          await s.write(url, (await current.text()).replace("first", `first${races}`), {
            contentType: "application/ld+json",
            ifMatch: current.etag as string,
          });
        }
      }),
    );
    expect(await h.store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "retries-exhausted" },
    });
    expect(await journal.list()).toEqual([]);
    expect(must(await h.store.resumePending())).toEqual({ completed: 0, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toHaveLength(3);
  });

  it("an interrupted remove keeps its intent and resume deletes the description first, then the media", async () => {
    let offline = false;
    const { h, out, journal } = await seeded((s) =>
      intercept(s, (call) => {
        if (offline && call.method === "delete") {
          throw new StorageError("network", { url: "x:", method: "DELETE" });
        }
      }),
    );
    offline = true;
    expect((await h.store.remove(out.descriptionUrl)).ok).toBe(false);
    expect(await journal.list()).toEqual([expect.objectContaining({ phase: "intent" })]);
    expect(await allResources(h.storage)).toHaveLength(3);
    offline = false;
    expect(must(await h.store.resumePending())).toEqual({ completed: 1, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toEqual([]);
    expect(await journal.list()).toEqual([]);
  });

  it("an intent entry whose description is already gone finishes the media", async () => {
    const { h, out, journal } = await seeded();
    await h.storage.delete(out.descriptionUrl, {
      ifMatch: await etagOf(h.storage, out.descriptionUrl),
    });
    await journal.put({
      descriptionUrl: out.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
      ...(out.thumbnailUrl === undefined ? {} : { thumbnailUrl: out.thumbnailUrl }),
    });
    expect(must(await h.store.resumePending())).toEqual({ completed: 1, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("a description that has changed hands is neither deleted nor stripped of its media", async () => {
    const { h, out, journal } = await seeded();
    const other = must(await h.store.put(putInput({ seed: 4 })));
    // The journal says the intent was to delete `out`, but the description now locates `other`.
    const doc = JSON.parse(await text(h.storage, out.descriptionUrl));
    await h.storage.write(
      out.descriptionUrl,
      JSON.stringify({ ...doc, contentUrl: other.binaryUrl }),
      {
        contentType: "application/ld+json",
        ifMatch: await etagOf(h.storage, out.descriptionUrl),
      },
    );
    await journal.put({
      descriptionUrl: out.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
      phase: "intent",
    });
    expect(must(await h.store.resumePending())).toEqual({ completed: 0, failed: 0, rejected: 1 });
    expect(await journal.list()).toEqual([]);
    expect(await allResources(h.storage)).toHaveLength(5);
  });

  it("a live remove stops when the description is edited to point elsewhere in the meantime", async () => {
    const journal = createMemoryJournal();
    let tamper: (() => Promise<void>) | undefined;
    const wrapped: DeleteJournal = {
      ...journal,
      put: async (entry) => {
        await journal.put(entry);
        await tamper?.();
      },
    };
    const h = await harness("solid", { journal: wrapped });
    const out = must(await h.store.put(putInput()));
    const other = must(await h.store.put(putInput({ seed: 4 })));
    tamper = async () => {
      tamper = undefined;
      const doc = JSON.parse(await text(h.storage, out.descriptionUrl));
      await h.storage.write(
        out.descriptionUrl,
        JSON.stringify({ ...doc, contentUrl: other.binaryUrl }),
        {
          contentType: "application/ld+json",
          ifMatch: await etagOf(h.storage, out.descriptionUrl),
        },
      );
    };
    expect(await h.store.remove(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "conflict", reason: "description-mismatch" },
    });
    expect(await journal.list()).toEqual([]);
    expect(await allResources(h.storage)).toHaveLength(4);
  });
});

describe("F-03: media are deleted only once the description is confirmed gone and not recreated", () => {
  it("skips the media when a put recreated the description after the delete", async () => {
    const journal = createMemoryJournal();
    let recreate: (() => Promise<unknown>) | undefined;
    const h = await harness("solid", { journal }, (s) =>
      intercept(s, async (call) => {
        if (call.method === "head") await recreate?.();
      }),
    );
    const out = must(await h.store.put(putInput()));
    const rival = await h.reopen({ storage: h.storage });
    recreate = async () => {
      recreate = undefined;
      must(await rival.put(putInput()));
    };
    expect((await h.store.remove(out.descriptionUrl)).ok).toBe(true);
    expect(await allResources(h.storage)).toHaveLength(2);
    expect((await h.store.get(out.descriptionUrl)).ok).toBe(true);
    expect(await journal.list()).toEqual([]);
  });
});

describe("F-07: remove and resume delete only the item's own media", () => {
  async function evil() {
    const journal = createMemoryJournal();
    const h = await harness("solid", { journal });
    const a = must(await h.store.put(putInput({ seed: 1 })));
    const b = must(await h.store.put(putInput({ seed: 2, thumbnail: { bytes: jpeg(2) } })));
    return { h, journal, a, b, shard: shardOf(h.store) };
  }

  it("V7: a description naming another item's binary and description deletes none of them", async () => {
    const { h, a, b, shard } = await evil();
    await h.storage.create(
      shard,
      JSON.stringify({
        "@type": "ex:Media",
        name: "x",
        contentUrl: a.binaryUrl,
        thumbnailUrl: b.descriptionUrl,
      }),
      { name: "evil", contentType: "application/ld+json" },
    );
    expect((await h.store.remove(`${shard}evil`)).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining([a.binaryUrl, a.descriptionUrl, b.descriptionUrl, b.binaryUrl]),
    );
    expect(await allResources(h.storage)).not.toContain(`${shard}evil`);
  });

  it("a description that names itself or an auxiliary name as its media loses only itself", async () => {
    const { h, shard } = await evil();
    const hash = await sha256Of(png(7));
    await h.storage.create(
      shard,
      JSON.stringify({ "@type": "ex:Media", name: "self", contentUrl: `${shard}${hash}` }),
      { name: hash, contentType: "application/ld+json" },
    );
    expect((await h.store.remove(`${shard}${hash}`)).ok).toBe(true);
    await h.storage.create(shard, "x", { name: `${hash}-note`, contentType: "text/plain" });
    await h.storage.create(
      shard,
      JSON.stringify({ "@type": "ex:Media", name: "n", contentUrl: `${shard}${hash}-note` }),
      { name: hash, contentType: "application/ld+json" },
    );
    expect((await h.store.remove(`${shard}${hash}`)).ok).toBe(true);
    expect(await allResources(h.storage)).toContain(`${shard}${hash}-note`);
  });

  it("a description-typed resource at a media name is never deleted as media", async () => {
    const { h, shard } = await evil();
    const hash = await sha256Of(png(8));
    await h.storage.create(shard, "{}", {
      name: `${hash}.json`,
      contentType: "application/ld+json",
    });
    await h.storage.create(
      shard,
      JSON.stringify({ "@type": "ex:Media", name: "j", contentUrl: `${shard}${hash}.json` }),
      { name: hash, contentType: "application/ld+json" },
    );
    expect((await h.store.remove(`${shard}${hash}`)).ok).toBe(true);
    expect(await allResources(h.storage)).toContain(`${shard}${hash}.json`);
  });

  it("V7: a journal entry naming .acl, a foreign file or a description deletes none of them", async () => {
    const { h, journal, a, b, shard } = await evil();
    await h.storage
      .create(shard, "x", { name: ".acl", contentType: "text/plain" })
      .catch(() => undefined);
    await journal.put({
      descriptionUrl: `${shard}gone`,
      shardUrl: shard,
      binaryUrl: `${shard}.acl`,
      thumbnailUrl: b.descriptionUrl,
      phase: "deleted",
    });
    await journal.put({
      descriptionUrl: `${shard}gone2`,
      shardUrl: shard,
      binaryUrl: a.binaryUrl,
      phase: "deleted",
    });
    expect(h.store.isInsideLibrary(`${shard}.acl`)).toBe(false);
    expect(h.store.isInsideLibrary(`${shard}.meta`)).toBe(false);
    expect(must(await h.store.resumePending())).toEqual({ completed: 2, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining(
        [a.binaryUrl, b.binaryUrl, b.descriptionUrl, `${shard}.acl`].filter(
          (url) => !url.endsWith(".acl"),
        ),
      ),
    );
  });

  it("a journal entry for a description that is not in the shard it names is rejected", async () => {
    const { h, journal, a, shard } = await evil();
    await journal.put({
      descriptionUrl: `${ROOT}media/2026/04/elsewhere`,
      shardUrl: shard,
      binaryUrl: a.binaryUrl,
    });
    expect(must(await h.store.resumePending())).toEqual({ completed: 0, failed: 0, rejected: 1 });
    expect(await allResources(h.storage)).toContain(a.binaryUrl);
  });

  it("V17: an update cannot repoint a description at another item's media", async () => {
    const { h, a, b } = await evil();
    const repoint = await h.store.update(b.descriptionUrl, async (cur) => ({
      body: cur.body.replace(b.binaryUrl, a.binaryUrl),
      contentType: cur.contentType,
    }));
    expect(repoint).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "description-invalid" }),
    });
    const rethumb = await h.store.update(b.descriptionUrl, async (cur) => ({
      body: cur.body.replace(b.thumbnailUrl as string, a.binaryUrl),
      contentType: cur.contentType,
    }));
    expect(rethumb.ok).toBe(false);
    const rename = await h.store.update(b.descriptionUrl, async (cur) => ({
      body: cur.body.replace("first", "renamed"),
      contentType: cur.contentType,
    }));
    expect(rename.ok).toBe(true);
  });

  it("on LWS a description-typed resource is not deleted as media either", async () => {
    const h = await harness("lws", {}, serverNames);
    const first = must(await h.store.put(putInput({ seed: 1 })));
    const shard = (await h.storage.parentOf(first.descriptionUrl)) as string;
    const decoy = await h.storage.create(shard, "{}", {
      name: "decoy",
      contentType: "text/turtle",
    });
    const store = await h.reopen();
    await store.list();
    const hostile = await h.storage.create(
      shard,
      JSON.stringify({ "@type": "ex:Media", name: "evil", contentUrl: decoy.url }),
      { name: "evil", contentType: "application/ld+json" },
    );
    expect((await (await h.reopen()).remove(hostile.url)).ok).toBe(true);
    expect(await allResources(h.storage)).toContain(decoy.url);
  });
});

describe("F-06 and F-12: where a library may be, and what a hint may name", () => {
  it("V10: a planted registration does not displace the library called by the default name", async () => {
    const h = await harness("solid");
    const first = must(await h.store.put(putInput()));
    await h.storage.create(ROOT, null, { kind: "container", name: "aaa-public" });
    await h.options.typeIndex.register(
      "https://example.org/ns#Media",
      { container: `${ROOT}aaa-public/` },
      { index: "public" },
    );
    const next = await h.reopen();
    expect(next.library).toBe(h.store.library);
    expect(must(await next.list()).items.map((item) => item.descriptionUrl)).toEqual([
      first.descriptionUrl,
    ]);
  });

  it("with two unnamed candidates the choice is deterministic", async () => {
    const h = await harness("solid", { defaultContainerName: "mine" });
    await h.storage.create(ROOT, null, { kind: "container", name: "zzz" });
    await h.storage.create(ROOT, null, { kind: "container", name: "bbb" });
    for (const name of ["zzz", "bbb"]) {
      await h.options.typeIndex.register("https://example.org/ns#Media", {
        container: `${ROOT}${name}/`,
      });
    }
    expect((await h.reopen()).library).toBe(`${ROOT}bbb/`);
  });

  it("a registration is private, and an adopted container is probed before anything is written", async () => {
    const registered: unknown[] = [];
    const probed: string[] = [];
    const h = await harness("solid", {
      exposure: async (url) => {
        probed.push(url);
        return "exposed";
      },
      typeIndex: {
        findAll: async () => new Map(),
        register: async (_cls, _location, options) => {
          registered.push(options);
          return undefined;
        },
      },
    });
    await h.storage.create(ROOT, null, { kind: "container", name: "media" });
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "exposed" }),
    });
    expect(registered).toEqual([{ index: "private" }]);
    expect(probed).toEqual([`${ROOT}media/`]);
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("V12: findByHash with no library yet, or a hit outside it, is a miss", async () => {
    const h = await harness("solid", {
      findByHash: async () => ({ descriptionUrl: `${ROOT}media/2026/05/zzz` }),
    });
    expect((await h.store.put(putInput())).ok).toBe(true);
    const outside = await h.reopen({
      findByHash: async () => ({ descriptionUrl: `${ROOT}profile/card` }),
    });
    expect((await outside.put(putInput({ seed: 5 }))).ok).toBe(true);
    const missing = await h.reopen({
      findByHash: async () => ({ descriptionUrl: `${shardOf(h.store)}never-existed` }),
    });
    expect((await missing.put(putInput({ seed: 6 }))).ok).toBe(true);
  });

  it("a verified findByHash hit on Solid is returned as it is", async () => {
    const h = await harness("solid");
    const first = must(await h.store.put(putInput()));
    const known = await h.reopen({
      findByHash: async () => ({ descriptionUrl: first.descriptionUrl }),
    });
    expect(must(await known.put(putInput()))).toEqual({
      ...first,
      existed: true,
      thumbnailMissing: false,
    });
  });
});

describe("F-13: LWS identifiers are opaque", () => {
  it("V11: a forged cursor naming a foreign container is refused and exposes nothing", async () => {
    const h = await harness("lws");
    const a = must(await h.store.put(putInput()));
    const other = await h.storage.create(ROOT, null, { kind: "container", name: "private-notes" });
    const doc = await h.storage.create(
      other.url,
      JSON.stringify({ "@type": "ex:Media", name: "n", contentUrl: a.binaryUrl }),
      { name: "n", contentType: "application/ld+json" },
    );
    const shard = (await h.storage.parentOf(a.binaryUrl)) as string;
    for (const page of [
      other.url,
      `${shard}x`,
      `${ROOT}private-notes?x=${encodeURIComponent(shard)}`,
      "not a url",
    ]) {
      const store = await h.reopen();
      const result = await store.list({
        cursor: encodeCursor({ shard: "2026/05", shardUrl: shard, page, offset: 0 }),
      });
      expect(result, page).toEqual({
        ok: false,
        error: expect.objectContaining({ reason: "invalid-cursor" }),
      });
      expect(store.isInsideLibrary(doc.url)).toBe(false);
      expect((await store.get(doc.url)).ok).toBe(false);
    }
  });

  it("V14: two containers with one label are both listed, once, and resumable", async () => {
    const h = await harness("lws");
    must(await h.store.put(putInput({ seed: 1 })));
    const library = h.store.library as string;
    const year = await h.storage.create(library, null, { kind: "container", name: "2026" });
    const month = await h.storage.create(year.url, null, { kind: "container", name: "05" });
    // A server that always POSTs a new container gives both the same title.
    for (const [url, title] of [
      [year.url, "2026"],
      [month.url, "05"],
    ] as const) {
      await h.storage.setMetadata(url, [{ op: "add", rel: "related", href: url, title }], {
        ifMatch: (await h.storage.metadata(url)).etag as string,
      });
    }
    const binary = await h.storage.create(month.url, png(7), {
      name: "b.png",
      contentType: "image/png",
    });
    await h.storage.create(
      month.url,
      JSON.stringify({ "@type": "ex:Media", name: "dup", contentUrl: binary.url }),
      { name: "d", contentType: "application/ld+json" },
    );
    const store = await h.reopen();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const result = must(
        await store.list({ limit: 1, ...(cursor === undefined ? {} : { cursor }) }),
      );
      seen.push(...result.items.map((item) => item.value.name));
      if (result.next === null) break;
      cursor = result.next;
    }
    expect([...seen].sort()).toEqual(["dup", "first"]);
  });

  it("a slashless library identifier is found again in the next session", async () => {
    const h = await harness("lws");
    must(await h.store.put(putInput()));
    const library = h.store.library as string;
    const slashless = library.replace(/\/$/, "");
    const reopened = await h.reopen({
      typeIndex: {
        findAll: async (classes) => new Map(classes.map((cls) => [cls, [slashless]])),
        register: async () => undefined,
      },
    });
    expect(reopened.library).toBe(slashless);
  });

  it("M47: an identifier with a query or fragment is never asked about", async () => {
    const h = await harness("lws");
    const out = must(await h.store.put(putInput()));
    const asked: string[] = [];
    const lenient = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (property === "parentOf") {
            return async (url: string) => {
              asked.push(url);
              return shardOf(h.store);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    expect((await lenient.get(`${out.descriptionUrl}?x=1`)).ok).toBe(false);
    expect((await lenient.get(`${out.descriptionUrl}#x`)).ok).toBe(false);
    expect(asked.filter((url) => /[?#]/.test(url))).toEqual([]);
  });

  it("M46: a thumbnail must be an image, not any recognised media", async () => {
    const h = await harness("solid");
    const wav = new Uint8Array(16);
    wav.set(new TextEncoder().encode("RIFF"));
    wav.set(new TextEncoder().encode("WAVE"), 8);
    expect(await h.store.put(putInput({ thumbnail: { bytes: wav } }))).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "unsniffable" }),
    });
  });

  it("M12: media in another shard are never deleted, even under a matching name", async () => {
    const journal = createMemoryJournal();
    const h = await harness("solid", { journal });
    const may = must(await h.store.put(putInput()));
    const april = must(
      await h.store.put(putInput({ createdAt: new Date("2026-04-02T00:00:00Z") })),
    );
    await h.storage.delete(may.descriptionUrl, {
      ifMatch: await etagOf(h.storage, may.descriptionUrl),
    });
    await journal.put({
      descriptionUrl: may.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: april.binaryUrl,
      phase: "deleted",
    });
    expect(must(await h.store.resumePending())).toEqual({ completed: 1, failed: 0, rejected: 0 });
    expect(await allResources(h.storage)).toEqual(
      expect.arrayContaining([april.binaryUrl, april.descriptionUrl]),
    );
  });

  it("M48: existed is false when the binary had to be created again", async () => {
    const h = await harness("solid");
    const first = must(await h.store.put(putInput()));
    await h.storage.delete(first.binaryUrl, { ifMatch: await etagOf(h.storage, first.binaryUrl) });
    expect(must(await h.store.put(putInput()))).toEqual({ ...first, existed: false });
    expect(must(await h.store.put(putInput()))).toEqual({ ...first, existed: true });
  });

  it("the library listing counts what is not a shard", async () => {
    const h = await harness("solid");
    must(await h.store.put(putInput()));
    const library = h.store.library as string;
    await h.storage.create(library, "x", { name: "note.txt", contentType: "text/plain" });
    await h.storage.create(library, null, { kind: "container", name: "stray" });
    expect(must(await (await h.reopen()).list()).skipped.foreign).toBe(2);
  });
});

describe("F-05: a title that cannot be stored fails the abort cleanly", () => {
  it("an abort during the title edit is an abort, not a title failure", async () => {
    const controller = new AbortController();
    const h = await harness(
      "lws",
      {},
      (s) =>
        new Proxy(serverNames(s), {
          get(target, property) {
            const value = Reflect.get(target, property) as unknown;
            if (property === "metadata") {
              return async () => {
                controller.abort();
                throw new StorageError("network", { url: "x:", method: "GET" });
              };
            }
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
    );
    expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "aborted" }),
    });
  });
});

describe("F-08: attachThumbnail", () => {
  const link = async (current: { body: string; contentType: string }, thumbnailUrl: string) => ({
    contentType: current.contentType,
    body: JSON.stringify({ ...JSON.parse(current.body), thumbnailUrl }),
  });

  it.each([
    "solid",
    "lws",
  ] as const)("links a stored thumbnail, and is idempotent (%s)", async (protocol) => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const item = must(
      await h.store.attachThumbnail(out.descriptionUrl, { bytes: jpeg(1), mutate: link }),
    );
    expect(item.thumbnailUrl).toBeDefined();
    expect(await allResources(h.storage)).toHaveLength(3);
    const again = must(
      await h.store.attachThumbnail(out.descriptionUrl, { bytes: jpeg(1), mutate: link }),
    );
    expect(again.thumbnailUrl).toBe(item.thumbnailUrl);
    expect(await allResources(h.storage)).toHaveLength(3);
    expect((await h.store.remove(out.descriptionUrl)).ok).toBe(true);
    expect(await allResources(h.storage)).toEqual(
      protocol === "solid" ? [] : [expect.anything()].slice(0, 0),
    );
  });

  it("refuses what is not a recognised image, an exposed library, and a description it cannot use", async () => {
    const h = await harness("solid");
    const out = must(await h.store.put(putInput()));
    const notImage = await h.store.attachThumbnail(out.descriptionUrl, {
      bytes: new TextEncoder().encode("<svg/>"),
      mutate: link,
    });
    expect(notImage).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "unsniffable" }),
    });
    const unknown = await h.store.attachThumbnail(`${shardOf(h.store)}nothing`, {
      bytes: jpeg(1),
      mutate: link,
    });
    expect(unknown.ok).toBe(false);
    const outside = await h.store.attachThumbnail(`${ROOT}profile/card`, {
      bytes: jpeg(1),
      mutate: link,
    });
    expect(outside).toEqual({ ok: false, error: expect.objectContaining({ kind: "not-found" }) });
    await h.storage.create(shardOf(h.store), "", { name: "empty", contentType: "text/turtle" });
    expect(
      await h.store.attachThumbnail(`${shardOf(h.store)}empty`, { bytes: jpeg(1), mutate: link }),
    ).toEqual({ ok: false, error: expect.objectContaining({ reason: "description-pending" }) });
    const exposed = await h.reopen({ exposure: async () => "exposed" });
    expect(
      await exposed.attachThumbnail(out.descriptionUrl, { bytes: jpeg(1), mutate: link }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "exposed" }),
    });
    expect(await allResources(h.storage)).toHaveLength(3);
  });

  it("reports the thumbnail it stored when the edit that links it fails", async () => {
    const h = await harness("solid");
    const out = must(await h.store.put(putInput()));
    const result = await h.store.attachThumbnail(out.descriptionUrl, {
      bytes: jpeg(1),
      mutate: async (current) => ({ contentType: current.contentType, body: current.body }),
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        reason: "description-invalid",
        orphans: [expect.stringContaining("-thumb")],
      }),
    });
    // The retry adopts the thumbnail by name, so the pair completes.
    expect(
      (await h.store.attachThumbnail(out.descriptionUrl, { bytes: jpeg(1), mutate: link })).ok,
    ).toBe(true);
    expect(await allResources(h.storage)).toHaveLength(3);
  });
});

describe("sweepOrphans", () => {
  const Old = 48 * 3_600_000;

  it("removes unreferenced media once old enough, and nothing a description references", async () => {
    let clock = Date.now();
    const h = await harness("solid", { now: () => clock });
    const kept = must(await h.store.put(putInput({ seed: 1, thumbnail: { bytes: jpeg(1) } })));
    // A put that failed after its media were stored.
    const failing = await h.reopen({
      build: async () => ({ body: "{}", contentType: "text/html" }),
    });
    expect((await failing.put(putInput({ seed: 2, thumbnail: { bytes: jpeg(2) } }))).ok).toBe(
      false,
    );
    const shard = shardOf(h.store);
    await h.storage.create(shard, "keep me", { name: "notes.txt", contentType: "text/plain" });
    await h.storage.create(shard, new Uint8Array([1, 2]), {
      name: "stray.png",
      contentType: "image/png",
    });
    expect(must(await h.store.sweepOrphans({ minAgeMs: Old }))).toEqual({
      deleted: 0,
      retained: 2,
      shardsSkipped: 0,
    });
    clock += Old * 2;
    expect(must(await h.store.sweepOrphans({ minAgeMs: Old }))).toEqual({
      deleted: 2,
      retained: 0,
      shardsSkipped: 0,
    });
    const left = await allResources(h.storage);
    expect(left).toEqual(
      expect.arrayContaining([
        kept.descriptionUrl,
        kept.binaryUrl,
        kept.thumbnailUrl as string,
        `${shard}notes.txt`,
        `${shard}stray.png`,
      ]),
    );
    expect(left).toHaveLength(5);
  });

  it("leaves a shard alone when one of its descriptions cannot be understood", async () => {
    const h = await harness("solid");
    must(await h.store.put(putInput({ seed: 1 })));
    const failing = await h.reopen({
      build: async () => ({ body: "{}", contentType: "text/html" }),
    });
    await failing.put(putInput({ seed: 2 }));
    await h.storage.create(shardOf(h.store), "nope", {
      name: "bad",
      contentType: "application/ld+json",
    });
    expect(must(await h.store.sweepOrphans({ minAgeMs: 0 }))).toEqual({
      deleted: 0,
      retained: 0,
      shardsSkipped: 1,
    });
    expect(await allResources(h.storage)).toHaveLength(4);
  });

  it("collects abandoned empty descriptions, and only old ones", async () => {
    let clock = Date.now();
    const h = await harness("lws", { now: () => clock }, (s) =>
      intercept(s, (call: Call) => {
        if (call.method === "write" || call.method === "delete") throw forbidden();
      }),
    );
    expect((await h.store.put(putInput())).ok).toBe(false);
    const store = await h.reopen({ storage: h.storage, now: () => clock });
    expect(must(await store.sweepOrphans({ minAgeMs: Old }))).toEqual({
      deleted: 0,
      retained: 1,
      shardsSkipped: 0,
    });
    expect(await descriptions(h.storage)).toHaveLength(1);
    clock += Old * 2;
    expect(must(await store.sweepOrphans({ minAgeMs: Old })).deleted).toBe(2);
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("does nothing without a library, and skips what is not a member or not a resource", async () => {
    const h = await harness("solid");
    expect(must(await h.store.sweepOrphans())).toEqual({
      deleted: 0,
      retained: 0,
      shardsSkipped: 0,
    });
    must(await h.store.put(putInput()));
    const shard = shardOf(h.store);
    await h.storage.create(shard, null, { kind: "container", name: "nested" });
    const lying = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (property !== "listAll")
            return typeof value === "function" ? value.bind(target) : value;
          return async function* (container: string, options: never) {
            yield* target.listAll(container, options);
            if (container === shard) {
              yield {
                url: `${ROOT}profile/card`,
                kind: "resource" as const,
                displayName: null,
                contentType: "image/png",
                size: 1,
                modified: new Date(0),
                types: [],
              };
            }
          };
        },
      }),
    });
    expect(must(await lying.sweepOrphans({ minAgeMs: 0 }))).toEqual({
      deleted: 0,
      retained: 0,
      shardsSkipped: 0,
    });
    expect((await h.storage.head(`${ROOT}profile/card`)).etag).not.toBeNull();
  });

  it("finds the library late, and copes with media that report no type or size", async () => {
    const h = await harness("solid");
    const early = await h.reopen();
    expect(early.library).toBeNull();
    const writer = await h.reopen();
    must(await writer.put(putInput()));
    const shard = shardOf(writer);
    await h.storage.create(shard, png(5), {
      name: `${"a".repeat(64)}.png`,
      contentType: "image/png",
    });
    const blurred = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (property === "head") {
            return async (...args: Parameters<typeof target.head>) => ({
              ...(await target.head(...args)),
              contentType: null,
            });
          }
          if (property !== "listAll")
            return typeof value === "function" ? value.bind(target) : value;
          return async function* (container: string, options: never) {
            yield* target.listAll(container, options);
            if (container === shard) {
              yield {
                url: `${shard}opaque`,
                kind: "resource" as const,
                displayName: null,
                contentType: null,
                size: 10_000_000,
                modified: new Date(0),
                types: [],
              };
            }
          };
        },
      }),
    });
    expect(blurred.library).not.toBeNull();
    expect(must(await blurred.sweepOrphans({ minAgeMs: 0 })).deleted).toBe(1);
    expect(must(await early.sweepOrphans({ minAgeMs: 0 })).deleted).toBe(0);
  });

  it("on LWS removes only unreferenced media-typed resources", async () => {
    const h = await harness("lws", {}, serverNames);
    const kept = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    const shard = (await h.storage.parentOf(kept.descriptionUrl)) as string;
    const stray = await h.storage.create(shard, png(5), { name: "x", contentType: "image/png" });
    const note = await h.storage.create(shard, "hello", { name: "y", contentType: "text/plain" });
    const noType = await h.storage.create(shard, "??", {
      name: "z",
      contentType: "application/octet-stream",
    });
    const store = await h.reopen();
    expect(must(await store.sweepOrphans({ minAgeMs: 0 })).deleted).toBe(1);
    const left = await allResources(h.storage);
    expect(left).not.toContain(stray.url);
    expect(left).toEqual(
      expect.arrayContaining([note.url, noType.url, kept.binaryUrl, kept.thumbnailUrl as string]),
    );
  });

  it("aborts cleanly", async () => {
    const h = await harness("solid");
    must(await h.store.put(putInput()));
    const controller = new AbortController();
    controller.abort();
    expect(await h.store.sweepOrphans({ signal: controller.signal })).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "aborted" }),
    });
  });
});

describe("F-15 and F-16", () => {
  it("F-15: on Solid a container is a shard by its URL, never by its title", async () => {
    const h = await harness("solid");
    must(await h.store.put(putInput()));
    const library = h.store.library as string;
    const titled = await h.storage.create(library, null, { kind: "container", name: "x" });
    await h.storage.setMetadata(
      titled.url,
      [{ op: "add", rel: "related", href: titled.url, title: "2026" }],
      {
        ifMatch: (await h.storage.metadata(titled.url)).etag as string,
      },
    );
    const listed = must(await (await h.reopen()).list());
    expect(listed.items).toHaveLength(1);
    expect(listed.skipped.foreign).toBeGreaterThanOrEqual(1);
  });
});

describe("isInsideLibrary (V15)", () => {
  const lib = "https://pod.example/alice/media/";
  it("refuses delimiters in disguise, dot segments, auxiliary names and look-alike hosts", () => {
    expect(isInsideLibrary(lib, `${lib}2026/05/a`)).toBe(true);
    expect(isInsideLibrary(lib, `${lib}2026/05/%61`)).toBe(true);
    for (const url of [
      `${lib}2026/05/%2e%2e/x`,
      `${lib}2026/05/..%2fx`,
      `${lib}2026/05/a%2Fb`,
      `${lib}2026/05/a%3Fb`,
      `${lib}2026/05/a%00`,
      `${lib}2026/05/%5c`,
      `${lib}2026/05/%23`,
      `${lib}2026/05/./a`,
      `${lib}../x`,
      `${lib}2026/05/.acl`,
      `${lib}2026/05/.meta`,
      `${lib}2026/.hidden/a`,
      `${lib}/2026/05/a`,
      `${lib}2026/05//a`,
      "https://user@pod.example/alice/media/2026/05/a",
      "https://pod.example@evil.example/alice/media/2026/05/a",
      "https://pod.example./alice/media/2026/05/a",
      "http://pod.example/alice/media/2026/05/a",
    ]) {
      expect(isInsideLibrary(lib, url), url).toBe(false);
    }
    expect(isInsideLibrary(lib, `${lib}2026/05/a/`)).toBe(true);
    expect(isInsideLibrary("https://pod.example", "https://pod.example/x")).toBe(true);
    expect(isInsideLibrary(lib, "https://pod.example")).toBe(false);
  });
});
