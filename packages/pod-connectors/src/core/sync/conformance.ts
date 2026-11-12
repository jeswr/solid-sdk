// AUTHORED-BY Codex GPT-6.1-Sol
import { runTwoWaySync } from "./runner.js";
import type { ConflictPolicy, SyncConnection, SyncPorts, TwoWayAdapter } from "./types.js";

/** A recorded/synthetic provider fixture implements these controls, without live API calls. */
export interface TwoWayConformanceFixture<Op> {
  readonly adapter: TwoWayAdapter<Op>;
  readonly connection: SyncConnection;
  readonly ports: SyncPorts;
  seedRemote(name: string, modifiedAt?: string): void | Promise<void>;
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
    let failed = false;
    try {
      await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    } catch {
      failed = true;
    }
    assert(failed, "post-create crash fixture must fail");
    assert((await f.remoteCount()) === 1, "crash fixture must commit the create before failing");
    await runTwoWaySync(f.adapter, { ...f.connection, writeBack: true }, f.ports);
    assert((await f.remoteCount()) === 1, "create retry must not duplicate");
    assert((await f.podName()) === "new item", "recovered inbound keeps original pod URL");
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
  }
}
