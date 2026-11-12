// AUTHORED-BY Claude Opus 5.5
/**
 * Regression tests for the adversarial review of the two-way sync core (PR #586). Each block
 * folds in the matching proof of concept and pins the fixed behaviour.
 */

import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { CONNECTOR_SYNC, NS } from "@jeswr/suite-vocab";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createStoragePodWriter } from "../storage-pod-writer.js";
import { TEST_POD_ROOT } from "../testing.js";
import { PodThing, SCHEMA } from "../vocab.js";
import {
  createFakeTwoWayAdapter,
  createMemorySyncPod,
  type FakeTwoWayOptions,
  fakeOneWayImport,
  fakeSyncDocument,
} from "./fake-platform.js";
import { canonicalHash, sha256, syncItemSlug } from "./hash.js";
import { createLinkStore } from "./link-store.js";
import { runTwoWaySync } from "./runner.js";
import type { SyncConnection, SyncLink, SyncPorts } from "./types.js";
import { LinkRecord, SYNC, SyncMetadata } from "./vocab.js";

const ITEM = await syncItemSlug("account/items", "remote-1");

function present<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing expected fixture value.");
  return value;
}
function fixture(connection: Partial<SyncConnection> = {}, fake: FakeTwoWayOptions = {}) {
  const pod = createMemorySyncPod();
  const { adapter, platform } = createFakeTwoWayAdapter("account", fake);
  const ports: SyncPorts = {
    podWriter: pod.writer,
    sourceAuth: { fetch: vi.fn() },
    scopes: ["fake:write"],
  };
  const options = { account: "account", ...connection };
  return {
    pod,
    adapter,
    platform,
    ports,
    run: (extra: Partial<SyncPorts> = {}, settings: Partial<SyncConnection> = {}) =>
      runTwoWaySync(adapter, { ...options, ...settings }, { ...ports, ...extra }),
  };
}
type Fixture = ReturnType<typeof fixture>;
async function readLinks(f: Fixture) {
  const links = createLinkStore(f.pod.writer, "account");
  await links.load();
  return links;
}
const itemUrls = (f: Fixture) => [...f.pod.documents.keys()].filter((u) => u.includes("/items/"));
const liveRemote = (f: Fixture) => [...f.platform.items.values()].filter((i) => !i.deleted);
function descriptionOf(f: Fixture, slug: string): string | undefined {
  const url = f.pod.writer.resolve(slug);
  const stored = present(f.pod.documents.get(url));
  return new PodThing(`${url}#item`, stored.dataset, DataFactory).description;
}
async function addDescription(f: Fixture, slug: string, text: string) {
  const stored = present(await f.pod.writer.read(slug));
  const url = f.pod.writer.resolve(slug);
  new PodThing(`${url}#item`, stored.dataset, DataFactory).description = text;
  await f.pod.writer.write({ ...fakeSyncDocument(url, ""), dataset: stored.dataset });
}

describe("finding 1: inbound updates replace only mapped quads", () => {
  it("keeps a pod-added schema:description through a remote edit (PoC 1)", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    await addDescription(f, ITEM, "owner's private notes");
    await f.run(); // Unmapped-only edit: no remote write.
    expect(f.platform.calls.apply).toBe(0);
    f.platform.set("remote rename");
    const report = await f.run();
    expect(f.pod.name(ITEM)).toBe("remote rename");
    expect(descriptionOf(f, ITEM)).toBe("owner's private notes");
    expect(report.conflicts).toBe(0);
    // The merged resource's mapped projection is exactly the remote one: no echo, no conflict.
    await f.run();
    expect(f.platform.calls.apply).toBe(0);
    expect((await f.run()).conflicts).toBe(0);
  });
  it("replaces mapped blank-node structure without colliding with stored blank labels", async () => {
    const f = fixture();
    const fields = [`${SCHEMA}name`, `${SCHEMA}location`];
    Object.assign(f.adapter, { fieldsForHash: fields });
    const url = f.pod.writer.resolve(ITEM);
    const doc = (place: string) => {
      const dataset = new Store(
        new Parser({ baseIRI: url }).parse(
          `@prefix s: <${SCHEMA}>. <#item> s:name "n"; s:location [ s:name "${place}" ].`,
        ),
      );
      return { slug: url, dataset, category: "documents", forClass: `${SCHEMA}Thing` };
    };
    let place = "first";
    f.adapter.import = async (ctx) => {
      await ctx.sync.resolve("remote-1", "account/items");
      await ctx.sync.upsert({ remoteId: "remote-1", remoteVersion: place, document: doc(place) });
      return {};
    };
    await f.run();
    // The owner annotates the item with an unrelated blank node.
    const stored = present(await f.pod.writer.read(ITEM));
    for (const q of new Parser({ baseIRI: url }).parse(
      `@prefix s: <${SCHEMA}>. <#item> s:review [ s:description "kept" ].`,
    ))
      stored.dataset.add(q);
    await f.pod.writer.write({ ...doc(place), dataset: stored.dataset });
    place = "second";
    await f.run();
    const after = present(f.pod.documents.get(url)).dataset;
    const texts = [...after]
      .filter((q) => q.object.termType === "Literal")
      .map((q) => q.object.value);
    expect(texts).toEqual(expect.arrayContaining(["second", "kept"]));
    expect(texts).not.toContain("first");
    expect(await canonicalHash(after, fields, url)).toBe(
      await canonicalHash(doc("second").dataset, fields, url),
    );
  });
});

describe("finding 2: write-back after a one-way import", () => {
  it("adopts imported items on the first two-way run instead of duplicating them (PoC 2/poc2)", async () => {
    const f = fixture({ writeBack: true }, { delta: true });
    for (let i = 1; i <= 3; i++) {
      f.platform.set(`event ${i}`, `remote-${i}`);
      const url = f.pod.writer.resolve(await syncItemSlug("account/items", `remote-${i}`));
      await fakeOneWayImport(f.pod.writer, f.adapter.metadata.id, url, `event ${i}`);
    }
    const cursors: (string | undefined)[] = [];
    const full = f.adapter.import;
    f.adapter.import = (ctx) => {
      cursors.push(ctx.cursor);
      return full(ctx);
    };
    const state = {
      connectedAt: "2026-01-01T00:00:00Z",
      cursor: "cursor-999",
      lastOutcome: "success" as const,
      counts: { documents: 3, items: 3, skipped: 0 },
    };
    const report = await f.run({ state });
    expect(cursors[0]).toBeUndefined();
    expect(report.outbound.created).toBe(0);
    expect(liveRemote(f)).toHaveLength(3);
    expect((await readLinks(f)).all()).toHaveLength(3);
    expect((await readLinks(f)).adoptedAt).toBeInstanceOf(Date);
    await f.run({ state: present(report.state) });
    expect(cursors[1]).toBe(report.state?.cursor);
    expect(f.platform.calls.apply).toBe(0);
  });
  it("never creates an unlinked imported item remotely and reports it as unlinked-import", async () => {
    const f = fixture({ writeBack: true });
    const url = f.pod.writer.resolve("account/items/imported-elsewhere.ttl");
    await fakeOneWayImport(f.pod.writer, f.adapter.metadata.id, url, "imported");
    const report = await f.run();
    expect(f.platform.calls.apply).toBe(0);
    expect(report.unlinkedImports).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.state?.sync?.unlinkedImports).toBe(1);
    expect(report.skippedItems).toContainEqual({
      direction: "outbound",
      podUrl: url,
      reason: "unlinked-import",
    });
    // A pod-created resource without import provenance is still created remotely.
    await f.pod.put("account/items/pod-created.ttl", "mine");
    await f.run();
    expect(f.platform.calls.create).toBe(1);
  });
});

describe("finding 3: lagging key lookup", () => {
  it("adopts the pending create by idempotency key and never wedges (PoC 2)", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "pod item");
    f.platform.crashAfterCreate = true;
    await f.run();
    const find = f.adapter.findByIdempotencyKey;
    let lag = 1;
    f.adapter.findByIdempotencyKey = async (key, options) =>
      lag-- > 0 ? undefined : find(key, options);
    const second = await f.run();
    expect(itemUrls(f)).toEqual([f.pod.writer.resolve("account/items/new.ttl")]);
    expect(second.failed).toBe(0);
    const third = await f.run();
    expect(third.failed).toBe(0);
    expect(liveRemote(f)).toHaveLength(1);
    expect(f.platform.calls.create).toBe(1);
  });
  it("defers keyless unlinked inbound items while a create is unresolved", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "pod item");
    f.platform.crashAfterCreate = true;
    await f.run();
    // A provider that does not echo keys, and a lookup that lags.
    const full = f.adapter.import;
    f.adapter.import = (ctx) =>
      full({
        ...ctx,
        sync: {
          ...ctx.sync,
          resolve: (id, prefix) => ctx.sync.resolve(id, prefix),
          upsert: ({ idempotencyKey: _key, ...item }) => ctx.sync.upsert(item),
        },
      });
    f.adapter.findByIdempotencyKey = async () => undefined;
    // Inbound runs first: the keyless echo of our create (equal mapped hash) waits; then the
    // outbound retry is deduplicated by the provider and links the item.
    const report = await f.run();
    expect(report.deferred).toBe(1);
    expect(report.state?.sync?.deferred).toBe(1);
    expect(itemUrls(f)).toEqual([f.pod.writer.resolve("account/items/new.ttl")]);
    await f.run();
    expect(itemUrls(f)).toEqual([f.pod.writer.resolve("account/items/new.ttl")]);
    expect(liveRemote(f)).toHaveLength(1);
    expect((await f.run()).deferred).toBe(0);
  });
  it("records a duplicate provider identity as a manual conflict instead of wedging", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("existing");
    await f.run();
    await f.pod.put("account/items/new.ttl", "pod item");
    // The provider answers the create with the already-linked item.
    f.adapter.applyRemote = async () => ({
      remoteId: "remote-1",
      remoteVersion: present(f.platform.items.get("remote-1")).version,
    });
    const report = await f.run();
    expect(report.conflicts).toBe(1);
    expect(report.skippedItems).toContainEqual(
      expect.objectContaining({ reason: "duplicate-identity" }),
    );
    const conflict = present(
      (await readLinks(f)).byPodUrl(f.pod.writer.resolve("account/items/new.ttl")),
    );
    expect(conflict.conflict).toMatchObject({ resolution: "manual", remoteId: "remote-1" });
    expect(conflict.remoteId).toBeUndefined();
    const again = await f.run();
    expect(again.conflicts).toBe(1);
    expect((await readLinks(f)).byRemoteId("remote-1")?.podUrl).toBe(f.pod.writer.resolve(ITEM));
  });
  it("converts duplicate identities found on load into manual conflicts", async () => {
    const f = fixture();
    f.platform.set("one", "remote-1");
    await f.run();
    await f.pod.put("account/items/copy.ttl", "copy");
    const store = await readLinks(f);
    const copyUrl = f.pod.writer.resolve("account/items/copy.ttl");
    // Persist a second record with the same identity directly, as a cross-process race could.
    const linked = present(store.byRemoteId("remote-1"));
    const shard = await store.shardOf(copyUrl);
    const slug = `account/links/${shard.toString(16).padStart(2, "0")}.ttl`;
    const stored = await f.pod.writer.read(slug);
    const dataset = stored?.dataset ?? new Store();
    const record = new LinkRecord(
      `${f.pod.writer.resolve(slug)}#${await sha256(copyUrl)}`,
      dataset,
      DataFactory,
    );
    record.types.add(SYNC.Link);
    record.record = { ...linked, podUrl: copyUrl } satisfies SyncLink;
    await f.pod.writer.write(
      { slug, dataset, category: "sync-links", forClass: SYNC.Link },
      stored?.etag ? { ifMatch: stored.etag } : { ifNoneMatch: "*" },
    );
    const report = await f.run();
    expect(report.conflicts).toBe(1);
    const fresh = await readLinks(f);
    expect(fresh.duplicates()).toHaveLength(0);
    expect(fresh.byPodUrl(copyUrl)?.conflict?.remoteId).toBe("remote-1");
  });
});

describe("finding 4: link store capacity", () => {
  it("syncs 129 ids that fnv1a would have ground into one shard (PoC 3)", async () => {
    const f = fixture();
    for (let i = 0; i < 129; i++) f.platform.set(`x${i}`, `evt${i}`);
    expect((await f.run()).failed).toBe(0);
    expect((await f.run()).failed).toBe(0);
    expect((await readLinks(f)).all()).toHaveLength(129);
  }, 30_000);
});

describe("finding 5: per-item failure isolation and framework-owned slugs", () => {
  it("maps remote ids to <prefix>/<32 hex of sha-256>.ttl", async () => {
    expect(ITEM).toBe(`account/items/${(await sha256("remote-1")).slice(0, 32)}.ttl`);
    const f = fixture();
    f.platform.set("../../escape?#", "../../escape?#");
    await f.run();
    expect(itemUrls(f)).toEqual([
      f.pod.writer.resolve(await syncItemSlug("account/items", "../../escape?#")),
    ]);
    f.adapter.import = async (ctx) => {
      await ctx.sync.resolve("x", "account/elsewhere");
      return {};
    };
    await expect(f.run()).rejects.toThrow("declared write-back container");
  });
  it("one failing outbound mapping does not stop the others", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/a.ttl", "a");
    await f.pod.put("account/items/bad.ttl", "bad");
    await f.pod.put("account/items/c.ttl", "c");
    const toRemote = f.adapter.toRemote;
    f.adapter.toRemote = (resource) => {
      if (resource.url.endsWith("bad.ttl")) throw new Error("adapter bug with secret token abc");
      return toRemote(resource);
    };
    const report = await f.run();
    expect(report.outbound.created).toBe(2);
    expect(report.skippedItems).toContainEqual({
      direction: "outbound",
      podUrl: f.pod.writer.resolve("account/items/bad.ttl"),
      reason: "mapping-failed",
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });
  it("retries a failed inbound item after the delta cursor advanced", async () => {
    const f = fixture({}, { delta: true });
    f.platform.set("good", "remote-1");
    f.platform.set("bad", "remote-2");
    const badUrl = f.pod.writer.resolve(await syncItemSlug("account/items", "remote-2"));
    const write = f.pod.writer.write;
    let fail = true;
    f.pod.writer.write = async (doc, conditions) => {
      if (fail && f.pod.writer.resolve(doc.slug) === badUrl) throw new Error("pod hiccup");
      return write(doc, conditions);
    };
    const first = await f.run();
    expect(first.skippedItems).toContainEqual({
      direction: "inbound",
      remoteId: "remote-2",
      reason: "write-failed",
    });
    expect(f.pod.name(ITEM)).toBe("good");
    fail = false;
    // The cursor advanced past remote-2, but the manifest keeps it pending.
    const second = await f.run({ state: present(first.state) });
    expect(second.failed).toBe(0);
    expect(f.pod.documents.has(badUrl)).toBe(true);
    expect((await readLinks(f)).pending()).toHaveLength(0);
  });
  it("records adapter-side mapping failures through ctx.sync.fail for retry", async () => {
    const f = fixture({}, { delta: true });
    const full = f.adapter.import;
    let broken = true;
    f.adapter.import = async (ctx) => {
      if (broken) {
        ctx.sync.fail("remote-9");
        return { cursor: "cursor-5" };
      }
      expect(ctx.sync.pendingRemoteIds()).toContain("remote-9");
      return full(ctx);
    };
    const first = await f.run();
    expect(first.skippedItems).toContainEqual({
      direction: "inbound",
      remoteId: "remote-9",
      reason: "mapping-failed",
    });
    broken = false;
    await f.run({ state: present(first.state) });
  });
  it("skips sub-containers and non-RDF files, and fails only a weak-ETag item", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/good.ttl", "good");
    await f.pod.put("account/items/weak.ttl", "weak");
    const weakUrl = f.pod.writer.resolve("account/items/weak.ttl");
    present(f.pod.documents.get(weakUrl)).etag = 'W/"weak"';
    const list = f.pod.writer.list;
    f.pod.writer.list = async function* (container) {
      yield* list(container);
      yield { url: f.pod.writer.resolve("account/items/sub/") };
      yield { url: f.pod.writer.resolve("account/items/photo.png"), etag: '"p"', nonRdf: true };
    };
    const report = await f.run();
    expect(report.outbound.created).toBe(1);
    expect(report.skippedItems).toEqual(
      expect.arrayContaining([
        { direction: "outbound", podUrl: weakUrl, reason: "weak-etag" },
        expect.objectContaining({ reason: "unsupported-resource" }),
      ]),
    );
    expect(report.failed).toBe(1);
  });
});

describe("finding 7: rename/move", () => {
  it.each([
    false,
    true,
  ])("re-points the link on a move with propagateDeletes=%s (PoC 4/4b)", async (propagateDeletes) => {
    const f = fixture({ writeBack: true, propagateDeletes });
    f.platform.set("initial");
    await f.run();
    const from = f.pod.writer.resolve(ITEM);
    f.pod.documents.delete(from);
    await f.pod.put("account/items/renamed.ttl", "initial");
    const report = await f.run();
    expect(report.moved).toBe(1);
    expect(report.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(report.pendingDeletes).toBe(0);
    expect(liveRemote(f).map((i) => i.id)).toEqual(["remote-1"]);
    const links = await readLinks(f);
    expect(links.byRemoteId("remote-1")?.podUrl).toBe(
      f.pod.writer.resolve("account/items/renamed.ttl"),
    );
    expect(links.byPodUrl(from)).toBeUndefined();
    // The moved item keeps syncing at its new URL.
    f.platform.set("remote edit");
    await f.run();
    expect(f.pod.name("account/items/renamed.ttl")).toBe("remote edit");
    expect(itemUrls(f)).toEqual([f.pod.writer.resolve("account/items/renamed.ttl")]);
  });
  it("recovers a move interrupted after the new record was written", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    const from = f.pod.writer.resolve(ITEM);
    const to = f.pod.writer.resolve("account/items/renamed.ttl");
    f.pod.documents.delete(from);
    await f.pod.put("account/items/renamed.ttl", "initial");
    const write = f.pod.writer.write;
    let linkWrites = 0;
    f.pod.writer.write = async (doc, conditions) => {
      // Fail the move's second link write: dropping the old record.
      if (/\/links\/[0-9a-f]{2}/.test(doc.slug) && ++linkWrites === 2)
        throw new Error("interrupted");
      return write(doc, conditions);
    };
    await f.run();
    f.pod.writer.write = write;
    const interrupted = await readLinks(f);
    expect(interrupted.staleMoves().map((link) => link.podUrl)).toEqual([from]);
    expect(interrupted.byRemoteId("remote-1")).toMatchObject({ podUrl: to, movedFrom: from });
    const report = await f.run();
    expect(report.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    const links = await readLinks(f);
    expect(links.all()).toHaveLength(1);
    expect(links.all()[0]).toMatchObject({ podUrl: to, remoteId: "remote-1" });
    expect(links.all()[0]?.movedFrom).toBeUndefined();
    expect(liveRemote(f)).toHaveLength(1);
  });
});

describe("finding 8: activity on a tombstone", () => {
  it("turns a remote restore of a trashed item into a manual conflict (PoC 5)", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    f.platform.remove();
    await f.run();
    f.platform.set("restored", "remote-1");
    const report = await f.run();
    expect(f.pod.name(ITEM)).toBeUndefined();
    expect(report.conflicts).toBe(1);
    expect(report.issues[0]).toMatchObject({
      status: "trashed",
      conflict: { resolution: "manual" },
    });
    expect((await f.run()).conflicts).toBe(1);
  });
  it("turns a pod resource recreated over a tombstone into a manual conflict", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("initial");
    await f.run();
    await present(f.pod.writer.remove)(ITEM);
    await f.run();
    expect(liveRemote(f)).toHaveLength(0);
    await f.pod.put(ITEM, "recreated");
    const report = await f.run();
    expect(report.conflicts).toBe(1);
    expect(report.outbound.created).toBe(0);
    expect(report.issues[0]).toMatchObject({ status: "pod-deleted" });
  });
});

describe("finding 9: manual conflicts", () => {
  it("lists manual conflicts in pendingRemoteIds", async () => {
    const f = fixture({ writeBack: true, conflictPolicy: "manual" });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    f.platform.set("remote");
    await f.run();
    let seen: readonly string[] = [];
    f.adapter.import = async (ctx) => {
      seen = ctx.sync.pendingRemoteIds();
      return {};
    };
    await f.run();
    expect(seen).toContain("remote-1");
  });
  it.each([
    "pod-wins",
    "remote-wins",
  ] as const)("execute resolves a manual conflict under %s without inbound", async (policy) => {
    const f = fixture({ writeBack: true, conflictPolicy: "manual" });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    f.platform.set("remote");
    await f.run();
    f.adapter.import = async () => ({}); // The provider delta omits the item.
    const report = await f.run({}, { conflictPolicy: policy });
    const winner = policy === "pod-wins" ? "pod" : "remote";
    expect(f.pod.name(ITEM)).toBe(winner);
    expect(f.platform.items.get("remote-1")?.name).toBe(winner);
    expect(report.issues[0]?.conflict?.resolution).toBe(policy === "pod-wins" ? "pod" : "remote");
  });
});

describe("finding 10: listing validators", () => {
  it("executes when the listing and the link both lack an ETag", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "new");
    f.pod.writer.list = async function* () {
      yield { url: f.pod.writer.resolve("account/items/new.ttl") };
    };
    const report = await f.run();
    expect(report.outbound.created).toBe(1);
  });
});

describe("finding 11: pod wins without write-back; storage Last-Modified", () => {
  it("records the baseline so a pod win is not re-conflicted, then pushes once enabled", async () => {
    const f = fixture({ conflictPolicy: "pod-wins" });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    f.platform.set("remote");
    const first = await f.run();
    expect(first.conflicts).toBe(1);
    const write = vi.spyOn(f.pod.writer, "write");
    await f.run();
    const itemWrites = write.mock.calls.filter(([doc]) => doc.slug.includes("/items/"));
    expect(itemWrites).toHaveLength(0);
    expect(f.pod.name(ITEM)).toBe("pod");
    await f.run({}, { writeBack: true });
    expect(f.platform.items.get("remote-1")?.name).toBe("pod");
  });
  it("forwards a backend's Last-Modified and omits it otherwise", async () => {
    const container = `${TEST_POD_ROOT}integrations/toy/`;
    const storage = createMemoryStorage({ root: TEST_POD_ROOT });
    const readRdf = storage.readRdf.bind(storage);
    const modified = new Date("2026-05-01T00:00:00Z");
    let withDate = true;
    const port = createStoragePodWriter({
      storage: {
        ...storage,
        readRdf: async (...args: Parameters<typeof storage.readRdf>) => ({
          ...(await readRdf(...args)),
          ...(withDate ? { lastModified: modified } : {}),
        }),
      },
      container,
    });
    await port.write(fakeSyncDocument(`${container}a.ttl`, "a"), { ifNoneMatch: "*" });
    expect((await port.read("a.ttl"))?.lastModified).toBe(modified.toISOString());
    withDate = false;
    expect((await port.read("a.ttl"))?.lastModified).toBeUndefined();
  });
});

describe("finding 12: sync vocabulary", () => {
  it("takes every connector sync term from @jeswr/suite-vocab", () => {
    for (const [key, value] of Object.entries(CONNECTOR_SYNC))
      expect(SYNC[key as keyof typeof SYNC]).toBe(value);
    expect(SYNC.revisionOf).toBe(`${NS.PROV}wasRevisionOf`);
  });
});

describe("hash location independence", () => {
  it("hashes document-relative IRIs the same at any URL, but distinguishes foreign IRIs", async () => {
    const fields = [`${SCHEMA}name`, `${SCHEMA}url`];
    const at = (url: string, ref = "#item") =>
      new Store(
        new Parser({ baseIRI: url }).parse(`<#item> <${SCHEMA}name> "x"; <${SCHEMA}url> <${ref}>.`),
      );
    const a = "https://pod.test/a.ttl";
    const b = "https://pod.test/b.ttl";
    expect(await canonicalHash(at(a), fields, a)).toBe(await canonicalHash(at(b), fields, b));
    expect(await canonicalHash(at(a), fields)).not.toBe(await canonicalHash(at(b), fields));
    expect(await canonicalHash(at(a, "https://other.test/#item"), fields, a)).not.toBe(
      await canonicalHash(at(a), fields, a),
    );
  });
});

// Round 2 of the review: regressions R1–R3b and findings 4–6.

/** Copy a dataset, rebasing every IRI at `from` (or one of its fragments) onto `to`. */
function rebase(dataset: Iterable<Quad>, from: string, to: string): Store {
  const move = <T extends Term>(term: T): T | NamedNode =>
    term.termType === "NamedNode" && (term.value === from || term.value.startsWith(`${from}#`))
      ? DataFactory.namedNode(to + term.value.slice(from.length))
      : term;
  const result = new Store();
  for (const q of dataset)
    result.add(
      DataFactory.quad(
        move(q.subject) as Quad["subject"],
        q.predicate,
        move(q.object) as Quad["object"],
        q.graph,
      ),
    );
  return result;
}
/** Move a synced, connector-imported item document the way a pod app would. */
function moveDocument(f: Fixture, mode: "verbatim" | "relative+edit") {
  const from = f.pod.writer.resolve(ITEM);
  const to = f.pod.writer.resolve("account/items/renamed.ttl");
  const stored = present(f.pod.documents.get(from));
  const moved =
    mode === "verbatim" ? new Store([...stored.dataset]) : rebase(stored.dataset, from, to);
  if (mode === "relative+edit")
    new PodThing(`${to}#item`, moved, DataFactory).name = "initial (renamed)";
  f.pod.documents.delete(from);
  f.pod.documents.set(to, {
    dataset: moved,
    etag: '"moved"',
    lastModified: new Date().toISOString(),
  });
  return { from, to };
}

describe("round 2, finding 1: a renamed item is never deleted at the provider", () => {
  it.each([
    false,
    true,
  ])("re-points a verbatim copy (absolute IRIs) and pushes an update, propagateDeletes=%s (R1)", async (propagateDeletes) => {
    const f = fixture({ writeBack: true, propagateDeletes });
    f.platform.set("initial");
    await f.run();
    const { from, to } = moveDocument(f, "verbatim");
    const report = await f.run();
    expect(report.moved).toBe(1);
    expect(report.outbound).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(report.unlinkedImports).toBe(0);
    expect(report.pendingDeletes).toBe(0);
    expect(liveRemote(f).map((i) => [i.id, i.name])).toEqual([["remote-1", "initial"]]);
    const links = await readLinks(f);
    expect(links.byRemoteId("remote-1")?.podUrl).toBe(to);
    expect(links.byPodUrl(from)).toBeUndefined();
    // The document now describes itself at its new URL.
    expect(f.pod.name("account/items/renamed.ttl")).toBe("initial");
    await f.run(); // Echo of the update.
    const settled = await f.run();
    expect(settled.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(f.platform.calls.create + f.platform.calls.delete).toBe(0);
    f.platform.set("remote edit");
    await f.run();
    expect(f.pod.name("account/items/renamed.ttl")).toBe("remote edit");
    expect(itemUrls(f)).toEqual([to]);
  });
  it.each([
    false,
    true,
  ])("holds the delete of a rebased + edited copy, then records a manual conflict, propagateDeletes=%s (R1)", async (propagateDeletes) => {
    const f = fixture({ writeBack: true, propagateDeletes });
    f.platform.set("initial");
    await f.run();
    const { from } = moveDocument(f, "relative+edit");
    const first = await f.run();
    expect(first.unlinkedImports).toBe(1);
    expect(first.pendingDeletes).toBe(1);
    expect(first.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(first.conflicts).toBe(0);
    const second = await f.run();
    expect(second.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(second.conflicts).toBe(1);
    expect(second.issues).toContainEqual(
      expect.objectContaining({
        podUrl: from,
        remoteId: "remote-1",
        pendingDelete: true,
        conflict: expect.objectContaining({ resolution: "manual" }),
      }),
    );
    await f.run();
    expect(liveRemote(f).map((i) => i.id)).toEqual(["remote-1"]);
    expect(f.platform.calls.create + f.platform.calls.delete).toBe(0);
  });
  it("decides a held delete on the next run once no unlinked arrival remains", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("initial");
    await f.run();
    const { to } = moveDocument(f, "relative+edit");
    expect((await f.run()).outbound.deleted).toBe(0);
    f.pod.documents.delete(to); // The owner removes the arrival as well.
    const report = await f.run();
    expect(report.outbound.deleted).toBe(1);
    expect(report.conflicts).toBe(0);
    expect(liveRemote(f)).toHaveLength(0);
  });
  it("holds deletes on an ambiguous move candidate", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("initial");
    await f.run();
    const from = f.pod.writer.resolve(ITEM);
    f.pod.documents.delete(from);
    // Two pod-created documents both describe the vanished item.
    for (const name of ["copy-a", "copy-b"]) {
      const url = f.pod.writer.resolve(`account/items/${name}.ttl`);
      const dataset = new Store();
      new PodThing(`${from}#item`, dataset, DataFactory).name = name;
      f.pod.documents.set(url, {
        dataset,
        etag: `"${name}"`,
        lastModified: "2026-01-01T00:00:00Z",
      });
    }
    const report = await f.run();
    expect(report.moved).toBe(0);
    expect(report.outbound.deleted).toBe(0);
    expect(report.pendingDeletes).toBe(1);
    expect(f.platform.items.get("remote-1")?.deleted).toBeFalsy();
  });
});

describe("round 2, finding 2: hashing and merging are scoped to the item's own subjects", () => {
  it("keeps a pod-only triple with a mapped predicate on another subject through the echo (R2)", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    const url = f.pod.writer.resolve(ITEM);
    const doc = present(f.pod.documents.get(url));
    doc.dataset.add(
      DataFactory.quad(
        DataFactory.namedNode(`${url}#note`),
        DataFactory.namedNode(`${SCHEMA}name`),
        DataFactory.literal("my private note"),
      ),
    );
    doc.etag = '"local"';
    const local = await f.run();
    // Another subject is not the item: nothing to push.
    expect(local.outbound.updated).toBe(0);
    await f.run();
    f.platform.set("remote rename");
    await f.run();
    await f.run();
    const after = present(f.pod.documents.get(url)).dataset;
    expect(new PodThing(`${url}#note`, after, DataFactory).name).toBe("my private note");
    expect(f.pod.name(ITEM)).toBe("remote rename");
  });
  it("hashes only the document's subjects and the blank nodes their mapped quads reach", async () => {
    const fields = [`${SCHEMA}name`, `${SCHEMA}location`];
    const url = "https://pod.test/a.ttl";
    const parse = (text: string) =>
      new Store(new Parser({ baseIRI: url }).parse(`@prefix s: <${SCHEMA}>. ${text}`));
    const item = `<#item> s:name "n"; s:location [ s:name "here" ].`;
    const base = await canonicalHash(parse(item), fields, url);
    expect(
      await canonicalHash(
        parse(`${item} <https://other.test/x> s:name "other". [] s:name "floating".`),
        fields,
        url,
      ),
    ).toBe(base);
    expect(await canonicalHash(parse(`${item} <#other> s:name "other".`), fields, url)).not.toBe(
      base,
    );
    expect(
      await canonicalHash(parse(`<#item> s:name "n"; s:location [ s:name "there" ].`), fields, url),
    ).not.toBe(base);
    // Declared subjects replace the fragment default: other fragments become pod-only.
    const declared = [`${url}#item`];
    expect(
      await canonicalHash(parse(`${item} <#other> s:name "other".`), fields, url, declared),
    ).toBe(base);
    expect(
      await canonicalHash(parse(`${item} <https://other.test/x> s:name "other".`), fields, url, [
        ...declared,
        "https://other.test/x",
      ]),
    ).not.toBe(base);
  });
  it("writes a trash snapshot before a merge removes pod quads the incoming document lacks", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    const trash = () => [...f.pod.documents.keys()].filter((u) => u.includes("/trash/"));
    await f.run(); // An echo that removes nothing writes no snapshot.
    expect(trash()).toHaveLength(0);
    f.platform.set("remote rename");
    await f.run();
    const [snapshotUrl] = trash();
    const snapshot = present(f.pod.documents.get(present(snapshotUrl))).dataset;
    expect(f.pod.protectedUrls.has(present(snapshotUrl))).toBe(true);
    expect(new SyncMetadata(present(snapshotUrl), snapshot, DataFactory).revisionOf).toBe(
      f.pod.writer.resolve(ITEM),
    );
    expect(new PodThing(`${f.pod.writer.resolve(ITEM)}#item`, snapshot, DataFactory).name).toBe(
      "initial",
    );
  });
});

describe("round 2, finding 3: unresolved creates defer only their own echo", () => {
  it("imports a colleague's item while a failed create's pod resource is gone (R3)", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "pod item");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async () => {
      throw new Error("ECONNRESET");
    };
    const first = await f.run();
    expect(first.failed).toBe(1);
    f.adapter.applyRemote = apply;
    await present(f.pod.writer.remove)("account/items/new.ttl");
    f.platform.set("shared by a colleague", "remote-9");
    const report = await f.run();
    expect(report.deferred).toBe(0);
    const colleague = await syncItemSlug("account/items", "remote-9");
    expect(f.pod.name(colleague)).toBe("shared by a colleague");
    // The dead create is retired into a visible manual conflict, never re-sent.
    expect(report.conflicts).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        podUrl: f.pod.writer.resolve("account/items/new.ttl"),
        conflict: expect.objectContaining({ resolution: "manual" }),
      }),
    );
    await f.run();
    expect(f.platform.calls.create).toBe(0);
  });
  it("imports a new item while the provider rejects another, and retires that create after 3 attempts (R3b)", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/bad.ttl", "rejected by provider");
    const apply = f.adapter.applyRemote;
    let rejected = 0;
    f.adapter.applyRemote = async (op, options) => {
      if (op.name === "rejected by provider") {
        rejected++;
        throw Object.assign(new Error("400 invalid"), { status: 400 });
      }
      return apply(op, options);
    };
    await f.run();
    f.platform.set("new remote", "remote-7");
    const second = await f.run();
    expect(second.deferred).toBe(0);
    expect(f.pod.name(await syncItemSlug("account/items", "remote-7"))).toBe("new remote");
    const third = await f.run();
    expect(rejected).toBe(3);
    expect(third.conflicts).toBe(1);
    expect(third.issues).toContainEqual(
      expect.objectContaining({
        podUrl: f.pod.writer.resolve("account/items/bad.ttl"),
        conflict: expect.objectContaining({ resolution: "manual" }),
      }),
    );
    await f.run();
    expect(rejected).toBe(3);
  });
  it("does not defer while write-back is off or the provider cannot deduplicate keys", async () => {
    for (const [settings, fake] of [
      [{ writeBack: false }, {}],
      [{}, { deduplicatesCreateKeys: false }],
    ] as const) {
      const f = fixture({ writeBack: true }, fake);
      await f.pod.put("account/items/new.ttl", "pod item");
      f.platform.crashAfterCreate = true;
      await f.run();
      // A provider that does not echo keys, and a lookup that lags.
      const full = f.adapter.import;
      f.adapter.import = (ctx) =>
        full({
          ...ctx,
          sync: {
            ...ctx.sync,
            resolve: (id, prefix) => ctx.sync.resolve(id, prefix),
            upsert: ({ idempotencyKey: _key, ...item }) => ctx.sync.upsert(item),
          },
        });
      f.adapter.findByIdempotencyKey = async () => undefined;
      // Same mapped content as the open create: only a re-sendable create would defer it.
      f.platform.set("pod item", "remote-5");
      const report = await f.run({}, settings);
      // (A non-deduplicating provider's own unconfirmed create still waits outbound.)
      expect(report.skippedItems.filter((i) => i.direction === "inbound")).toEqual([]);
      expect(f.pod.name(await syncItemSlug("account/items", "remote-5"))).toBe("pod item");
    }
  });
});

describe("round 2, finding 4: adoption by echoed key requires the created content", () => {
  it("records a manual conflict when a third party reuses our create key", async () => {
    const f = fixture({ writeBack: true }, { delta: true });
    await f.pod.put("account/items/new.ttl", "pod item");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async () => {
      throw new Error("ECONNRESET");
    };
    await f.run();
    f.adapter.applyRemote = apply;
    f.adapter.findByIdempotencyKey = async () => undefined;
    const newUrl = f.pod.writer.resolve("account/items/new.ttl");
    const key = present((await readLinks(f)).byPodUrl(newUrl)?.pendingCreate?.key);
    const reused = f.platform.set("someone else's item", "third");
    f.platform.items.set("third", { ...reused, key });
    const report = await f.run();
    expect(f.pod.name("account/items/new.ttl")).toBe("pod item");
    expect(report.conflicts).toBe(1);
    expect((await readLinks(f)).byPodUrl(newUrl)).toMatchObject({
      conflict: { resolution: "manual", remoteId: "third" },
    });
    expect(f.platform.items.get("third")?.name).toBe("someone else's item");
    // The provider's item is imported at its own slug on the next run.
    await f.run({ state: present(report.state) });
    expect(f.pod.name(await syncItemSlug("account/items", "third"))).toBe("someone else's item");
    expect(f.pod.name("account/items/new.ttl")).toBe("pod item");
  });
});

describe("round 2, finding 5: a lost manifest never re-salts existing link shards", () => {
  it("fails the run with a fixed error and leaves the link documents alone", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    const manifest = f.pod.writer.resolve("account/links/manifest.ttl");
    const shards = [...f.pod.documents.keys()].filter(
      (u) => u.includes("/links/") && u !== manifest,
    );
    expect(shards.length).toBeGreaterThan(0);
    f.pod.documents.delete(manifest);
    await expect(f.run()).rejects.toMatchObject({ name: "LinkManifestLostError" });
    expect(f.pod.documents.has(manifest)).toBe(false);
    await expect(readLinks(f)).rejects.toMatchObject({ name: "LinkManifestLostError" });
    for (const shard of shards) expect(f.pod.documents.has(shard)).toBe(true);
    expect(f.platform.calls.apply).toBe(0);
  });
});

describe("round 2, finding 6: an inbound failure without an identity holds the cursor", () => {
  it.each([
    "fail",
    "upsert",
  ] as const)("keeps the previous cursor after ctx.sync.%s without a remoteId", async (kind) => {
    const f = fixture({}, { delta: true });
    f.platform.set("initial");
    const first = await f.run();
    const full = f.adapter.import;
    f.adapter.import = async (ctx) => {
      if (kind === "fail") ctx.sync.fail(undefined as unknown as string);
      else
        await ctx.sync.upsert({
          remoteVersion: "v1",
          document: fakeSyncDocument(f.pod.writer.resolve(ITEM), "x"),
        } as unknown as Parameters<typeof ctx.sync.upsert>[0]);
      return { cursor: "cursor-advanced" };
    };
    const report = await f.run({ state: present(first.state) });
    expect(report.failed).toBe(1);
    expect(report.cursorHeld).toBe(true);
    expect(report.cursor).toBe(first.state?.cursor);
    f.adapter.import = full;
    const next = await f.run({ state: present(report.state) });
    expect(next.cursorHeld).toBe(false);
  });
});

describe("round 2: a move within one link shard document", () => {
  it("re-points a link whose old and new records share a shard document", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("initial");
    await f.run();
    const store = await readLinks(f);
    const from = f.pod.writer.resolve(ITEM);
    const shard = await store.shardOf(from);
    let slug = "";
    for (let i = 0; !slug; i++)
      if ((await store.shardOf(f.pod.writer.resolve(`account/items/renamed-${i}.ttl`))) === shard)
        slug = `account/items/renamed-${i}.ttl`;
    f.pod.documents.delete(from);
    await f.pod.put(slug, "initial");
    const report = await f.run();
    expect(report.moved).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.outbound).toEqual({ created: 0, updated: 0, deleted: 0 });
    const links = await readLinks(f);
    expect(links.all()).toHaveLength(1);
    expect(links.byRemoteId("remote-1")).toMatchObject({ podUrl: f.pod.writer.resolve(slug) });
    expect(links.byRemoteId("remote-1")?.movedFrom).toBeUndefined();
  });
});
