// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { DataFactory } from "n3";
import { createLinkStore } from "./link-store.js";
import { runTwoWaySync, type TwoWaySyncReport } from "./runner.js";
import type {
  ConflictPolicy,
  SyncConnection,
  SyncImportContext,
  SyncLink,
  SyncPorts,
  TwoWayAdapter,
} from "./types.js";
import { SyncMetadata } from "./vocab.js";

/** A recorded/synthetic provider fixture implements these controls, without live API calls. */
export interface TwoWayConformanceFixture<Op> {
  readonly adapter: TwoWayAdapter<Op>;
  readonly connection: SyncConnection;
  readonly ports: SyncPorts;
  seedRemote(name: string, modifiedAt?: string): void | Promise<void>;
  /**
   * Seed the remote item AND the pod copy an earlier one-way import of this connector wrote:
   * at the framework-owned slug, with the connector's import provenance and no sync link.
   */
  seedOneWayImport(name: string): Promise<void>;
  editPod(name: string, modifiedAt?: string): Promise<void>;
  deletePod(): Promise<void>;
  deleteAtPlatform(): void | Promise<void>;
  podName(): string | undefined | Promise<string | undefined>;
  remoteName(): string | undefined | Promise<string | undefined>;
  remoteCount(): number | Promise<number>;
  remoteWrites(): number;
  /** Arrange one transport failure AFTER committing a create at the provider. */
  crashAfterCreate(): void;
}

/** Same adapter, one method overridden; prototype delegation keeps `this`-bound methods. */
function override<Op>(
  adapter: TwoWayAdapter<Op>,
  methods: Partial<Pick<TwoWayAdapter<Op>, "import" | "findByIdempotencyKey">>,
): TwoWayAdapter<Op> {
  return Object.assign(Object.create(adapter) as TwoWayAdapter<Op>, methods);
}

/**
 * Await inside the adapter's own test. Each scenario gets fresh fixtures. Throws on contract
 * violations; no Vitest dependency is loaded by ./testing, so Node fixture hosts work too.
 * Provider lanes additionally run their own timestamp, tombstone and pagination fixtures.
 */
export async function twoWayConformanceSuite<Op>(
  makeAdapter: () => TwoWayConformanceFixture<Op> | Promise<TwoWayConformanceFixture<Op>>,
): Promise<void> {
  const assert = (value: boolean, message: string) => {
    if (!value) throw new Error(`Two-way conformance: ${message}`);
  };
  const linksOf = async (f: TwoWayConformanceFixture<Op>): Promise<readonly SyncLink[]> => {
    const store = createLinkStore(f.ports.podWriter, f.connection.account);
    await store.load();
    return store.all();
  };
  const rejects = async (call: () => Promise<unknown>) => {
    try {
      await call();
      return false;
    } catch {
      return true;
    }
  };
  /** A crash is either a failed run or an isolated item failure recorded in the report. */
  const failedRun = async (run: () => Promise<TwoWaySyncReport>) => {
    try {
      return (await run()).failed > 0;
    } catch {
      return true;
    }
  };
  {
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    assert((await f.podName()) === "initial", "inbound mapping");
    await f.editPod("edited");
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert((await f.remoteName()) === "edited", "outbound mapping");
    const writes = f.remoteWrites();
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert(f.remoteWrites() === writes, "echo suppression");
  }
  {
    const f = await makeAdapter();
    await f.editPod("new item");
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: false }, f.ports);
    assert(f.remoteWrites() === 0, "write-back defaults off");
    f.crashAfterCreate();
    assert(
      await failedRun(() =>
        runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports),
      ),
      "post-create crash fixture must fail",
    );
    assert((await f.remoteCount()) === 1, "crash fixture must commit the create before failing");
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert((await f.remoteCount()) === 1, "create retry must not duplicate");
    assert((await f.podName()) === "new item", "recovered inbound keeps original pod URL");
  }
  {
    // A retried create whose key lookup misses: applyRemote deduplicates the key, or the
    // provider declares it cannot and the framework defers instead of re-sending.
    const f = await makeAdapter();
    await f.editPod("new item");
    f.crashAfterCreate();
    await failedRun(() => runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports));
    assert((await f.remoteCount()) === 1, "crash fixture must commit the create before failing");
    // No inbound delivery this run either, so only the outbound retry can settle the intent.
    const missing = override(f.adapter, {
      findByIdempotencyKey: async () => undefined,
      import: async () => ({}),
    });
    const report = await runTwoWaySync(missing, { ...f.connection, writeBack: true }, f.ports);
    assert(
      (await f.remoteCount()) === 1,
      "create retry with a lagging key lookup must not duplicate",
    );
    if (f.adapter.deduplicatesCreateKeys === false)
      assert(report.deferred > 0, "a provider without key deduplication defers the retry");
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert(
      (await f.remoteCount()) === 1,
      "recovery after the lookup catches up must not duplicate",
    );
    assert((await f.podName()) === "new item", "lagging lookup keeps one pod resource");
  }
  {
    // Stale conditional versions are refused for update and delete; the provider is untouched.
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    const [link] = await linksOf(f);
    assert(!!link?.remoteId && !!link.remoteVersion, "inbound records the remote version");
    if (link?.remoteId && link.remoteVersion) {
      await f.seedRemote("remote edit");
      const stored = await f.ports.podWriter.read(link.podUrl);
      assert(!!stored?.etag, "linked pod resource is readable");
      const options = { ifMatch: link.remoteVersion, api: f.ports.sourceAuth.fetch };
      if (stored?.etag) {
        const op = await f.adapter.toRemote({
          url: link.podUrl,
          dataset: stored.dataset,
          etag: stored.etag,
          remoteId: link.remoteId,
        });
        assert(
          await rejects(() => f.adapter.applyRemote(op, options)),
          "stale ifMatch update rejected",
        );
      }
      assert(
        (await f.remoteName()) === "remote edit",
        "stale update leaves the provider unchanged",
      );
      const remoteId = link.remoteId;
      assert(
        await rejects(() => f.adapter.deleteRemote(remoteId, options)),
        "stale ifMatch delete rejected",
      );
      assert((await f.remoteCount()) === 1, "stale delete leaves the provider item");
    }
  }
  for (const policy of ["manual", "remote-wins", "pod-wins", "lww"] as ConflictPolicy[]) {
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    await f.editPod("pod edit", "2026-02-01T00:00:00Z");
    await f.seedRemote("remote edit", "2026-03-01T00:00:00Z");
    const report = await runTwoWaySync(
      f.adapter,
      { ...f.connection, writeBack: true, conflictPolicy: policy },
      f.ports,
    );
    assert(
      report.conflicts === 1 && !!report.issues[0]?.conflict?.snapshotUrl,
      `${policy} retains a conflict snapshot`,
    );
    assert(
      (await f.podName()) ===
        (policy === "manual" || policy === "pod-wins" ? "pod edit" : "remote edit"),
      `${policy} winner`,
    );
    if (policy === "manual") assert(f.remoteWrites() === 0, "manual conflict blocks write-back");
  }
  {
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    await f.editPod("pod edit", "2026-02-01T00:00:00Z");
    await f.seedRemote("remote edit", "2026-02-01T00:01:00Z");
    const report = await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert(report.issues[0]?.conflict?.resolution === "manual", "two-minute skew guard");
  }
  for (const propagateDeletes of [false, true]) {
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    await f.deletePod();
    const report = await runTwoWaySync(
      f.adapter,
      { ...f.connection, writeBack: true, propagateDeletes },
      f.ports,
    );
    assert(report.pendingDeletes === (propagateDeletes ? 0 : 1), "pod delete opt-in health");
    assert((await f.remoteCount()) === (propagateDeletes ? 0 : 1), "pod delete propagation");
  }
  {
    const f = await makeAdapter();
    await f.seedRemote("initial");
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    await f.deleteAtPlatform();
    await runTwoWaySync(f.adapter, f.connection, f.ports);
    assert((await f.podName()) === undefined, "remote delete removes the live pod resource");
    const [link] = await linksOf(f);
    assert(link?.status === "trashed" && !!link.deletedAt, "remote delete leaves a tombstone");
    const trash = link?.trashUrl ? await f.ports.podWriter.read(link.trashUrl) : undefined;
    const meta =
      trash && link?.trashUrl
        ? new SyncMetadata(link.trashUrl, trash.dataset, DataFactory)
        : undefined;
    assert(
      !!meta?.expires && meta.revisionOf === link?.podUrl,
      "remote delete keeps an expiring trash snapshot of the item",
    );
  }
  {
    // Migration: write-back enabled after a one-way import links the imported items by
    // remote id on a full inbound pass (no delta cursor) and never duplicates them.
    const f = await makeAdapter();
    await f.seedOneWayImport("imported");
    const cursors: (string | undefined)[] = [];
    const recording = override(f.adapter, {
      import: (ctx: SyncImportContext) => {
        cursors.push(ctx.cursor);
        return f.adapter.import(ctx);
      },
    });
    const ports = { ...f.ports, cursor: "one-way-import-cursor" };
    const first = await runTwoWaySync(recording, { ...f.connection, writeBack: true }, ports);
    assert(cursors[0] === undefined, "the first two-way run ignores the one-way delta cursor");
    assert(first.unlinkedImports === 0, "imported items are linked by remote id");
    assert((await f.remoteCount()) === 1 && f.remoteWrites() === 0, "adoption never duplicates");
    assert((await f.podName()) === "imported", "adoption keeps the imported pod resource");
    await runTwoWaySync(recording, { ...f.connection, writeBack: true }, ports);
    assert(cursors[1] !== undefined, "later runs resume the delta cursor");
    assert(f.remoteWrites() === 0, "adopted items stay echo-suppressed");
  }
  {
    // An imported item whose provider item is gone is reported, never created remotely.
    const f = await makeAdapter();
    await f.seedOneWayImport("orphan");
    await f.deleteAtPlatform();
    const report = await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert(report.unlinkedImports === 1, "unlinked import reported in health");
    assert(f.remoteWrites() === 0, "unlinked import never created at the provider");
  }
}
