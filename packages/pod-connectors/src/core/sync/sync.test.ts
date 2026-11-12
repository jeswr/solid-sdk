// AUTHORED-BY Codex GPT-6.1-Sol
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../../pod/resource.js";
import { runImport } from "../import-runner.js";
import { copyDataset } from "../incremental.js";
import { fnv1a } from "../slug.js";
import { PodThing, SCHEMA } from "../vocab.js";
import { resolveConflict } from "./conflict.js";
import { twoWayConformanceSuite } from "./conformance.js";
import { scanWriteBack } from "./detection.js";
import { createFakeTwoWayAdapter, createMemorySyncPod, fakeSyncDocument } from "./fake-platform.js";
import { canonicalHash, sha256 } from "./hash.js";
import { createLinkStore, MAX_LINKS_PER_SHARD } from "./link-store.js";
import { runTwoWaySync } from "./runner.js";
import type { ConflictPolicy, SyncConnection, SyncLink, SyncPorts } from "./types.js";
import { LinkRecord, SYNC, SyncMetadata } from "./vocab.js";

function present<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing expected fixture value.");
  return value;
}
const ITEM = "account/items/remote-1.ttl";
function fixture(connection: Partial<SyncConnection> = {}) {
  const pod = createMemorySyncPod();
  const { adapter, platform } = createFakeTwoWayAdapter();
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
async function readLinks(f: ReturnType<typeof fixture>) {
  const links = createLinkStore(f.pod.writer, "account");
  await links.load();
  return links;
}

describe("two-way reference conformance", () => {
  it("runs the public provider conformance suite over the fake platform", async () => {
    await twoWayConformanceSuite(() => {
      const f = fixture();
      let local = ITEM;
      return {
        adapter: f.adapter,
        connection: { account: "account" },
        ports: f.ports,
        seedRemote: (name: string, modifiedAt?: string) => {
          f.platform.set(name, "remote-1", modifiedAt);
        },
        editPod: async (name: string, modifiedAt?: string) => {
          if (!f.platform.items.size) local = "account/items/new.ttl";
          await f.pod.put(local, name, modifiedAt);
        },
        deletePod: async () => {
          await f.pod.writer.remove?.(local);
        },
        deleteAtPlatform: () => {
          f.platform.remove();
        },
        podName: () => f.pod.name(local),
        remoteName: () => [...f.platform.items.values()][0]?.name,
        remoteCount: () => [...f.platform.items.values()].filter((item) => !item.deleted).length,
        remoteWrites: () => f.platform.calls.apply,
        crashAfterCreate: () => {
          f.platform.crashAfterCreate = true;
        },
      };
    });
  });
  it("imports, stores protected links, suppresses echo, and records an outbound Activity", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("initial");
    await f.run();
    await f.pod.put(ITEM, "local edit");
    const report = await f.run();
    expect(report.outbound).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(f.platform.items.get("remote-1")?.name).toBe("local edit");
    const links = (await readLinks(f)).all();
    expect(links[0]?.remoteVersion).toBe(f.platform.items.get("remote-1")?.version);
    expect(f.pod.protectedUrls.size).toBeGreaterThan(64);
    const activities = [...f.pod.documents].filter(([url]) => /outbound-/.test(url));
    expect(activities).toHaveLength(1);
    expect(
      [...present(activities[0])[1].dataset].some((q) => q.object.value === `${NS.PROV}Activity`),
    ).toBe(true);
    await f.run();
    expect(f.platform.calls.apply).toBe(1);
  });
  it("retries a crash after create using one persisted key and original URL", async () => {
    const f = fixture({ writeBack: true });
    const local = "account/items/new.ttl";
    await f.pod.put(local, "new");
    f.platform.crashAfterCreate = true;
    await expect(f.run()).rejects.toThrow("Synthetic crash");
    const pending = (await readLinks(f)).all()[0];
    expect(pending?.pendingCreate?.key).toBeTruthy();
    expect(f.platform.items.size).toBe(1);
    await f.pod.put(local, "edited after crash");
    await f.run();
    expect(f.platform.calls.create).toBe(1);
    expect(f.platform.calls.update).toBe(1);
    expect([...f.platform.items.values()][0]?.name).toBe("edited after crash");
    expect([...f.pod.documents.keys()].filter((u) => u.includes("/items/"))).toEqual([
      f.pod.writer.resolve(local),
    ]);
    expect((await readLinks(f)).all()[0]?.pendingCreate).toBeUndefined();
  });
  it("retries the original payload when a create failed before the platform and the pod changed", async () => {
    const f = fixture({ writeBack: true });
    const local = "account/items/new.ttl";
    await f.pod.put(local, "original");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport down"))
      .mockImplementation(apply);
    await expect(f.run()).rejects.toThrow("transport down");
    await f.pod.put(local, "later edit");
    await f.run();
    expect([...f.platform.items.values()][0]?.name).toBe("original");
    await f.run();
    expect([...f.platform.items.values()][0]?.name).toBe("later edit");
    expect(f.platform.calls.create).toBe(1);
  });
  it("recovers an earlier create identity when write-back is later switched off", async () => {
    const f = fixture({ writeBack: true });
    const local = "account/items/new.ttl";
    await f.pod.put(local, "new");
    f.platform.crashAfterCreate = true;
    await expect(f.run()).rejects.toThrow("Synthetic crash");
    await f.run({}, { writeBack: false });
    expect(f.platform.calls.create).toBe(1);
    expect([...f.pod.documents.keys()].filter((url) => url.includes("/items/"))).toEqual([
      f.pod.writer.resolve(local),
    ]);
  });
  it("does not suppress a platform edit made after the unacknowledged create", async () => {
    const f = fixture({ writeBack: true });
    const local = "account/items/new.ttl";
    await f.pod.put(local, "created");
    f.platform.crashAfterCreate = true;
    await expect(f.run()).rejects.toThrow("Synthetic crash");
    const item = present([...f.platform.items.values()][0]);
    f.platform.items.set(item.id, {
      ...item,
      name: "edited on platform",
      version: "external-version",
    });
    await f.run();
    expect(f.pod.name(local)).toBe("edited on platform");
    expect(f.platform.calls.create).toBe(1);
  });
  it("does not checkpoint an adapter that omits the first inbound echo", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "created");
    await f.run();
    f.adapter.import = async () => ({});
    await expect(f.run()).rejects.toThrow("pending remote identities");
  });
  it("writeBack defaults false and never calls any outbound adapter method", async () => {
    const f = fixture();
    await f.pod.put("account/items/new.ttl", "local");
    await f.run();
    expect(f.platform.calls).toEqual({ apply: 0, create: 0, update: 0, delete: 0, find: 0 });
  });
  it("requires explicit consent before any pod/source I/O", async () => {
    const f = fixture({ writeBack: true });
    const read = vi.spyOn(f.pod.writer, "read");
    await expect(f.run({ scopes: [] })).rejects.toThrow("consent");
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    "manual",
    "remote-wins",
    "pod-wins",
    "lww",
  ] as ConflictPolicy[])("preserves the loser under %s", async (policy) => {
    const f = fixture({ writeBack: true, conflictPolicy: policy });
    f.platform.set("original");
    await f.run();
    await f.pod.put(ITEM, "pod", "2026-02-01T00:00:00Z");
    f.platform.set("remote", "remote-1", "2026-03-01T00:00:00Z");
    const report = await f.run();
    const winner = policy === "pod-wins" || policy === "manual" ? "pod" : "remote";
    expect(f.pod.name(ITEM)).toBe(winner);
    expect(report.conflicts).toBe(1);
    expect(report.state?.sync?.conflicts).toBe(1);
    const conflict = present(report.issues[0]?.conflict);
    expect(conflict).toBeDefined();
    const snapshot = present(f.pod.documents.get(conflict.snapshotUrl));
    expect(new SyncMetadata(conflict.snapshotUrl, snapshot.dataset, DataFactory).revisionOf).toBe(
      f.pod.writer.resolve(ITEM),
    );
    expect(
      new PodThing(`${f.pod.writer.resolve(ITEM)}#item`, snapshot.dataset, DataFactory).name,
    ).toBe(winner === "remote" ? "pod" : "remote");
    const item = present(f.pod.documents.get(f.pod.writer.resolve(ITEM)));
    expect(
      new SyncMetadata(f.pod.writer.resolve(ITEM), item.dataset, DataFactory).snapshots.has(
        conflict.snapshotUrl,
      ),
    ).toBe(true);
    if (policy === "manual") {
      expect(f.platform.calls.apply).toBe(0);
      await f.run();
      expect(f.platform.calls.apply).toBe(0);
    } else expect(f.platform.items.get("remote-1")?.name).toBe(winner);
  });
  it("preserves an unlinked existing pod resource as a conflict instead of overwriting it", async () => {
    const f = fixture();
    await f.pod.put(ITEM, "existing");
    f.platform.set("remote");
    const report = await f.run();
    expect(report.conflicts).toBe(1);
    expect(f.pod.name(ITEM)).toBe("existing");
  });
  it("can resolve a stored manual conflict with an explicit policy", async () => {
    const f = fixture({ writeBack: true, conflictPolicy: "manual" });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    f.platform.set("remote");
    await f.run();
    await f.run({}, { conflictPolicy: "remote-wins" });
    expect(f.pod.name(ITEM)).toBe("remote");
  });
  it("does not conflict with a remote version bump whose mapped fields are unchanged", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("original");
    await f.run();
    await f.pod.put(ITEM, "pod edit", "2026-02-01T00:00:00Z");
    f.platform.set("original", "remote-1", "2026-03-01T00:00:00Z");
    const report = await f.run();
    expect(report.conflicts).toBe(0);
    expect(f.pod.name(ITEM)).toBe("pod edit");
    expect(f.platform.items.get("remote-1")?.name).toBe("pod edit");
  });
  it("imports changed mapped fields even when the remote version did not advance", async () => {
    const f = fixture({ writeBack: true });
    const initial = f.platform.set("original");
    await f.run();
    f.platform.items.set(initial.id, { ...initial, name: "remote edit" });
    await f.run();
    expect(f.pod.name(ITEM)).toBe("remote edit");
    expect(f.platform.calls.apply).toBe(0);
  });
  it.each([
    "manual",
    "remote-wins",
    "pod-wins",
    "lww",
  ] as ConflictPolicy[])("detects both sides changing under %s even with an unchanged remote version", async (policy) => {
    const f = fixture({ writeBack: true, conflictPolicy: policy });
    const initial = f.platform.set("original");
    await f.run();
    await f.pod.put(ITEM, "pod", "2026-02-01T00:00:00Z");
    f.platform.items.set(initial.id, {
      ...initial,
      name: "remote",
      modifiedAt: "2026-03-01T00:00:00Z",
    });
    const report = await f.run();
    const winner = policy === "manual" || policy === "pod-wins" ? "pod" : "remote";
    expect(f.pod.name(ITEM)).toBe(winner);
    expect(report.conflicts).toBe(1);
    const conflict = present(report.issues[0]?.conflict);
    const snapshot = present(f.pod.documents.get(conflict.snapshotUrl));
    expect(
      new PodThing(`${f.pod.writer.resolve(ITEM)}#item`, snapshot.dataset, DataFactory).name,
    ).toBe(winner === "remote" ? "pod" : "remote");
  });
  it("keeps an unresolved skew conflict manual and preserves later same-version remote edits", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("original");
    await f.run();
    await f.pod.put(ITEM, "pod", "2026-02-01T00:00:00Z");
    const remote = f.platform.set("remote", "remote-1", "2026-02-01T00:01:00Z");
    const first = await f.run();
    await f.run();
    f.platform.items.set(remote.id, {
      ...remote,
      name: "later remote edit",
      modifiedAt: "2026-03-01T00:00:00Z",
    });
    const report = await f.run();
    const conflict = present(report.issues[0]?.conflict);
    expect(conflict.resolution).toBe("manual");
    expect(conflict.snapshotUrl).not.toBe(first.issues[0]?.conflict?.snapshotUrl);
    const snapshot = present(f.pod.documents.get(conflict.snapshotUrl));
    expect(
      new PodThing(`${f.pod.writer.resolve(ITEM)}#item`, snapshot.dataset, DataFactory).name,
    ).toBe("later remote edit");
    expect(f.platform.calls.apply).toBe(0);
  });
  it("uses the skew guard and keeps close timestamps manual", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod", "2026-02-01T00:00:00Z");
    f.platform.set("remote", "remote-1", "2026-02-01T00:01:00Z");
    const report = await f.run();
    expect(report.issues[0]?.conflict?.resolution).toBe("manual");
    expect(f.platform.calls.apply).toBe(0);
  });
  it("moves remote deletions to protected trash with a 30 day expiry", async () => {
    const f = fixture();
    f.platform.set("keep me");
    await f.run();
    f.platform.remove();
    const now = new Date("2026-04-01T00:00:00Z");
    await f.run({ now: () => now });
    expect(f.pod.name(ITEM)).toBeUndefined();
    const link = present((await readLinks(f)).all()[0]);
    expect(link.status).toBe("trashed");
    expect(f.pod.protectedUrls.has(present(link.trashUrl))).toBe(true);
    const meta = new SyncMetadata(
      present(link.trashUrl),
      present(f.pod.documents.get(present(link.trashUrl))).dataset,
      DataFactory,
    );
    expect(meta.revisionOf).toBe(f.pod.writer.resolve(ITEM));
    expect(meta.expires?.getTime()).toBe(now.getTime() + 30 * 86_400_000);
    await f.run();
    expect(f.pod.name(ITEM)).toBeUndefined();
  });
  it("resumes a trash move interrupted after its durable link intent", async () => {
    const f = fixture();
    Object.assign(f.adapter, { fieldsForHash: [...f.adapter.fieldsForHash, `${SCHEMA}expires`] });
    f.platform.set("keep me");
    await f.run();
    f.platform.remove();
    const remove = present(f.pod.writer.remove);
    f.pod.writer.remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("interrupted delete"))
      .mockImplementation(remove);
    await expect(f.run()).rejects.toThrow("interrupted delete");
    const link = present((await readLinks(f)).all()[0]);
    expect(link.status).toBe("remote-deleted");
    expect(link.pendingDelete).toBe(true);
    expect(f.pod.name(ITEM)).toBe("keep me");
    expect(f.pod.documents.has(present(link.trashUrl))).toBe(true);
    await f.run();
    expect(f.pod.name(ITEM)).toBeUndefined();
    expect((await readLinks(f)).all()[0]?.status).toBe("trashed");
    expect((await readLinks(f)).all()[0]?.pendingDelete).toBe(false);
  });
  it("does not delete a racing pod edit under the trash copy's older validator", async () => {
    const f = fixture();
    f.platform.set("original");
    await f.run();
    f.platform.remove();
    const remove = present(f.pod.writer.remove);
    f.pod.writer.remove = async (value, conditions) => {
      await f.pod.put(ITEM, "racing edit");
      return remove(value, conditions);
    };
    await expect(f.run()).rejects.toMatchObject({ status: 412 });
    expect(f.pod.name(ITEM)).toBe("racing edit");
    f.pod.writer.remove = remove;
    await f.run();
    expect(f.pod.name(ITEM)).toBeUndefined();
    expect([...f.pod.documents.keys()].filter((url) => url.includes("/trash/"))).toHaveLength(2);
  });
  it.each([
    false,
    true,
  ])("only propagates pod deletes with consent and propagateDeletes=%s", async (propagateDeletes) => {
    const f = fixture({ writeBack: true, propagateDeletes });
    f.platform.set("old");
    await f.run();
    await present(f.pod.writer.remove)(ITEM);
    const report = await f.run();
    expect(f.platform.calls.delete).toBe(propagateDeletes ? 1 : 0);
    expect(report.pendingDeletes).toBe(propagateDeletes ? 0 : 1);
    expect(report.state?.sync?.pendingDeletes).toBe(report.pendingDeletes);
  });
  it("a missing listing entry is re-read before any remote deletion", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("old");
    await f.run();
    f.pod.writer.list = async function* () {};
    await f.run();
    expect(f.platform.calls.delete).toBe(0);
  });
  it("never treats a failed/partial scan as a deletion", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("old");
    await f.run();
    f.pod.writer.list = async function* () {
      yield { url: f.pod.writer.resolve(ITEM) };
      throw new Error("incomplete");
    };
    await expect(f.run()).rejects.toThrow("incomplete");
    expect(f.platform.calls.delete).toBe(0);
  });
  it("remote write failures keep the last checkpoint", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    const initial = await f.run();
    await f.pod.put(ITEM, "pod");
    f.adapter.applyRemote = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const onState = vi.fn();
    await expect(f.run({ state: initial.state, onState })).rejects.toThrow("provider unavailable");
    expect(onState.mock.calls[0]?.[0]).toMatchObject({
      lastOutcome: "error",
      cursor: initial.cursor,
      lastSync: initial.state?.lastSync,
    });
  });
  it("a racing remote version is rejected by the provider precondition", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async (op, options) => {
      f.platform.set("racing");
      return apply(op, options);
    };
    await expect(f.run()).rejects.toMatchObject({ status: 412 });
    expect(f.platform.items.get("remote-1")?.name).toBe("racing");
  });
  it("a racing pod edit after outbound remains detectable next run", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    await f.run();
    await f.pod.put(ITEM, "pod");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async (op, options) => {
      const result = await apply(op, options);
      await f.pod.put(ITEM, "racing edit");
      return result;
    };
    await f.run();
    f.adapter.applyRemote = apply;
    await f.run();
    expect(f.platform.items.get("remote-1")?.name).toBe("racing edit");
  });
  it("abort after a committed create leaves its key recoverable and starts no further I/O", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "new");
    const controller = new AbortController();
    f.platform.afterApply = () => controller.abort(new Error("stop now"));
    const write = vi.spyOn(f.pod.writer, "write");
    await expect(f.run({ signal: controller.signal })).rejects.toThrow("stop now");
    const count = write.mock.calls.length;
    expect((await readLinks(f)).all()[0]?.pendingCreate).toBeDefined();
    expect(write.mock.calls.length).toBe(count);
    f.platform.afterApply = undefined;
    await f.run();
    expect(f.platform.calls.create).toBe(1);
  });
  it("budget exhaustion after a create leaves a consistent recoverable link", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "new");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async (op, options) => {
      const result = await apply(op, options);
      for (let i = 0; i < 100; i++) await options.api("https://fixture.test/budget");
      return result;
    };
    await expect(
      f.run({
        sourceAuth: { fetch: async () => new Response(null, { status: 204 }) },
        limits: { maxRequests: 160, maxItems: 100, maxBytes: 1_000_000 },
      }),
    ).rejects.toThrow("budget");
    expect(f.platform.calls.create).toBe(1);
    expect((await readLinks(f)).all()[0]?.pendingCreate).toBeDefined();
    f.adapter.applyRemote = apply;
    await f.run();
    expect(f.platform.calls.create).toBe(1);
  });
  it("uses the existing one-run claim across both import and outbound", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "new");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = async (op, options) => {
      await expect(
        runImport({
          adapter: { ...f.adapter, import: async () => ({}) },
          mode: "live",
          podWriter: f.pod.writer,
          sourceAuth: f.ports.sourceAuth,
        }),
      ).rejects.toThrow("already running");
      return apply(op, options);
    };
    await f.run();
  });
  it("hashes the final vocabulary mapping and does not remap snapshots", async () => {
    const f = fixture({ writeBack: true });
    Object.assign(f.adapter, {
      fieldsForHash: [...f.adapter.fieldsForHash, `${NS.RDF}type`],
      vocabMap: (doc: ReturnType<typeof fakeSyncDocument>) => {
        new PodThing(`${f.pod.writer.resolve(doc.slug)}#item`, doc.dataset, DataFactory).types.add(
          `${NS.CORE}MappedItem`,
        );
        return doc;
      },
    });
    f.platform.set("old");
    await f.run();
    const stored = present(await f.pod.writer.read(ITEM));
    new PodThing(f.pod.writer.resolve(ITEM), stored.dataset, DataFactory).identifier =
      "unmapped metadata";
    await f.pod.writer.write({
      ...fakeSyncDocument(f.pod.writer.resolve(ITEM), "old"),
      dataset: stored.dataset,
    });
    await f.run();
    expect(f.platform.calls.apply).toBe(0);
  });
  it("normalizes legacy suite terms before hashing and outbound typed access", async () => {
    const f = fixture({ writeBack: true });
    Object.assign(f.adapter, {
      fieldsForHash: [...f.adapter.fieldsForHash, `${NS.RDF}type`],
      vocabMap: (doc: ReturnType<typeof fakeSyncDocument>) => {
        new PodThing(`${f.pod.writer.resolve(doc.slug)}#item`, doc.dataset, DataFactory).types.add(
          `${NS.CORE}Person`,
        );
        return doc;
      },
    });
    f.platform.set("old");
    await f.run();
    const stored = present(await f.pod.writer.read(ITEM));
    const item = new PodThing(`${f.pod.writer.resolve(ITEM)}#item`, stored.dataset, DataFactory);
    item.types.delete(`${NS.CORE}Person`);
    const legacy = present(
      Object.entries(LEGACY_NAMESPACES).find(([, value]) => value === NS.CORE)?.[0],
    );
    item.types.add(`${legacy}Person`);
    await f.pod.writer.write({
      ...fakeSyncDocument(f.pod.writer.resolve(ITEM), "old"),
      dataset: stored.dataset,
    });
    await f.run();
    expect(f.platform.calls.apply).toBe(0);
  });
  it("metadata-only edits update the link ETag without a remote write", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    await f.run();
    const stored = await f.pod.writer.read(ITEM);
    const dataset = copyDataset(stored?.dataset);
    new PodThing(f.pod.writer.resolve(ITEM), dataset, DataFactory).identifier = "unmapped";
    await f.pod.writer.write({ ...fakeSyncDocument(f.pod.writer.resolve(ITEM), "old"), dataset });
    await f.run();
    expect(f.platform.calls.apply).toBe(0);
  });
  it("revalidates a notified item even when its listing ETag is stale", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    await f.run();
    const previous = present(await f.pod.writer.read(ITEM));
    await f.pod.put(ITEM, "notified edit");
    f.pod.writer.list = async function* () {
      yield { url: f.pod.writer.resolve(ITEM), etag: previous.etag };
    };
    await f.run({
      notifications: {
        async *changes() {
          yield f.pod.writer.resolve(ITEM);
        },
      },
    });
    expect(f.platform.items.get("remote-1")?.name).toBe("notified edit");
    expect(f.platform.calls.update).toBe(1);
  });
  it("renews owner protection before reading a create payload on retry", async () => {
    const f = fixture({ writeBack: true });
    await f.pod.put("account/items/new.ttl", "original");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = vi.fn().mockRejectedValue(new Error("transport down"));
    await expect(f.run()).rejects.toThrow("transport down");
    const intent = present((await readLinks(f)).all()[0]?.pendingCreate);
    f.pod.protectedUrls.clear();
    const read = f.pod.writer.read;
    f.pod.writer.read = async (value) => {
      if (f.pod.writer.resolve(value) === intent.resourceUrl)
        expect(f.pod.protectedUrls.has(intent.resourceUrl)).toBe(true);
      return read(value);
    };
    f.adapter.applyRemote = apply;
    await f.run();
    expect(f.platform.calls.create).toBe(1);
  });
  it("charges companion binary bytes and refuses binary writes over mapped items", async () => {
    const f = fixture();
    const writeBinary = vi.fn().mockResolvedValue({ url: "https://fixture.test/", created: true });
    f.pod.writer.writeBinary = writeBinary;
    f.adapter.import = async (ctx) => {
      await ctx.writeBinary({
        slug: "account/original.bin",
        contentType: "application/octet-stream",
        body: new Uint8Array(8),
      });
      return {};
    };
    await expect(
      f.run({ limits: { maxRequests: 1000, maxItems: 100, maxBytes: 7 } }),
    ).rejects.toThrow("budget");
    expect(writeBinary).not.toHaveBeenCalled();
    f.adapter.import = async (ctx) => {
      await ctx.writeBinary({
        slug: ITEM,
        contentType: "application/octet-stream",
        body: new Uint8Array(),
      });
      return {};
    };
    await expect(f.run()).rejects.toThrow("Mapped resources");
    expect(writeBinary).not.toHaveBeenCalled();
  });
  it("rejects a missing account key before acquiring a run or starting I/O", async () => {
    const f = fixture();
    const read = vi.spyOn(f.pod.writer, "read");
    await expect(f.run({}, { account: undefined })).rejects.toThrow("account key");
    expect(read).not.toHaveBeenCalled();
    await f.run();
  });
});

describe("canonical mapped RDF hashes", () => {
  const fields = [`${SCHEMA}name`, `${SCHEMA}description`];
  it("is independent of triple order, syntax, and blank node labels", async () => {
    const a = new Store(
      new Parser().parse(
        `@prefix s: <${SCHEMA}>. <https://item.test/> s:name _:a. _:a s:description "hello"@en; s:name "linked".`,
      ),
    );
    const b = new Store(
      new Parser({ format: "N-Triples" }).parse(
        `<https://item.test/> <${SCHEMA}name> _:other .\n_:other <${SCHEMA}name> "linked" .\n_:other <${SCHEMA}description> "hello"@en .`,
      ),
    );
    expect(await canonicalHash(a, fields)).toBe(await canonicalHash(b, fields));
    const writer = new Writer({ format: "N-Quads" });
    for (const q of [...a].reverse()) writer.addQuad(q);
    const serialized = await new Promise<string>((resolve, reject) =>
      writer.end((e, text) => (e ? reject(e) : resolve(text))),
    );
    expect(
      await canonicalHash(new Store(new Parser({ format: "N-Quads" }).parse(serialized)), fields),
    ).toBe(await canonicalHash(a, fields));
  });
  it("distinguishes language, datatype, mapped changes and blank graph structure", async () => {
    const parse = (body: string) =>
      new Store(new Parser().parse(`@prefix s: <${SCHEMA}>. ${body}`));
    const a = parse('<https://item.test/> s:name "hello"@en.');
    const b = parse('<https://item.test/> s:name "hello"@fr.');
    expect(await canonicalHash(a, fields)).not.toBe(await canonicalHash(b, fields));
    const c = parse('<https://item.test/> s:name _:a, _:b. _:a s:name "a". _:b s:name "b".');
    const d = parse('<https://item.test/> s:name _:b, _:a. _:a s:name "b". _:b s:name "a".');
    expect(await canonicalHash(c, fields)).toBe(await canonicalHash(d, fields));
  });
  it("rejects hostile sizes and graph complexity and invalid declarations", async () => {
    const dataset = copyDataset();
    const item = new PodThing("https://item.test/", dataset, DataFactory);
    item.name = "x".repeat(65_537);
    await expect(canonicalHash(dataset, fields)).rejects.toThrow("cap");
    const many = new Store(
      new Parser().parse(
        `@prefix s: <${SCHEMA}>. <https://item.test/> s:name ${Array.from({ length: 8 }, (_, i) => `_:b${i}`).join(", ")}.`,
      ),
    );
    await expect(canonicalHash(many, fields)).rejects.toThrow("blank-node cap");
    const costly = new Store(
      new Parser().parse(
        `@prefix s: <${SCHEMA}>. <https://item.test/> s:name ${Array.from({ length: 7 }, (_, i) => `_:b${i}`).join(", ")}.`,
      ),
    );
    new PodThing("https://item.test/", costly, DataFactory).description = "\n".repeat(65_536);
    await expect(canonicalHash(costly, fields)).rejects.toThrow("byte-work cap");
    await expect(canonicalHash(copyDataset(), [])).rejects.toThrow("Declare");
  });
  it("rejects nested RDF terms even outside the mapped projection", async () => {
    const dataset = new Store(
      new Parser().parse(
        '<https://item.test/> <urn:unmapped> <<(<urn:subject> <urn:predicate> "hidden")>> .',
      ),
    );
    expect([...dataset][0]?.object.termType).toBe("Quad");
    await expect(canonicalHash(dataset, fields)).rejects.toThrow("Unsupported sync RDF term");
  });
});

describe("conflict clock policy", () => {
  it("uses server times outside the skew window, otherwise manual", () => {
    expect(resolveConflict("lww", "2026-01-01T00:03:00Z", "2026-01-01T00:00:00Z")).toBe("remote");
    expect(resolveConflict("lww", "2026-01-01T00:00:00Z", "2026-01-01T00:03:00Z")).toBe("pod");
    expect(resolveConflict("lww", "2026-01-01T00:00:00Z", "2026-01-01T00:02:00Z")).toBe("manual");
    expect(resolveConflict("lww", "invalid", "2026-01-01")).toBe("manual");
    expect(() => resolveConflict("manual", undefined, undefined, -1)).toThrow("skew");
    expect(() => resolveConflict("unknown" as ConflictPolicy)).toThrow("policy");
  });
});

describe("bounded owner-only link shards", () => {
  const link = (url: string, remoteId = "remote"): SyncLink => ({
    podUrl: url,
    remoteId,
    remoteVersion: "version",
    podEtag: '"v1"',
    lastSyncedHash: "hash",
  });
  it("looks up both identities and preserves unrelated changes after a 412", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const url = f.pod.writer.resolve(ITEM);
    const first = link(url);
    await store.put(first);
    const write = f.pod.writer.write;
    let retry = true;
    f.pod.writer.write = async (doc, conditions) => {
      if (retry) {
        retry = false;
        await write(doc, conditions);
        throw new ResourceWriteError(f.pod.writer.resolve(doc.slug), 412);
      }
      return write(doc, conditions);
    };
    // A matching retry must not silently replace a concurrently changed SAME record.
    await expect(store.put({ ...first, remoteVersion: "new" })).rejects.toThrow("concurrently");
    const fresh = await readLinks(f);
    expect(fresh.byRemoteId("remote")?.remoteVersion).toBe("new");
    expect(fresh.byPodUrl(url)).toBeDefined();
  });
  it("retries an unchanged shard after 412 and preserves another record", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const first = link(f.pod.writer.resolve(ITEM));
    await store.put(first);
    const write = f.pod.writer.write;
    let retry = true;
    f.pod.writer.write = async (doc, conditions) => {
      if (retry) {
        retry = false;
        throw new ResourceWriteError(f.pod.writer.resolve(doc.slug), 412);
      }
      return write(doc, conditions);
    };
    await store.put({ ...first, remoteVersion: "new" });
    expect(store.byRemoteId("remote")?.remoteVersion).toBe("new");
  });
  it("merges an unrelated concurrent record in the same shard after a real 412", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const first = link(f.pod.writer.resolve(ITEM));
    await store.put(first);
    const shard = Number.parseInt(fnv1a(first.podUrl), 16) % 64;
    let otherUrl = "";
    for (let i = 0; i < 1000; i++) {
      const candidate = f.pod.writer.resolve(`account/items/other-${i}.ttl`);
      if (Number.parseInt(fnv1a(candidate), 16) % 64 === shard) {
        otherUrl = candidate;
        break;
      }
    }
    expect(otherUrl).toBeTruthy();
    const write = f.pod.writer.write;
    let raced = false;
    f.pod.writer.write = async (doc, conditions) => {
      if (!raced) {
        raced = true;
        const concurrent = await readLinks(f);
        await concurrent.put(link(otherUrl, "other-remote"));
      }
      return write(doc, conditions);
    };
    await store.put({ ...first, remoteVersion: "new-version" });
    expect(store.byRemoteId("other-remote")?.podUrl).toBe(otherUrl);
    expect((await readLinks(f)).all()).toHaveLength(2);
  });
  it("rejects a duplicate identity introduced by a shard race before persisting it", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const first = link(f.pod.writer.resolve(ITEM));
    const shard = Number.parseInt(fnv1a(first.podUrl), 16) % 64;
    let otherUrl = "";
    for (let i = 0; i < 1000; i++) {
      const candidate = f.pod.writer.resolve(`account/items/race-${i}.ttl`);
      if (Number.parseInt(fnv1a(candidate), 16) % 64 === shard) {
        otherUrl = candidate;
        break;
      }
    }
    expect(otherUrl).toBeTruthy();
    const write = f.pod.writer.write;
    let raced = false;
    f.pod.writer.write = async (doc, conditions) => {
      if (!raced) {
        raced = true;
        const concurrent = await readLinks(f);
        await concurrent.put(link(otherUrl));
      }
      return write(doc, conditions);
    };
    await expect(store.put(first)).rejects.toThrow("Duplicate");
    const fresh = await readLinks(f);
    expect(fresh.all()).toHaveLength(1);
    expect(fresh.byRemoteId("remote")?.podUrl).toBe(otherUrl);
  });
  it("enforces the bounded per-shard record ceiling", async () => {
    const f = fixture();
    const urls: string[] = [];
    for (let i = 0; urls.length <= MAX_LINKS_PER_SHARD; i++) {
      const url = f.pod.writer.resolve(`account/items/cap-${i}.ttl`);
      if (Number.parseInt(fnv1a(url), 16) % 64 === 0) urls.push(url);
    }
    const shardSlug = "account/links/00.ttl";
    const dataset = copyDataset();
    for (const [i, url] of urls.slice(0, MAX_LINKS_PER_SHARD).entries()) {
      const record = new LinkRecord(
        `${f.pod.writer.resolve(shardSlug)}#${await sha256(url)}`,
        dataset,
        DataFactory,
      );
      record.types.add(SYNC.Link);
      record.record = link(url, `r-${i}`);
    }
    await f.pod.writer.write({ slug: shardSlug, dataset, category: "links", forClass: SYNC.Link });
    const store = await readLinks(f);
    await expect(store.put(link(present(urls[MAX_LINKS_PER_SHARD]), "overflow"))).rejects.toThrow(
      "full",
    );
    expect((await readLinks(f)).all()).toHaveLength(MAX_LINKS_PER_SHARD);
  });
  it("fails closed when owner protection fails, before reading link bodies", async () => {
    const f = fixture();
    f.pod.writer.ensureOwnerOnly = vi.fn().mockRejectedValue(new Error("no owner control"));
    const read = vi.spyOn(f.pod.writer, "read");
    await expect(readLinks(f)).rejects.toThrow("owner control");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects weak validators, duplicate remote identities and path escapes", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const first = link(f.pod.writer.resolve(ITEM));
    await store.put(first);
    await expect(store.put({ ...first, podEtag: 'W/"weak"' })).rejects.toThrow("strong");
    await expect(
      store.put({ ...first, podUrl: f.pod.writer.resolve("account/items/second.ttl") }),
    ).rejects.toThrow("Duplicate");
    await expect(store.put({ ...first, podUrl: "https://evil.test/item" })).rejects.toThrow(
      "escapes",
    );
    expect(MAX_LINKS_PER_SHARD).toBe(128);
  });
});

describe("listing and notification bounds", () => {
  it("accepts bounded hints but always does the complete scan", async () => {
    const f = fixture();
    await f.pod.put(ITEM, "pod");
    const list = vi.spyOn(f.pod.writer, "list");
    const entries = await scanWriteBack(f.pod.writer, ["account/items/"], 10, undefined, {
      async *changes() {
        yield f.pod.writer.resolve(ITEM);
      },
    });
    expect(entries.size).toBe(1);
    expect(list).toHaveBeenCalledOnce();
  });
  it("caps listings and rejects hints or entries outside the declared containers", async () => {
    const f = fixture();
    await f.pod.put(ITEM, "1");
    await f.pod.put("account/items/other.ttl", "2");
    await expect(scanWriteBack(f.pod.writer, ["account/items/"], 1)).rejects.toThrow("excessive");
    await expect(
      scanWriteBack(f.pod.writer, ["account/items/"], 10, undefined, {
        async *changes() {
          yield "https://evil.test/item";
        },
      }),
    ).rejects.toThrow("notifications");
  });
});
