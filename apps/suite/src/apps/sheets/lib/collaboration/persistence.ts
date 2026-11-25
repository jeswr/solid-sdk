// AUTHORED-BY Codex GPT-6.1-Sol
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import {
  clearLocalMirrors,
  hasUnconfirmedLocalState,
  type IndexeddbPersistence,
  LocalMirrorError,
  openLocalMirror,
  prepareLocalMirror,
  retireLocalMirror,
} from "@jeswr/y-solid/local";
import * as Y from "yjs";
import type { Snapshot } from "../contract";
import { checkpoint, SEED_ORIGIN, seedSheets, sheetStates } from "./model";

export function workbookMirrorName(webId: string, workbook: string, instanceId?: string) {
  return `suite.sheets.workbook:${JSON.stringify(instanceId === undefined ? [webId, workbook] : [webId, workbook, instanceId])}`;
}

export async function clearWorkbookMirrors(webId: string, workbook: string) {
  try {
    if (typeof indexedDB === "undefined") return;
    await clearLocalMirrors(workbookMirrorName(webId, workbook));
  } catch (error) {
    // Storage denial must not turn a successful pod deletion into a failure.
    if (!(error instanceof LocalMirrorError)) throw error;
  }
}

const CORRUPT_UPDATE = "[y-solid] skipped a corrupt update";

/**
 * Only refusals that will never succeed on retry: the size cap and 403. 404/410 never reach
 * here (y-solid returns null for them). 401, 408, 425, 429, other statuses, 5xx and network
 * errors are transient and must fail the open. @jeswr/y-solid exposes no typed error or
 * status for these failures, so this matches its message text and fails closed: an unknown
 * or reworded message is never skipped.
 */
function permanentReadFailure(error: unknown) {
  const { message } = error as Error;
  return /exceeds max size/.test(message) || /readUpdate .* failed: 403\b/.test(message);
}

/** How long a positive currency check lets later appends skip re-reading workbook.json. */
const CURRENCY_TTL_MS = 2000;

/** One append-only update log, with an atomic, create-only initial seed. */
export class WorkbookCollaboration {
  readonly doc = new Y.Doc();
  readonly provider: SolidPersistence;
  private stopped = false;
  private failure: Error | undefined;
  private failureVersion = 0;
  private syncing: Promise<unknown> = Promise.resolve();
  private unwatch: (() => void) | undefined;
  private mirror: IndexeddbPersistence | undefined;
  private confirmedVector = "AA==";
  private retired: Error | undefined;
  private currentUntil = 0;
  private readonly retireListeners = new Set<() => void>();
  private readonly skipListeners = new Set<(skipped: number) => void>();
  localMirrorUnavailable = false;
  /** Log members that could not be read or decoded and were skipped. Non-blocking. */
  skippedUpdates = 0;
  private skipCause: Error | undefined;
  readOnly: boolean;

  constructor(
    readonly container: string,
    private readonly fetch: typeof globalThis.fetch,
    readOnly: boolean,
    store = new SolidUpdateStore({ container, fetch }),
    private readonly webId?: string,
    private readonly instance?: { workbook: string; isCurrent(): Promise<boolean> },
  ) {
    this.container = store.container;
    this.readOnly = readOnly;
    // Defence in depth: even a stray local transaction cannot write as a viewer.
    const append = store.appendUpdate.bind(store);
    store.appendUpdate = async (update) => {
      if (this.retired) throw this.retired;
      if (this.readOnly) throw new Error("This spreadsheet is view only");
      // A restore elsewhere replaces the instance id and retires this log: never
      // keep appending to it. The result is cached briefly to bound the extra reads.
      if (Date.now() >= this.currentUntil) await this.checkCurrent();
      if (this.retired) throw this.retired;
      return append(update);
    };
    // One oversized, forbidden or otherwise permanently unreadable member must not make
    // the whole workbook unopenable. Skip it (the store keeps its size caps) and open
    // from the snapshot plus the readable updates. Transient failures still propagate.
    const read = store.readUpdate.bind(store);
    store.readUpdate = async (url) => {
      try {
        return await read(url);
      } catch (error) {
        if (!permanentReadFailure(error)) throw error;
        this.skipped(error as Error);
        return null;
      }
    };
    this.provider = new SolidPersistence({ doc: this.doc, store });
    this.provider.on("error", (error) => {
      // A corrupt member is skipped by y-solid; it is a warning, not an append failure.
      if (error.message.startsWith(CORRUPT_UPDATE)) {
        this.skipped(error);
        return;
      }
      this.failure = error;
      ++this.failureVersion;
    });
  }

  private skipped(cause: Error) {
    ++this.skippedUpdates;
    this.skipCause ??= cause;
    for (const listener of this.skipListeners) listener(this.skippedUpdates);
  }

  /** Called when members are skipped after open, with the running total. */
  onSkipped(listener: (skipped: number) => void) {
    this.skipListeners.add(listener);
    return () => void this.skipListeners.delete(listener);
  }

  /** Called once when the workbook was deleted or restored under another instance id. */
  onRetired(listener: () => void) {
    this.retireListeners.add(listener);
    return () => void this.retireListeners.delete(listener);
  }

  get isRetired() {
    return this.retired !== undefined;
  }

  /** Currency check for live traffic. Transient read failures never retire the log. */
  private async checkCurrent() {
    try {
      await this.assertCurrent();
    } catch (error) {
      if (this.retired && error === this.retired) return;
      // isCurrent could not be answered: keep working, a later check will decide.
    }
  }

  async open(snapshot: Snapshot) {
    try {
      await this.provider.whenSynced;
      if (this.failure) throw this.failure;
      if (sheetStates(this.doc).size) {
        await this.openMirror(snapshot);
        return;
      }
      // Nothing readable survived: fail closed rather than seed beside a damaged log.
      if (this.skipCause) throw this.skipCause;
      if (this.readOnly) {
        // Legacy view-only workbooks render their snapshot without creating a log.
        return;
      }
      const seed = new Y.Doc();
      try {
        seed.transact(() => seedSheets(seed, snapshot), SEED_ORIGIN);
        // All empty-log openers race on one immutable resource. Losing seeds
        // never enter their live docs, so random row IDs cannot duplicate rows.
        const seedUrl = new URL("seed", this.container).href;
        const seedStore = new SolidUpdateStore({
          container: this.container,
          fetch: (_input, init) => this.fetch(seedUrl, init),
        });
        await this.assertCurrent();
        try {
          await seedStore.appendUpdate(Y.encodeStateAsUpdate(seed));
        } catch (error) {
          // Only an existing canonical seed resolves a create race. Other
          // failures (including rejected redirects) remain visible to the caller.
          const winner = await this.provider.store.readUpdate(seedUrl);
          if (!winner) throw error;
        }
        await this.provider.sync();
        if (this.failure) throw this.failure;
        if (!sheetStates(this.doc).size)
          throw this.skipCause ?? new Error("Couldn't load spreadsheet collaboration");
      } finally {
        seed.destroy();
      }
      await this.openMirror(snapshot);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  private async openMirror(snapshot: Snapshot) {
    const confirmed = Y.encodeStateAsUpdate(this.doc);
    this.confirmedVector = checkpoint(this.doc).stateVector;
    // Public/shared viewers never consume the owner's pending local updates.
    if (!this.webId || this.readOnly) return;
    if (typeof indexedDB === "undefined") {
      this.localMirrorUnavailable = true;
      return;
    }
    const workbook = this.instance?.workbook ?? new URL("../", this.container).href;
    const instanceId = snapshot.id;
    if (typeof instanceId !== "string" || !instanceId)
      throw new Error("Missing workbook instance identity");
    const name = workbookMirrorName(this.webId, workbook, instanceId);
    try {
      await prepareLocalMirror(workbookMirrorName(this.webId, workbook), name);
      this.mirror = await openLocalMirror(name, this.doc);
    } catch (error) {
      if (!(error instanceof LocalMirrorError)) throw error;
      this.mirror = undefined;
      this.localMirrorUnavailable = true;
      return;
    }
    if (await hasUnconfirmedLocalState(this.mirror, async () => confirmed)) {
      // The mirror may include edits whose earlier append failed before teardown.
      await this.persistFullState();
    }
    await this.flush();
  }

  checkpoint() {
    return { ...checkpoint(this.doc), stateVector: this.confirmedVector };
  }

  private async assertCurrent() {
    if (this.retired) throw this.retired;
    if (this.instance && (await this.instance.isCurrent())) {
      this.currentUntil = Date.now() + CURRENCY_TTL_MS;
    } else if (this.instance) {
      this.retired = new Error("This spreadsheet was deleted or replaced");
      this.stopped = true;
      this.unwatch?.();
      this.provider.destroy();
      const mirror = this.mirror;
      this.mirror = undefined;
      try {
        if (mirror && this.webId) {
          await mirror.destroy();
          await retireLocalMirror(
            workbookMirrorName(this.webId, this.instance.workbook),
            mirror.name,
          );
        }
      } finally {
        this.doc.destroy();
        for (const listener of this.retireListeners) listener();
      }
      throw this.retired;
    }
  }

  private async persistFullState() {
    await this.assertCurrent();
    return this.provider.persistFullState();
  }

  sync() {
    this.syncing = this.syncing
      .catch(() => {})
      .then(async () => {
        if (this.stopped) return;
        // Focus, reconnect, push and the 30-second poll all land here: notice a restore
        // elsewhere before reading from, or flushing into, the retired log.
        await this.checkCurrent();
        if (this.stopped) return;
        await this.provider.sync();
        // A prior native replay may have failed after Yjs accepted its update.
        // Reconcile that live state again even when the log has no new members.
        this.doc.transact(() => {}, this.provider);
        if (!this.readOnly) await this.flush();
      });
    return this.syncing;
  }

  async flush() {
    if (this.retired) throw this.retired;
    const confirmed = Y.encodeStateAsUpdate(this.doc);
    const vector = checkpoint(this.doc).stateVector;
    await this.provider.flush();
    // A background append can retire this log (restored elsewhere) while it drains.
    if (this.retired) throw this.retired;
    if (this.readOnly) return;
    if (this.failure) {
      // y-solid reports background append errors through events. Retain all
      // edits in the live doc and repair the log before acknowledging a save.
      const version = this.failureVersion;
      await this.persistFullState();
      // A later append can fail while this full-state write is in flight. Its
      // edits may postdate the encoded repair, so retain that failure for retry.
      if (this.failureVersion === version) this.failure = undefined;
    }
    this.confirmedVector = vector;
    if (this.mirror) await this.mirror.set("confirmed", Uint8Array.from(confirmed).buffer);
  }

  watch(subscribe: (listener: (url: string) => void) => () => void) {
    this.unwatch?.();
    const sync = () => void this.sync().catch(() => {});
    const change = (url: string) => {
      if (url === this.container || url.startsWith(this.container)) sync();
    };
    const unsubscribe = subscribe(change);
    const focus = () => sync();
    const visible = () => {
      if (document.visibilityState === "visible") sync();
      else void this.flush().catch(() => {});
    };
    const flush = () => void this.flush().catch(() => {});
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 30_000);
    this.unwatch = () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visible);
    };
    // Cover notification setup gaps, including a first push connection.
    sync();
  }

  async destroy() {
    if (this.stopped) return;
    this.stopped = true;
    this.unwatch?.();
    try {
      await this.syncing.catch(() => {});
      await this.flush();
    } finally {
      this.provider.destroy();
      try {
        if (this.mirror) {
          try {
            // Reading the updates store waits for outstanding delta transactions.
            await hasUnconfirmedLocalState(this.mirror);
          } finally {
            await this.mirror.destroy();
          }
        }
      } finally {
        this.doc.destroy();
      }
    }
  }
}
