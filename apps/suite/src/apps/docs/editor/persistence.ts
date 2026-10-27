// AUTHORED-BY Codex
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import { generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { clearDocument, IndexeddbPersistence, storeState } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import type { PodSession } from "@/lib/session/pod-session";
import { createSolidDriveClient } from "../../drive/lib/client/client";
import { deriveTitle, type SaveState, wordCount } from "../lib/editor/logic";
import {
  createDocsStore,
  type DocsStore,
  docContainerUrls,
  isDirectChild,
  ResourceWriteError,
  type StoredDocument,
  TitleConflictError,
} from "../lib/model";
import { baseExtensions } from "./extensions";
import { DocumentUpdateStore } from "./update-store";

class InactiveLogError extends Error {}

interface PendingEdit {
  title: string;
  baseTitle: string;
  baseModified: string | undefined;
}

/** One owner for the CRDT, mirrors and serial snapshot queue, independent of React mounts. */
export class DocumentPersistence {
  readonly doc = new Doc();
  readonly store: DocsStore;
  local: IndexeddbPersistence | undefined;
  provider: SolidPersistence | undefined;
  stored: StoredDocument | undefined;
  title = "";
  body = "<p></p>";
  json: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
  state: SaveState = "saving";
  lastSaved = Date.now();
  conflict: TitleConflictError | undefined;
  readOnly = false;
  online = true;
  trashed = false;
  private creation: "draft" | "creating" | "created" = "draft";
  private draftMirror: IndexeddbPersistence | undefined;
  private pendingEdit: PendingEdit | undefined;
  private offlineCopy = false;
  private destroyed: Promise<void> | undefined;
  private version = 0;
  private savedVersion = 0;
  private tail: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private needsFullState = false;
  private providerError: Error | undefined;
  private updates = 0;
  private bytes = 0;
  notify = () => {};
  onCreated: (url: string) => void = () => {};
  constructor(readonly session: PodSession) {
    const keepaliveFetch: typeof fetch = (input, init) => {
      const body = init?.body;
      const fits =
        typeof body === "string" && new TextEncoder().encode(body).byteLength <= 60 * 1024;
      return session.fetch(input, {
        ...init,
        ...(fits && init?.method === "PUT" ? { keepalive: true } : {}),
      });
    };
    this.store = createDocsStore({
      podRoot: session.storageUrl,
      webId: session.webId,
      fetchImpl: keepaliveFetch,
    });
    this.doc.on("update", (update: Uint8Array) => {
      this.updates++;
      this.bytes += update.byteLength;
    });
  }
  private assertActive() {
    if (this.stopped) throw new DOMException("Document closed", "AbortError");
  }
  async open(url?: string, recover = false) {
    this.assertActive();
    let pending: unknown;
    let cached: { webId: string; document: StoredDocument } | undefined;
    if (!recover || !url) {
      this.local = new IndexeddbPersistence(
        url ?? `suite.docs.draft:${this.session.webId}`,
        this.doc,
      );
      await this.local.whenSynced;
      this.assertActive();
      pending = await this.local.get("pending");
      this.assertActive();
      const edit = await this.metadata<PendingEdit>("edit");
      this.assertActive();
      if (pending) {
        this.pendingEdit = edit;
        const title = edit?.title ?? (await this.local.get("title"));
        this.assertActive();
        if (typeof title === "string") this.title = title;
        this.version++;
        this.needsFullState = true;
      }
      if (!url) {
        const creating = await this.metadata<StoredDocument>("creating");
        this.assertActive();
        if (creating) {
          this.stored = creating;
          this.creation = "creating";
        }
        return;
      }
      cached = await this.metadata<{ webId: string; document: StoredDocument }>("stored");
      this.assertActive();
    }
    try {
      this.stored = await this.store.read(url);
    } catch (error) {
      this.assertActive();
      // Authorization and missing resources must still surface, even with a cache.
      if (
        recover ||
        !cached ||
        cached.webId !== this.session.webId ||
        cached.document.url !== url ||
        (error instanceof RdfFetchError && error.status !== undefined && error.status < 500)
      )
        throw error;
      this.stored = cached.document;
      this.online = false;
      this.offlineCopy = true;
    }
    this.assertActive();
    if (!this.stored) throw new Error("not-found");
    this.creation = "created";
    if (!pending) this.title = this.stored.data.title;
    this.checkTitleConflict();
    this.body = this.stored.data.body;
    this.lastSaved = Date.parse(this.stored.data.modified ?? new Date().toISOString());
    this.readOnly = url.startsWith(this.store.legacyContainer);
    const layout = docContainerUrls(url);
    let container = this.updateContainer();
    if (recover) {
      container = `${layout.container}updates-${Date.now()}/`;
      await this.local?.destroy();
      this.assertActive();
      await createSolidDriveClient({
        storageUrl: this.session.storageUrl,
        fetch: this.session.fetch,
      }).createFolder(container);
      this.assertActive();
      // Recovery is an explicit creation state: make its base update durable
      // before advertising the new log to other clients.
      this.seedSnapshot();
      await this.activeDocument();
      this.assertActive();
      await new SolidUpdateStore({ container, fetch: this.session.fetch }).appendUpdate(
        encodeStateAsUpdate(this.doc),
      );
      this.assertActive();
      this.stored = await this.store.save(
        this.stored,
        { updateLog: container, revisionLabel: "Recovered last saved copy" },
        { regenerate: () => ({ body: this.body, format: "text/html" }) },
      );
      this.assertActive();
    }
    if (!this.readOnly && !this.offlineCopy) {
      this.attachProvider(container, false);
      // Keep the editor unmounted until the initial CRDT merge finishes. Replaying
      // the log must not race the first keyboard selection or a pending local edit.
      await this.provider?.whenSynced;
      this.assertActive();
      if (this.providerError) throw this.providerError;
    }
    // Legacy snapshots are view-only. Existing writable documents must hydrate
    // from their CRDT log, including when its visible content is empty.
    if (this.readOnly) this.seedSnapshot();
    if (
      !pending &&
      !this.readOnly &&
      cached?.webId === this.session.webId &&
      (cached.document.data.updateLog ?? layout.updateLog) !== container
    ) {
      // A reopened device may still hold state from a retired log, even when
      // those edits were previously marked saved. Keep the transfer durable.
      this.needsFullState = true;
      this.markDirty();
    }
    if (recover) {
      await clearDocument(url);
      this.assertActive();
      this.local = new IndexeddbPersistence(url, this.doc);
      await this.local.whenSynced;
      this.assertActive();
    }
    await this.cacheStored();
    this.assertActive();
    if (this.offlineCopy) this.scheduleRetry();
    this.state = this.conflict
      ? "failed"
      : this.version || (this.provider && !this.provider.synced)
        ? "saving"
        : "saved";
  }
  private seedSnapshot() {
    const extensions = baseExtensions(this.session.fetch);
    const seed = prosemirrorJSONToYDoc(
      getSchema(extensions),
      generateJSON(this.body || "<p></p>", extensions),
      "prosemirror",
    );
    applyUpdate(this.doc, encodeStateAsUpdate(seed));
    seed.destroy();
  }
  private updateContainer() {
    const stored = this.stored as StoredDocument;
    const layout = docContainerUrls(stored.url);
    const container = stored.data.updateLog ?? layout.updateLog;
    if (!container.endsWith("/") || !isDirectChild(container.slice(0, -1), layout.container))
      throw new Error("Invalid update location");
    return container;
  }
  private checkTitleConflict() {
    if (
      this.stored &&
      this.version !== this.savedVersion &&
      this.stored.data.title !== this.pendingEdit?.baseTitle &&
      this.stored.data.title !== this.title
    ) {
      this.conflict = new TitleConflictError(this.stored.url, this.title, this.stored.data.title);
    }
  }
  private async metadata<T>(key: string): Promise<T | undefined> {
    const raw = await this.local?.get(key);
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  private async cacheStored() {
    if (this.stored)
      await this.local?.set(
        "stored",
        JSON.stringify({ webId: this.session.webId, document: this.stored }),
      );
  }
  private pauseLog(error: Error) {
    this.providerError = error;
    this.needsFullState = true;
    this.provider?.destroy();
    this.state = "retrying";
    this.scheduleRetry();
    this.notify();
  }
  private async activeDocument() {
    let remote: StoredDocument | undefined;
    try {
      remote = await this.store.read((this.stored as StoredDocument).url);
    } catch (error) {
      if (!(error instanceof RdfFetchError && [404, 410].includes(error.status ?? 0))) throw error;
    }
    if (!remote) {
      this.trashed = true;
      const error = new InactiveLogError("This document was moved to trash");
      this.pauseLog(error);
      throw error;
    }
    return remote;
  }
  private async checkLog(container: string) {
    const remote = await this.activeDocument();
    const active = remote.data.updateLog ?? docContainerUrls(remote.url).updateLog;
    if (active !== container) {
      const error = new InactiveLogError("The document has a new update log");
      this.pauseLog(error);
      throw error;
    }
  }
  private async reconcileProvider() {
    const remote = await this.activeDocument();
    if (
      this.version === this.savedVersion ||
      (this.pendingEdit && this.title === this.pendingEdit.baseTitle)
    )
      this.title = remote.data.title;
    this.stored = remote;
    this.checkTitleConflict();
    if (this.conflict) throw this.conflict;
    this.offlineCopy = false;
    const container = this.updateContainer();
    if (
      this.provider?.destroyed ||
      this.provider?.store.container !== container ||
      !this.provider.synced
    ) {
      this.state = "saving";
      this.notify();
      this.provider?.destroy();
      await this.provider?.flush();
      this.needsFullState = true;
      this.attachProvider(container, false);
      await this.provider?.whenSynced;
      if (this.providerError) throw this.providerError;
    }
    this.trashed = false;
  }
  private attachProvider(container: string, allowEmpty = true) {
    this.assertActive();
    this.provider?.destroy();
    this.providerError = undefined;
    this.provider = new SolidPersistence({
      doc: this.doc,
      store: new DocumentUpdateStore(
        container,
        this.session.fetch,
        () => this.checkLog(container),
        allowEmpty,
      ),
    });
    this.provider.on("error", (error) => {
      this.providerError = error;
      this.needsFullState = true;
      this.state = "retrying";
      this.scheduleRetry();
      this.notify();
    });
  }
  capture(body: string, json: JSONContent) {
    this.body = body;
    this.json = json;
  }
  change(body: string, json: JSONContent) {
    if (this.readOnly) return;
    this.capture(body, json);
    if (this.creation === "draft" && !this.title) this.title = deriveTitle(json);
    this.markDirty();
    if (this.creation !== "created") void this.flush();
  }
  rename(title: string) {
    if (this.readOnly || this.title === title) return;
    this.title = title.slice(0, 200);
    this.markDirty();
    void this.flush();
  }
  private markDirty() {
    this.pendingEdit = {
      title: this.title,
      baseTitle: this.pendingEdit?.baseTitle ?? this.stored?.data.title ?? this.title,
      baseModified: this.pendingEdit?.baseModified ?? this.stored?.data.modified,
    };
    this.version++;
    this.state = this.trashed ? "retrying" : "saving";
    void this.local?.set("pending", 1);
    void this.local?.set("title", this.title);
    void this.local?.set("edit", JSON.stringify(this.pendingEdit));
    this.notify();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 2000);
  }
  async forceSave() {
    if (this.readOnly || (!this.stored && this.version === 0)) return;
    this.markDirty();
    await this.flush();
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.readOnly || !this.online || this.conflict) return;
    if (this.creation === "draft" && this.version === this.savedVersion) return;
    if (this.tail) return this.tail;
    this.tail = this.write().finally(() => {
      this.tail = undefined;
    });
    return this.tail;
  }
  private async write() {
    try {
      if (this.creation === "created") await this.reconcileProvider();
      if (this.savedVersion === this.version) {
        await this.persistUpdates();
        await this.cacheStored();
      }
      while (this.savedVersion !== this.version) {
        const version = this.version;
        const title = this.title || "Untitled document";
        const snapshot = {
          body: this.body,
          format: "text/html",
          wordCount: wordCount(this.json).words,
        };
        this.state = "saving";
        this.notify();
        if (this.creation !== "created") {
          if (this.creation === "draft") {
            this.stored = await this.store.create({ ...snapshot, title });
            this.creation = "creating";
            await this.local?.set("creating", JSON.stringify(this.stored));
          }
          const stored = this.stored as StoredDocument;
          if (this.local?.name !== stored.url) {
            this.draftMirror = this.local;
            this.local = new IndexeddbPersistence(stored.url, this.doc);
          }
          await this.local.whenSynced;
          if (!this.provider?.synced) {
            this.attachProvider(this.updateContainer());
            await this.provider?.whenSynced;
          }
          await this.provider?.persistFullState();
          this.needsFullState = false;
          this.providerError = undefined;
          if (this.draftMirror) {
            await this.draftMirror.clearData();
            await this.draftMirror.destroy();
            this.draftMirror = undefined;
          }
          this.creation = "created";
          this.onCreated(stored.url);
          if (stored.data.body !== snapshot.body || stored.data.title !== title) {
            this.stored = await this.store.save(
              stored,
              { ...snapshot, title },
              {
                regenerate: () => ({
                  body: this.body,
                  format: "text/html",
                  wordCount: wordCount(this.json).words,
                }),
              },
            );
          }
        } else {
          this.stored = await this.store.save(
            this.stored as StoredDocument,
            { ...snapshot, title },
            {
              regenerate: () => ({
                body: this.body,
                format: "text/html",
                wordCount: wordCount(this.json).words,
              }),
            },
          );
        }
        if (this.title === title) this.title = (this.stored as StoredDocument).data.title;
        // A concurrent snapshot/recovery may have changed the pointer during save.
        await this.reconcileProvider();
        await this.persistUpdates();
        if (this.local) await storeState(this.local, true);
        await this.cacheStored();
        this.savedVersion = version;
        this.lastSaved = Date.now();
        if (this.version === version) {
          await this.local?.set("pending", 0);
          this.pendingEdit = undefined;
        }
      }
      this.state = "saved";
      if (this.provider && (this.updates >= 200 || this.bytes >= 2 * 1024 * 1024)) {
        this.updates = 0;
        this.bytes = 0;
        void this.provider
          .compact()
          .catch((error: unknown) =>
            console.warn(
              "Document log compaction failed",
              error instanceof Error ? error.name : "unknown",
            ),
          );
      }
    } catch (error) {
      if (error instanceof TitleConflictError) {
        this.conflict = error;
        this.state = "failed";
      } else {
        this.state =
          error instanceof ResourceWriteError && [403, 413, 507].includes(error.status)
            ? "failed"
            : "retrying";
        if (this.state === "retrying" && !this.stopped) this.scheduleRetry();
      }
    }
    this.notify();
  }
  private async persistUpdates() {
    await this.provider?.flush();
    if (this.providerError || this.needsFullState) {
      // Failed or retired incremental writes remain in IndexedDB. Merge the
      // entire local state into the active log before clearing pending edits.
      await this.provider?.persistFullState();
      this.providerError = undefined;
      this.needsFullState = false;
    }
    await this.provider?.flush();
    if (this.providerError) throw this.providerError;
    if (this.provider) await this.checkLog(this.provider.store.container);
  }
  async resolveTitle(keepMine: boolean) {
    if (!this.stored || !this.conflict) return;
    const remote = await this.store.read(this.stored.url);
    if (!remote) return;
    if (!keepMine) this.title = remote.data.title;
    this.stored = remote;
    this.pendingEdit = undefined;
    this.conflict = undefined;
    this.markDirty();
    await this.flush();
  }
  private scheduleRetry() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reconnect(), 4000);
  }
  async reconnect() {
    if (this.stopped) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.online = false;
      this.scheduleRetry();
      this.notify();
      return;
    }
    this.online = true;
    try {
      if (this.creation === "created" && !this.readOnly) await this.reconcileProvider();
      await this.provider?.sync();
      this.assertActive();
      if (this.provider && this.version !== this.savedVersion) this.needsFullState = true;
      await this.flush();
    } catch {
      if (this.stopped) return;
      this.state = "retrying";
      this.scheduleRetry();
      this.notify();
    }
  }
  destroy(): Promise<void> {
    if (this.destroyed) return this.destroyed;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.destroyed = (async () => {
      // An incomplete open must never allocate resources after this teardown.
      try {
        await this.tail;
        if (this.creation === "created") await this.flush();
        await this.provider?.flush();
      } finally {
        this.provider?.destroy();
        await this.local?.destroy();
        await this.draftMirror?.destroy();
        this.doc.destroy();
      }
    })();
    return this.destroyed;
  }
}
