// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../../pod/resource.js";
import { runImport } from "../import-runner.js";
import { copyDataset } from "../incremental.js";
import { PodThing, SCHEMA } from "../vocab.js";
import { resolveConflict } from "./conflict.js";
import { twoWayConformanceSuite } from "./conformance.js";
import { scanWriteBack } from "./detection.js";
import {
  createFakeTwoWayAdapter,
  createMemorySyncPod,
  type FakeTwoWayOptions,
  fakeOneWayImport,
  fakeSyncDocument,
} from "./fake-platform.js";
import { canonicalHash, syncItemSlug } from "./hash.js";
import { createLinkStore, MAX_LINKS_PER_SHARD, MAX_SYNC_LINKS } from "./link-store.js";
import { runTwoWaySync, type TwoWaySyncReport } from "./runner.js";
import type {
  ConflictPolicy,
  SyncConnection,
  SyncLink,
  SyncPorts,
  SyncSkipReason,
} from "./types.js";
import { SyncMetadata } from "./vocab.js";

function present<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing expected fixture value.");
  return value;
}
/** Framework-owned slug of the fake platform's default remote item. */
const ITEM = await syncItemSlug("account/items", "remote-1");
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
/** The run continued past the item and recorded exactly this fixed failure class for it. */
function expectSkipped(report: TwoWaySyncReport, reason: SyncSkipReason, direction = "outbound") {
  expect(report.failed).toBeGreaterThan(0);
  expect(report.skippedItems).toContainEqual(expect.objectContaining({ reason, direction }));
  expect(report.state?.sync?.failed).toBe(report.failed);
  // Fixed classes only: no provider text, tokens or stack traces reach health.
  expect(JSON.stringify(report.skippedItems)).not.toMatch(/crash|transport|unavailable|Error/);
}
async function readLinks(f: ReturnType<typeof fixture>) {
  const links = createLinkStore(f.pod.writer, "account");
  await links.load();
  return links;
}

type FakeFixture = ReturnType<typeof createFakeTwoWayAdapter>;
function conformanceFixture(
  options: FakeTwoWayOptions = {},
  wrap: (
    adapter: FakeFixture["adapter"],
    platform: FakeFixture["platform"],
  ) => FakeFixture["adapter"] = (adapter) => adapter,
) {
  const f = fixture({}, options);
  let local = ITEM;
  return {
    adapter: wrap(f.adapter, f.platform),
    connection: { account: "account" },
    ports: f.ports,
    seedRemote: (name: string, modifiedAt?: string) => {
      f.platform.set(name, "remote-1", modifiedAt);
    },
    seedOneWayImport: async (name: string) => {
      f.platform.set(name, "remote-1");
      await fakeOneWayImport(f.pod.writer, f.adapter.metadata.id, f.pod.writer.resolve(ITEM), name);
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
}

describe("two-way reference conformance", () => {
  it("runs the public provider conformance suite over the fake platform", async () => {
    await twoWayConformanceSuite(() => conformanceFixture());
  });
  it("runs the suite over a delta-only inbound adapter", async () => {
    await twoWayConformanceSuite(() => conformanceFixture({ delta: true }));
  });
  it("runs the suite over a provider that cannot deduplicate create keys", async () => {
    await twoWayConformanceSuite(() => conformanceFixture({ deduplicatesCreateKeys: false }));
  });
  it("fails an adapter that ignores ifMatch on update and delete", async () => {
    await expect(
      twoWayConformanceSuite(() =>
        conformanceFixture({}, (adapter, platform) => {
          const apply = adapter.applyRemote;
          return {
            ...adapter,
            // Overwrites whatever the provider holds: the precondition is ignored.
            applyRemote: (op, options) =>
              apply(op, {
                ...options,
                ifMatch: op.remoteId ? platform.items.get(op.remoteId)?.version : undefined,
              }),
            deleteRemote: async (remoteId) => {
              if (platform.items.has(remoteId) && !platform.items.get(remoteId)?.deleted)
                platform.remove(remoteId);
            },
          };
        }),
      ),
    ).rejects.toThrow("stale ifMatch update rejected");
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
    expectSkipped(await f.run(), "remote-failed");
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
    expectSkipped(await f.run(), "remote-failed");
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
    expectSkipped(await f.run(), "remote-failed");
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
    expectSkipped(await f.run(), "remote-failed");
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
    expectSkipped(await f.run(), "write-failed", "inbound");
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
    expectSkipped(await f.run(), "write-failed", "inbound");
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
  it("isolates a remote write failure and retries the item on the next run", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    const initial = await f.run();
    await f.pod.put(ITEM, "pod");
    const apply = f.adapter.applyRemote;
    f.adapter.applyRemote = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const onState = vi.fn();
    // Outbound is rescanned every run, so the inbound checkpoint may advance.
    const report = await f.run({ state: initial.state, onState });
    expectSkipped(report, "remote-failed");
    expect(onState.mock.calls[0]?.[0]).toMatchObject({ lastOutcome: "success" });
    f.adapter.applyRemote = apply;
    const retry = await f.run();
    expect(retry.failed).toBe(0);
    expect(f.platform.items.get("remote-1")?.name).toBe("pod");
  });
  it("run-level failures keep the last checkpoint", async () => {
    const f = fixture({ writeBack: true });
    f.platform.set("old");
    const initial = await f.run();
    f.adapter.import = async () => {
      throw new Error("provider listing unavailable");
    };
    const onState = vi.fn();
    await expect(f.run({ state: initial.state, onState })).rejects.toThrow("listing unavailable");
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
    expectSkipped(await f.run(), "remote-failed");
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
    expectSkipped(await f.run(), "remote-failed");
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
  async function sameShardUrl(
    store: Awaited<ReturnType<typeof readLinks>>,
    url: string,
    tag: string,
  ) {
    const shard = await store.shardOf(url);
    for (let i = 0; i < 5000; i++) {
      const candidate = url.replace(/[^/]+$/, `${tag}-${i}.ttl`);
      if ((await store.shardOf(candidate)) === shard) return candidate;
    }
    throw new Error("No same-shard fixture URL.");
  }
  it("merges an unrelated concurrent record in the same shard after a real 412", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const first = link(f.pod.writer.resolve(ITEM));
    await store.put(first);
    const otherUrl = await sameShardUrl(store, first.podUrl, "other");
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
    const otherUrl = await sameShardUrl(store, first.podUrl, "race");
    const write = f.pod.writer.write;
    let raced = false;
    f.pod.writer.write = async (doc, conditions) => {
      if (!raced && doc.slug.includes("/links/") && !doc.slug.endsWith("manifest.ttl")) {
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
  it("salts shard placement per connection so ids cannot be ground into one shard", async () => {
    const fa = fixture();
    const a = await readLinks(fa);
    const b = await readLinks(fixture());
    const urls = Array.from({ length: 32 }, (_, i) => `https://x.test/${i}`);
    const shardsA = await Promise.all(urls.map((url) => a.shardOf(url)));
    const shardsB = await Promise.all(urls.map((url) => b.shardOf(url)));
    expect(shardsA).not.toEqual(shardsB);
    // The salt lives only in the owner-only manifest and survives reloads.
    const manifestUrl = fa.pod.writer.resolve("account/links/manifest.ttl");
    expect(fa.pod.protectedUrls.has(manifestUrl)).toBe(true);
    const again = await readLinks(fa);
    expect(await Promise.all(urls.map((url) => again.shardOf(url)))).toEqual(shardsA);
  });
  it("spills a full shard into overflow documents instead of refusing links", async () => {
    const f = fixture();
    const store = await readLinks(f);
    const base = f.pod.writer.resolve("account/items/cap-0.ttl");
    const shard = await store.shardOf(base);
    const urls: string[] = [];
    for (let i = 0; urls.length <= MAX_LINKS_PER_SHARD; i++) {
      const url = f.pod.writer.resolve(`account/items/cap-${i}.ttl`);
      if ((await store.shardOf(url)) === shard) urls.push(url);
    }
    for (const [i, url] of urls.entries()) await store.put(link(url, `r-${i}`));
    const overflowUrl = present(urls[MAX_LINKS_PER_SHARD]);
    expect(store.documentOf(overflowUrl)).toMatch(/-1\.ttl$/);
    const fresh = await readLinks(f);
    expect(fresh.all()).toHaveLength(MAX_LINKS_PER_SHARD + 1);
    expect(fresh.byRemoteId(`r-${MAX_LINKS_PER_SHARD}`)?.podUrl).toBe(overflowUrl);
    // The overflow record stays updatable in place.
    await fresh.put({ ...link(overflowUrl, `r-${MAX_LINKS_PER_SHARD}`), remoteVersion: "v2" });
    expect((await readLinks(f)).byPodUrl(overflowUrl)?.remoteVersion).toBe("v2");
    expect(MAX_SYNC_LINKS).toBe(50_000);
  });
  it("skips and reports items beyond the hard link cap without failing the run", async () => {
    const f = fixture();
    f.platform.set("one", "remote-1");
    f.platform.set("two", "remote-2");
    f.platform.set("three", "remote-3");
    const report = await f.run({ maxLinks: 2 });
    expect((await readLinks(f)).all()).toHaveLength(2);
    expect(report.skippedItems.filter((item) => item.reason === "link-cap")).toHaveLength(1);
    expect(report.failed).toBe(1);
    // The skipped item is retried, and still skipped, on later runs.
    const again = await f.run({ maxLinks: 2 });
    expect(again.skippedItems.filter((item) => item.reason === "link-cap")).toHaveLength(1);
  });
  it("garbage-collects trashed and pod-deleted tombstones 30 days after deletion", async () => {
    const f = fixture({ writeBack: true, propagateDeletes: true });
    f.platform.set("trashed", "remote-1");
    f.platform.set("deleted", "remote-2");
    await f.run();
    const deletedAt = new Date("2026-04-01T00:00:00Z");
    f.platform.remove("remote-1");
    await present(f.pod.writer.remove)(await syncItemSlug("account/items", "remote-2"));
    await f.run({ now: () => deletedAt });
    const statuses = (await readLinks(f)).all().map((l) => [l.status, l.deletedAt]);
    expect(statuses).toEqual(
      expect.arrayContaining([
        ["trashed", deletedAt.toISOString()],
        ["pod-deleted", deletedAt.toISOString()],
      ]),
    );
    await f.run({ now: () => new Date(deletedAt.getTime() + 29 * 86_400_000) });
    expect((await readLinks(f)).all()).toHaveLength(2);
    await f.run({ now: () => new Date(deletedAt.getTime() + 30 * 86_400_000) });
    expect((await readLinks(f)).all()).toHaveLength(0);
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
