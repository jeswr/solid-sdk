// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChangeEvent, NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { Awareness } from "y-protocols/awareness";
import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector, mergeUpdates } from "yjs";
import { type LiveOptions, LiveTransport, selectLiveService } from "./live.js";
import { SolidUpdateStore } from "./store.js";

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export interface SolidPersistenceEvents {
  synced: () => void;
  error: (error: Error) => void;
  status: (status: "connecting" | "connected" | "disconnected") => void;
  conflict: (error: StorageError) => void;
}
type Listener = (...args: never[]) => void;

export interface SolidPersistenceOptions {
  doc: Doc;
  store?: SolidUpdateStore;
  container?: string;
  storage?: StorageClient;
  notifications?: NotificationsClient;
  /** Defaults to 300 ms. flush() bypasses the debounce. */
  debounceMs?: number;
  compaction?: { afterUpdates: number; minIntervalMs: number };
}

/** Yjs persistence and notification-driven reconciliation over an immutable storage log. */
export class SolidPersistence {
  readonly doc: Doc;
  readonly store: SolidUpdateStore;
  get mode(): "live" | "log" {
    return this.transport?.connected ? "live" : "log";
  }
  protected transport?: LiveTransport;
  readonly whenSynced: Promise<void>;
  synced = false;
  destroyed = false;
  private active = false;
  private generation = 0;
  private connection?: Promise<void>;
  private subscription?: Subscription;
  private subscriptionAbort?: AbortController;
  private readonly notifications?: NotificationsClient;
  private readonly debounceMs: number;
  private readonly compaction: { afterUpdates: number; minIntervalMs: number };
  private lastCompaction = Number.NEGATIVE_INFINITY;
  private compacting?: Promise<{ url: string } | undefined>;
  private readonly listeners = new Map<keyof SolidPersistenceEvents, Set<Listener>>();
  private readonly knownUrls = new Set<string>();
  private updatesSinceCompaction = 0;
  private readonly pending: Uint8Array[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private reconciliationTimer?: ReturnType<typeof setTimeout>;
  private pollingReconciliationTimer?: ReturnType<typeof setInterval>;
  private writeTail: Promise<void> = Promise.resolve();
  private operationTail: Promise<unknown> = Promise.resolve();
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

  constructor(options: SolidPersistenceOptions) {
    this.doc = options.doc;
    if (!options.store && (!options.container || !options.storage)) {
      throw new Error(
        "[y-solid] SolidPersistence requires either `store`, or `container` and `storage`.",
      );
    }
    this.store =
      options.store ??
      new SolidUpdateStore({
        container: options.container as string,
        storage: options.storage as StorageClient,
      });
    this.notifications = options.notifications;
    this.debounceMs = options.debounceMs ?? 300;
    this.compaction = options.compaction ?? { afterUpdates: 200, minIntervalMs: 60_000 };
    if (
      !Number.isFinite(this.debounceMs) ||
      this.debounceMs < 0 ||
      !Number.isInteger(this.compaction.afterUpdates) ||
      this.compaction.afterUpdates < 1 ||
      !Number.isFinite(this.compaction.minIntervalMs) ||
      this.compaction.minIntervalMs < 0
    ) {
      throw new TypeError("[y-solid] invalid debounce or compaction options");
    }
    this.updateHandler = (update, origin) => {
      if (this.destroyed || origin === this || (this.transport && origin === this.transport))
        return;
      if (this.transport?.sendUpdate(update)) return;
      this.pending.push(update.slice());
      this.scheduleWrite();
    };
    this.doc.on("update", this.updateHandler);
    this.whenSynced = this.connect();
    // Keep the public rejection available without an unhandled background rejection.
    void this.whenSynced.catch(() => {});
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation, operation);
    this.operationTail = next.catch(() => {});
    return next;
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error("[y-solid] provider is destroyed");
    if (this.connection) return this.connection;
    if (this.active && this.synced) return;
    this.active = true;
    const generation = ++this.generation;
    this.emit("status", "connecting");
    const connecting = (async () => {
      try {
        if (this.notifications) {
          const abort = new AbortController();
          this.subscriptionAbort = abort;
          const subscription = await this.notifications.subscribe([this.store.container], {
            depth: "members",
            signal: abort.signal,
          });
          if (!this.current(generation)) {
            await subscription.close();
            return;
          }
          this.subscription = subscription;
          const pending = new Set<ChangeEvent | undefined>();
          let reconciling = false;
          const scheduleReconciliation = (delayMs: number) => {
            if (!this.current(generation)) return;
            this.clearReconciliationTimer();
            this.reconciliationTimer = setTimeout(() => {
              this.reconciliationTimer = undefined;
              reconcile();
            }, delayMs);
          };
          const reconcile = (change?: ChangeEvent) => {
            if (!this.current(generation)) return;
            pending.add(change);
            if (reconciling) return;
            this.clearReconciliationTimer();
            reconciling = true;
            let failed = false;
            void this.serial(async () => {
              for (const hint of pending) {
                if (!this.current(generation)) return;
                pending.delete(hint);
                try {
                  if (hint) await this.ingestChange(hint, generation);
                  else await this.ingest(generation);
                } catch (cause) {
                  // Keep failed hints, including Creates not yet visible in listings.
                  pending.add(hint);
                  throw cause;
                }
              }
            })
              .then(() => {
                if (this.current(generation)) this.autoCompact();
              })
              .catch((cause) => {
                failed = true;
                if (this.current(generation)) this.report(cause);
              })
              .finally(() => {
                reconciling = false;
                if (!this.current(generation)) return;
                if (failed) scheduleReconciliation(1_000);
                else if (pending.size) reconcile();
              });
          };
          subscription.on("change", (change) => {
            // Create hints are read only after checking logical container membership.
            if (this.store.storage.isWithinStorage(change.object)) reconcile(change);
          });
          subscription.on("resync", () => reconcile());
          // Poll subscriptions expose no baseline-completion signal. Periodic
          // authoritative reads cover writes swallowed by a delayed quiet baseline.
          if (subscription.channel === "poll") {
            this.pollingReconciliationTimer = setInterval(() => reconcile(), 30_000);
          }
        }
        await this.serial(() => this.ingest(generation));
        if (!this.current(generation)) return;
        await this.transport?.connect();
        if (!this.current(generation)) return;
        this.synced = true;
        this.emit("synced");
        this.emit("status", "connected");
        this.scheduleWrite();
        this.autoCompact();
      } catch (cause) {
        if (this.current(generation)) {
          this.active = false;
          this.synced = false;
          this.clearReconciliationTimers();
          this.subscriptionAbort?.abort();
          await this.subscription?.close();
          this.subscription = undefined;
          this.report(cause);
          this.emit("status", "disconnected");
        }
        throw cause;
      }
    })();
    this.connection = connecting;
    try {
      await connecting;
    } finally {
      if (this.connection === connecting) this.connection = undefined;
    }
  }

  private current(generation: number): boolean {
    return this.active && !this.destroyed && generation === this.generation;
  }

  private clearReconciliationTimer(): void {
    if (this.reconciliationTimer !== undefined) clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
  }

  private clearReconciliationTimers(): void {
    this.clearReconciliationTimer();
    if (this.pollingReconciliationTimer !== undefined) {
      clearInterval(this.pollingReconciliationTimer);
    }
    this.pollingReconciliationTimer = undefined;
  }

  private async ingest(generation: number): Promise<number> {
    if (!this.current(generation)) return 0;
    const stored = await this.store.loadUpdates(this.knownUrls);
    if (!this.current(generation)) return 0;
    const count = this.applyStored(stored.map((s) => s.update));
    for (const record of stored) this.knownUrls.add(record.url);
    this.updatesSinceCompaction += stored.filter((s) => s.kind === "update").length;
    return count;
  }
  private async ingestChange(change: ChangeEvent, generation: number): Promise<number> {
    if (!this.current(generation)) return 0;
    if (
      change.type !== "Create" ||
      change.objectKind === "container" ||
      change.object === this.store.container
    ) {
      return this.ingest(generation);
    }
    if (this.knownUrls.has(change.object)) return 0;
    // A Create may precede listing visibility. Check its parent before reading,
    // using logical LWS containment rather than constructing a path from a hint.
    try {
      if ((await this.store.storage.parentOf(change.object)) !== this.store.container) return 0;
    } catch (cause) {
      if (cause instanceof StorageError && (cause.code === "not-found" || cause.status === 410)) {
        return this.ingest(generation);
      }
      throw cause;
    }
    if (!this.current(generation)) return 0;
    const record = await this.store.readStoredUpdate(change.object);
    if (!this.current(generation)) return 0;
    if (!record) return this.ingest(generation);
    const count = this.applyStored([record.update]);
    this.knownUrls.add(record.url);
    if (record.kind === "update") this.updatesSinceCompaction++;
    return count;
  }

  private applyStored(updates: readonly Uint8Array[]): number {
    if (updates.length === 0) return 0;
    const errors: Error[] = [];
    // Phase 1: decode-validate each untrusted update on a fresh throwaway doc.
    const valid: Uint8Array[] = [];
    for (const update of updates) {
      const probe = new Doc();
      try {
        applyUpdate(probe, update);
        valid.push(update);
      } catch (cause) {
        errors.push(new Error(`[y-solid] skipped a corrupt update: ${toError(cause).message}`));
      } finally {
        probe.destroy();
      }
    }
    // Phase 2: fold the validated updates in via a Yjs-generated diff so the live
    // doc is only ever mutated by well-formed, complete bytes (no partial-apply).
    let applied = 0;
    if (valid.length > 0) {
      const scratch = new Doc();
      try {
        // Seed the scratch from the live state (so the diff is relative to it)...
        applyUpdate(scratch, encodeStateAsUpdate(this.doc));
        const liveVector = encodeStateVector(this.doc);
        // ...replay the validated updates onto the scratch...
        for (const update of valid) applyUpdate(scratch, update);
        // ...and compute the net change as a Yjs-generated diff.
        const diff = encodeStateAsUpdate(scratch, liveVector);
        // Apply the clean diff to the live doc as one echo-free transaction.
        this.doc.transact(() => {
          applyUpdate(this.doc, diff, this);
        }, this);
        this.transport?.sendUpdate(diff);
        applied = valid.length;
      } catch (cause) {
        // A decode-validated update failed to integrate into the scratch — not
        // expected. Fail closed: the live doc was NOT touched (the diff is applied
        // only after the scratch work fully succeeds). Report, do not corrupt.
        errors.push(
          new Error(`[y-solid] failed to integrate validated updates: ${toError(cause).message}`),
        );
      } finally {
        scratch.destroy();
      }
    }
    // Emit AFTER the transaction commits so an error listener cannot reentrantly
    // mutate the doc mid-transaction.
    for (const error of errors) this.emit("error", error);
    return applied;
  }

  async sync(): Promise<number> {
    if (!this.active || !this.synced || this.destroyed) return 0;
    const generation = this.generation;
    const count = await this.serial(() => this.ingest(generation));
    this.autoCompact();
    return count;
  }

  private scheduleWrite(): void {
    if (!this.active || !this.synced || this.destroyed || !this.pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.drainWrites();
    }, this.debounceMs);
  }

  private drainWrites(): void {
    if (!this.active || this.destroyed || !this.pending.length) return;
    this.writeTail = this.writeTail
      .catch(() => {})
      .then(async () => {
        if (!this.active || this.destroyed || !this.pending.length) return;
        const batch = this.pending.splice(0);
        try {
          const update = mergeUpdates(batch);
          if (this.transport?.sendUpdate(update)) return;
          const { url } = await this.store.appendUpdate(update);
          this.knownUrls.add(url);
          this.updatesSinceCompaction++;
          this.autoCompact();
        } catch (cause) {
          if (!this.destroyed) this.pending.unshift(...batch);
          this.report(cause);
          throw cause;
        }
      });
    // Retain the rejected tail for flush(), but handle background failures.
    void this.writeTail.catch(() => {});
  }

  private autoCompact(): void {
    if (
      !this.active ||
      !this.synced ||
      this.destroyed ||
      this.mode === "live" ||
      this.compacting ||
      this.updatesSinceCompaction < this.compaction.afterUpdates ||
      Date.now() - this.lastCompaction < this.compaction.minIntervalMs
    )
      return;
    void this.compact().catch((cause) => this.report(cause));
  }

  async compact(): Promise<{ url: string } | undefined> {
    if (this.destroyed || !this.active || this.mode === "live") return undefined;
    if (this.compacting) return this.compacting;
    const generation = this.generation;
    const compacting = (async () => {
      await this.flush();
      return this.serial(async () => {
        const stored = await this.store.loadUpdates();
        if (!this.current(generation) || this.mode === "live" || stored.length <= 1)
          return undefined;
        // Refuse to retire any record if even one payload cannot be decoded safely.
        for (const { update } of stored) {
          const probe = new Doc();
          try {
            applyUpdate(probe, update);
          } finally {
            probe.destroy();
          }
        }
        if (this.applyStored(stored.map((s) => s.update)) !== stored.length) {
          throw new Error("[y-solid] compaction could not integrate every record");
        }
        if (!this.current(generation)) return undefined;
        const snapshot = encodeStateAsUpdate(this.doc);
        const count = this.updatesSinceCompaction;
        const created = await this.store.compact(snapshot, stored);
        if (!this.current(generation)) return created;
        for (const { url } of stored) this.knownUrls.add(url);
        for (const url of created.deletedUrls) this.knownUrls.delete(url);
        this.knownUrls.add(created.url);
        this.updatesSinceCompaction = Math.max(0, this.updatesSinceCompaction - count);
        this.lastCompaction = Date.now();
        return created;
      });
    })();
    this.compacting = compacting;
    try {
      return await compacting;
    } finally {
      if (this.compacting === compacting) this.compacting = undefined;
    }
  }

  async persistFullState(): Promise<{ url: string } | undefined> {
    if (this.destroyed || !this.active) throw new Error("[y-solid] provider is disconnected");
    if (this.transport?.sendUpdate(encodeStateAsUpdate(this.doc))) return undefined;
    const result = await this.store.appendUpdate(encodeStateAsUpdate(this.doc));
    this.knownUrls.add(result.url);
    this.updatesSinceCompaction++;
    this.autoCompact();
    return result;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    // A failed batch stays pending and a later explicit flush retries it.
    // Preserve an in-flight failure when there is no new batch to enqueue.
    this.drainWrites();
    await this.writeTail;
  }

  async disconnect(): Promise<void> {
    if (this.destroyed) return;
    let failure: { cause: unknown } | undefined;
    try {
      await this.flush();
    } catch (cause) {
      failure = { cause };
    }
    this.stop();
    const subscription = this.subscription;
    this.subscription = undefined;
    try {
      await subscription?.close();
    } catch (cause) {
      // Preserve the failed append as the disconnect error if closing also fails.
      failure ??= { cause };
    } finally {
      if (!this.active && !this.destroyed) this.emit("status", "disconnected");
    }
    if (failure) throw failure.cause;
  }

  private stop(): void {
    this.active = false;
    this.synced = false;
    this.generation++;
    this.connection = undefined;
    this.operationTail = Promise.resolve();
    this.compacting = undefined;
    this.clearReconciliationTimers();
    this.transport?.disconnect();
    this.subscriptionAbort?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.transport?.destroy();
    this.doc.off("update", this.updateHandler);
    void this.subscription?.close().catch(() => {});
    this.subscription = undefined;
    this.pending.length = 0;
    this.listeners.clear();
  }

  on<K extends keyof SolidPersistenceEvents>(
    event: K,
    listener: SolidPersistenceEvents[K],
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof SolidPersistenceEvents>(event: K, listener: SolidPersistenceEvents[K]): void {
    this.listeners.get(event)?.delete(listener as Listener);
  }

  protected report(cause: unknown): void {
    if (this.destroyed) return;
    if (cause instanceof StorageError && cause.code === "precondition-failed") {
      this.emit("conflict", cause);
    }
    this.emit("error", toError(cause));
  }

  protected emit<K extends keyof SolidPersistenceEvents>(
    event: K,
    ...args: Parameters<SolidPersistenceEvents[K]>
  ): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...a: Parameters<SolidPersistenceEvents[K]>) => void)(...args);
    }
  }

  protected installTransport(transport: LiveTransport): void {
    this.transport = transport;
  }

  protected transportCallbacks() {
    return {
      lost: (checkpoint: boolean) => {
        if (!this.active || this.destroyed) return;
        // The wire protocol has no per-update durability acknowledgement. Keep
        // all local state on loss, including edits sent just before the close.
        if (checkpoint) this.pending.push(encodeStateAsUpdate(this.doc));
        this.scheduleWrite();
        this.emit("status", "connecting");
      },
      ready: () => {
        this.scheduleWrite();
        if (this.synced) this.emit("status", "connected");
      },
      prepare: async () => {
        // A temporarily failing pod append must not prevent the relay from
        // accepting the retained batch on the next successful live connection.
        await this.flush().catch(() => {});
        await this.sync().catch((cause) => this.report(cause));
      },
      settled: async () => {
        await this.writeTail.catch(() => {});
      },
      error: (error: Error) => this.report(error),
    };
  }
}

export interface YSolidOptions extends SolidPersistenceOptions, LiveOptions {
  storage: StorageClient;
  container: string;
  mode?: "auto" | "log" | "live";
  awareness?: Awareness;
}

/** Ticket-authenticated y-websocket sync with immutable-log fallback. */
export class YSolidProvider extends SolidPersistence {
  private awarenessValue?: Awareness;
  private readonly ownsAwareness: boolean;

  get awareness(): Awareness {
    if (this.destroyed && !this.awarenessValue) throw new Error("[y-solid] provider is destroyed");
    this.awarenessValue ??= new Awareness(this.doc);
    return this.awarenessValue;
  }

  constructor(options: YSolidOptions) {
    const store = options.store ?? new SolidUpdateStore(options);
    const service =
      options.mode === "log"
        ? undefined
        : selectLiveService(store.storage, store.container, options);
    if (options.mode === "live" && !service)
      throw new Error("[y-solid] live mode requires y-protocol-v1 support");
    if (options.awareness && options.awareness.doc !== options.doc) {
      throw new Error("[y-solid] awareness must belong to the provider document");
    }
    for (const value of [options.reconnectDelayMs ?? 1_000, options.connectTimeoutMs ?? 10_000]) {
      if (!Number.isFinite(value) || value <= 0)
        throw new TypeError("[y-solid] invalid live timing options");
    }
    super({ ...options, store });
    this.ownsAwareness = !options.awareness;
    this.awarenessValue = options.awareness;
    if (service)
      this.installTransport(
        new LiveTransport(
          options.doc,
          this.awareness,
          this.store.container,
          service,
          options,
          this.transportCallbacks(),
        ),
      );
  }

  override destroy(): void {
    if (this.destroyed) return;
    super.destroy();
    if (this.ownsAwareness) this.awarenessValue?.destroy();
  }
}
