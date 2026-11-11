// AUTHORED-BY Codex GPT-6.1-Sol
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import * as Y from "yjs";
import type { Snapshot } from "../contract";
import { SEED_ORIGIN, seedSheets, sheetStates } from "./model";

/** One append-only update log, with an atomic, create-only initial seed. */
export class WorkbookCollaboration {
  readonly doc = new Y.Doc();
  readonly provider: SolidPersistence;
  private stopped = false;
  private failure: Error | undefined;
  private syncing: Promise<unknown> = Promise.resolve();
  private unwatch: (() => void) | undefined;
  readOnly: boolean;

  constructor(
    readonly container: string,
    private readonly fetch: typeof globalThis.fetch,
    readOnly: boolean,
    store = new SolidUpdateStore({ container, fetch }),
  ) {
    this.container = store.container;
    this.readOnly = readOnly;
    // Defence in depth: even a stray local transaction cannot write as a viewer.
    const append = store.appendUpdate.bind(store);
    store.appendUpdate = (update) => {
      if (this.readOnly) return Promise.reject(new Error("This spreadsheet is view only"));
      return append(update);
    };
    this.provider = new SolidPersistence({ doc: this.doc, store });
    this.provider.on("error", (error) => {
      this.failure = error;
    });
  }

  async open(snapshot: Snapshot) {
    try {
      await this.provider.whenSynced;
      if (this.failure) throw this.failure;
      if (sheetStates(this.doc).size) return;
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
        if (!sheetStates(this.doc).size) throw new Error("Couldn't load spreadsheet collaboration");
      } finally {
        seed.destroy();
      }
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  sync() {
    this.syncing = this.syncing
      .catch(() => {})
      .then(async () => {
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
    await this.provider.flush();
    if (this.readOnly) return;
    if (this.failure) {
      // y-solid reports background append errors through events. Retain all
      // edits in the live doc and repair the log before acknowledging a save.
      await this.provider.persistFullState();
      this.failure = undefined;
    }
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
      this.doc.destroy();
    }
  }
}
