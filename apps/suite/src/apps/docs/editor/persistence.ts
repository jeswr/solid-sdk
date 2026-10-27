// AUTHORED-BY Codex
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
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
import {
  DocumentReplacedError,
  incarnationMirror,
  sameIncarnation,
} from "../lib/model/incarnation";
import { copyDocument } from "./copy";
import { baseExtensions } from "./extensions";
import { updateMirrorMetadata } from "./mirror-metadata";
import { DocumentUpdateStore } from "./update-store";

class InactiveLogError extends Error {}

interface PendingEdit {
  owner?: string;
  title: string;
  baseTitle: string;
  baseModified: string | undefined;
}
interface PendingRecovery {
  key: string;
  title: string;
  source: StoredDocument;
  json: JSONContent;
  reservation?: StoredDocument;
}

/** One owner for the CRDT, mirrors and serial snapshot queue, independent of React mounts. */
export class DocumentPersistence {
  doc = new Doc();
  recoveredCopy: string | undefined;
  switchingLog = false;
  private mirrorRestart: Promise<void> | undefined;
  private mirrorGeneration = 0;
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
  private pendingRecovery: PendingRecovery | undefined;
  private readonly editOwner = crypto.randomUUID();
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
    this.trackUpdates();
  }
  private trackUpdates() {
    this.doc.on("update", (update: Uint8Array) => {
      this.updates++;
      this.bytes += update.byteLength;
    });
  }
  private createMirror(name: string) {
    const generation = this.mirrorGeneration;
    const mirror = new IndexeddbPersistence(name, this.doc);
    const save = mirror._storeUpdate;
    this.doc.off("update", save);
    mirror._storeUpdate = (update, origin: unknown) => {
      try {
        save(update, origin);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
        if (generation !== this.mirrorGeneration || mirror !== this.local) return;
        // Let the remaining Yjs listeners (including the pod provider) receive
        // this edit. Reopening seeds the mirror from the still-live Y.Doc.
        void this.restartMirror(mirror)
          .then(() => (generation === this.mirrorGeneration ? this.writePending() : undefined))
          .catch(() => {
            if (generation !== this.mirrorGeneration) return;
            this.state = "retrying";
            this.scheduleRetry();
            this.notify();
          });
      }
    };
    this.doc.on("update", mirror._storeUpdate);
    return mirror;
  }
  private restartMirror(mirror: IndexeddbPersistence) {
    if (mirror !== this.local) return Promise.resolve();
    const generation = this.mirrorGeneration;
    this.mirrorRestart ??= (async () => {
      await mirror.destroy();
      if (this.stopped || generation !== this.mirrorGeneration || mirror !== this.local) return;
      this.local = this.createMirror(mirror.name);
      await this.local.whenSynced;
      await storeState(this.local, true);
    })().finally(() => {
      this.mirrorRestart = undefined;
    });
    return this.mirrorRestart;
  }
  private async withMirror<T>(
    action: (mirror: IndexeddbPersistence) => Promise<T>,
  ): Promise<T | undefined> {
    const generation = this.mirrorGeneration;
    await this.mirrorRestart;
    if (generation !== this.mirrorGeneration) return undefined;
    const mirror = this.local;
    if (!mirror) return undefined;
    try {
      return await action(mirror);
    } catch (error) {
      if (generation !== this.mirrorGeneration) return undefined;
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
      await this.restartMirror(mirror);
      return generation === this.mirrorGeneration && this.local ? action(this.local) : undefined;
    }
  }
  private async writePending() {
    const edit = this.pendingEdit;
    if (!edit) return;
    const generation = this.mirrorGeneration;
    await this.withMirror((mirror) =>
      updateMirrorMetadata(
        mirror,
        (current) => {
          const previous = this.parseMetadata<PendingEdit>(current.edit);
          const previousTitle = previous?.title ?? current.title;
          if (
            current.pending &&
            previous?.owner !== edit.owner &&
            previousTitle !== edit.title &&
            typeof previousTitle === "string" &&
            previousTitle !== previous?.baseTitle
          )
            return undefined;
          return { pending: 1, title: edit.title, edit: JSON.stringify(edit) };
        },
        () => generation === this.mirrorGeneration,
      ),
    );
  }
  private async clearPending(title: string) {
    const generation = this.mirrorGeneration;
    await this.withMirror((mirror) =>
      updateMirrorMetadata(
        mirror,
        (current) => {
          const pending = this.parseMetadata<PendingEdit>(current.edit)?.title ?? current.title;
          return pending === title ? { pending: 0 } : undefined;
        },
        () => generation === this.mirrorGeneration,
      ),
    );
  }
  private mirrorName(url: string, container: string) {
    return incarnationMirror(
      { url, data: { instanceId: this.stored?.data.instanceId } },
      container,
    );
  }
  private async linkMirror(url: string, target: string) {
    // Keep a forward chain so offline reopens can find each generation. Stop
    // at pending edits when opening, before following a retired mirror's link.
    const seen = new Set<string>();
    let name = url;
    while (name !== target && !seen.has(name)) {
      seen.add(name);
      const doc = new Doc();
      const mirror = new IndexeddbPersistence(name, doc);
      try {
        await mirror.whenSynced;
        const next: unknown = await mirror.get("nextMirror");
        if (typeof next === "string") name = next;
        else {
          await mirror.set("nextMirror", target);
          return;
        }
      } finally {
        await mirror.destroy();
        doc.destroy();
      }
    }
  }
  private async readPending() {
    const pending = await this.local?.get("pending");
    this.assertActive();
    if (pending) {
      this.pendingEdit = await this.metadata<PendingEdit>("edit");
      this.pendingRecovery = await this.metadata<PendingRecovery>(
        `recovery:${this.pendingEdit?.owner ?? this.editOwner}`,
      );
      const title = this.pendingEdit?.title ?? (await this.local?.get("title"));
      if (typeof title === "string") this.title = title;
      this.version++;
      this.needsFullState = true;
    }
    return pending;
  }
  private async preserveRetiredEdits(remote: StoredDocument) {
    // A recovered snapshot has new CRDT identities. Keep local intent in its
    // own durable document; merging either history would duplicate the body.
    while (this.version !== this.savedVersion) {
      const version = this.version;
      const source = this.stored ?? remote;
      this.pendingRecovery ??= {
        key: `recovery:${this.pendingEdit?.owner ?? this.editOwner}`,
        title: this.title,
        source: {
          ...source,
          data: { ...source.data, title: `Recovered edits — ${this.title}`.slice(0, 190) },
        },
        json: yDocToProsemirrorJSON(this.doc) as JSONContent,
      };
      const recovery = this.pendingRecovery;
      const remember = () =>
        this.withMirror((mirror) => mirror.set(recovery.key, JSON.stringify(recovery)));
      await remember();
      const copy = await copyDocument(this.store, recovery.source, this.session, recovery.json, {
        reservation: recovery.reservation,
        onReserved: async (reserved) => {
          recovery.reservation = reserved;
          await remember();
        },
      });
      this.recoveredCopy = copy.url;
      this.pendingRecovery = undefined;
      await this.withMirror(async (mirror) => {
        await mirror.set("recoveredCopy", copy.url);
        await mirror.set(recovery.key, "");
      });
      if (this.version !== version) continue;
      if (this.title !== recovery.title) continue;
      if (JSON.stringify(yDocToProsemirrorJSON(this.doc)) !== JSON.stringify(recovery.json))
        continue;
      await this.clearPending(this.title);
      if (this.version !== version) continue;
      this.savedVersion = version;
      this.pendingEdit = undefined;
    }
  }
  private async replaceLog(remote: StoredDocument) {
    remote = await this.identify(remote);
    const targetMirror = incarnationMirror(
      remote,
      remote.data.updateLog ?? docContainerUrls(remote.url).updateLog,
    );
    this.switchingLog = true;
    this.notify();
    try {
      this.provider?.destroy();
      await this.provider?.flush();
      await this.preserveRetiredEdits(remote);
      await this.withMirror(async (mirror) => {
        await mirror.destroy();
      });
      // The editor can emit another edit while the old connection is closing.
      // Reopen it if needed so that edit is copied before replacing its Y.Doc.
      if (this.version !== this.savedVersion) {
        if (this.local) await this.restartMirror(this.local);
        await this.preserveRetiredEdits(remote);
      }
      this.mirrorGeneration++;
      this.doc.destroy();
      this.doc = new Doc();
      this.trackUpdates();
      this.stored = remote;
      this.title = remote.data.title;
      this.conflict = undefined;
      this.needsFullState = false;
      this.local = this.createMirror(targetMirror);
      await this.local.whenSynced;
      await this.readPending();
      this.checkTitleConflict();
      this.attachProvider(this.updateContainer(), false);
      await this.provider?.whenSynced;
      if (this.providerError) throw this.providerError;
      this.recordIdentity();
      const extensions = baseExtensions(this.session.fetch);
      this.json = yDocToProsemirrorJSON(this.doc) as JSONContent;
      this.body = generateHTML(this.json, extensions);
      // Also repair a stale snapshot written while the log pointer was changing.
      if (this.body !== remote.data.body) this.markDirty();
      await this.linkMirror(remote.url, this.local.name);
      this.notify();
    } finally {
      this.switchingLog = false;
      this.notify();
    }
  }

  private assertActive() {
    if (this.stopped) throw new DOMException("Document closed", "AbortError");
  }
  private async identify(stored: StoredDocument, recover = false) {
    if (stored.data.instanceId || stored.url.startsWith(this.store.legacyContainer)) return stored;
    // A legacy snapshot may already have an id in its log. Inspect it in
    // isolation before assigning one; never merge an unverified local mirror.
    const probe = new Doc();
    try {
      let id: unknown;
      try {
        for (const { update } of await new DocumentUpdateStore(
          stored.data.updateLog ?? docContainerUrls(stored.url).updateLog,
          this.session.fetch,
          async () => {},
          false,
        ).loadUpdates())
          applyUpdate(probe, update);
        id = probe.getMap("document").get("instanceId");
      } catch (error) {
        // Explicit recovery trusts the conditional snapshot, retiring an
        // unusable log. Ordinary opens must still require its complete history.
        if (!recover) throw error;
      }
      return await this.store.claimIdentity(
        stored,
        typeof id === "string" ? id : crypto.randomUUID(),
      );
    } finally {
      probe.destroy();
    }
  }
  async open(url?: string, recover = false) {
    this.assertActive();
    let pending: unknown;
    let cached: { webId: string; document: StoredDocument } | undefined;
    if (!recover || !url) {
      this.local = this.createMirror(url ?? `suite.docs.draft:${this.session.webId}`);
      await this.local.whenSynced;
      this.assertActive();
      pending = await this.readPending();
      const seen = new Set<string>();
      while (url && !pending && !seen.has(this.local.name)) {
        seen.add(this.local.name);
        const next: unknown = await this.local.get("nextMirror");
        if (typeof next !== "string") break;
        await this.local.destroy();
        this.mirrorGeneration++;
        this.doc.destroy();
        this.doc = new Doc();
        this.trackUpdates();
        this.local = this.createMirror(next);
        await this.local.whenSynced;
        this.assertActive();
        pending = await this.readPending();
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
    // Only a failed remote read can use an offline snapshot. An identity or
    // history validation failure must never turn a stale cache authoritative.
    if (this.stored && !this.offlineCopy) this.stored = await this.identify(this.stored, recover);
    this.assertActive();
    if (!this.stored) throw new Error("not-found");
    this.creation = "created";
    if (!pending) this.title = this.stored.data.title;
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
      this.recordIdentity();
      await this.checkLog(this.updateContainer());
      this.assertActive();
      await new SolidUpdateStore({ container, fetch: this.session.fetch }).appendUpdate(
        encodeStateAsUpdate(this.doc),
      );
      this.assertActive();
      this.stored = await this.store.save(
        this.stored,
        {
          updateLog: container,
          instanceId: this.recordIdentity(),
          revisionLabel: "Recovered last saved copy",
        },
        { regenerate: () => ({ body: this.body, format: "text/html" }) },
      );
      this.assertActive();
    }
    if (
      !recover &&
      !this.readOnly &&
      !this.offlineCopy &&
      ((cached?.document.data.updateLog ?? layout.updateLog) !== container ||
        (cached
          ? !sameIncarnation(cached.document, this.stored)
          : this.doc.getXmlFragment("prosemirror").length > 0 &&
            this.doc.getMap("document").get("instanceId") !== this.stored.data.instanceId))
    ) {
      const remote = this.stored;
      if (cached) this.stored = cached.document;
      await this.replaceLog(remote);
      pending = this.version !== this.savedVersion;
    }
    if (!recover && !this.readOnly && !this.offlineCopy) {
      const name = this.mirrorName(url, container);
      if (this.local?.name !== name) {
        const previous = this.local;
        this.mirrorGeneration++;
        this.local = this.createMirror(name);
        await this.local.whenSynced;
        if (pending) await this.writePending();
        else pending = await this.readPending();
        await storeState(this.local, true);
        if (previous) {
          const edit = this.pendingEdit;
          await updateMirrorMetadata(
            previous,
            (current) => (current.edit === JSON.stringify(edit) ? { pending: 0 } : undefined),
            () => !this.stopped,
          );
          await previous.destroy();
        }
      }
      await this.linkMirror(url, name);
    }
    this.checkTitleConflict();
    if (!this.readOnly && !this.offlineCopy && !this.provider) {
      const provider = this.attachProvider(container, false);
      // Keep the editor unmounted until the initial CRDT merge finishes. Replaying
      // the log must not race the first keyboard selection or a pending local edit.
      await provider.whenSynced;
      this.assertActive();
      if (this.providerError) throw this.providerError;
    }
    if (!this.readOnly && !this.offlineCopy) this.recordIdentity();
    // Legacy snapshots are view-only. Existing writable documents must hydrate
    // from their CRDT log, including when its visible content is empty.
    if (this.readOnly) {
      await this.local?.destroy();
      this.local = undefined;
      this.doc.destroy();
      this.doc = new Doc();
      this.seedSnapshot();
    }
    if (recover) {
      this.local = this.createMirror(this.mirrorName(url, container));
      await this.local.whenSynced;
      this.assertActive();
      await this.linkMirror(url, this.local.name);
    }
    this.recoveredCopy ??= (await this.local?.get("recoveredCopy")) as string | undefined;
    await this.cacheStored();
    this.assertActive();
    if (this.offlineCopy) this.scheduleRetry();
    this.state = this.conflict
      ? "failed"
      : this.version !== this.savedVersion || (this.provider && !this.provider.synced)
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
    if (this.stored?.data.instanceId)
      this.doc.getMap("document").set("instanceId", this.stored.data.instanceId);
  }
  private updateContainer() {
    const stored = this.stored as StoredDocument;
    const layout = docContainerUrls(stored.url);
    const container = stored.data.updateLog ?? layout.updateLog;
    if (!container.endsWith("/") || !isDirectChild(container.slice(0, -1), layout.container))
      throw new Error("Invalid update location");
    return container;
  }
  private recordIdentity(): string {
    const identity =
      this.stored?.data.instanceId ??
      (this.doc.getMap("document").get("instanceId") as string | undefined) ??
      crypto.randomUUID();
    if (this.doc.getMap("document").get("instanceId") !== identity) {
      this.doc.getMap("document").set("instanceId", identity);
      this.needsFullState = true;
    }
    return identity;
  }
  private checkTitleConflict() {
    if (this.stored && this.pendingEdit && this.title === this.pendingEdit.baseTitle) {
      // Body-only pending edits carry the old title as metadata, not local intent.
      this.title = this.stored.data.title;
      this.pendingEdit.title = this.title;
      this.pendingEdit.baseTitle = this.title;
      void this.writePending();
    }
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
    const raw = await this.withMirror((mirror) => mirror.get(key));
    return this.parseMetadata<T>(raw);
  }
  private parseMetadata<T>(raw: unknown): T | undefined {
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  private async cacheStored() {
    await this.withMirror(async (mirror) => {
      if (this.recoveredCopy) await mirror.set("recoveredCopy", this.recoveredCopy);
      if (this.stored)
        await mirror.set(
          "stored",
          JSON.stringify({ webId: this.session.webId, document: this.stored }),
        );
    });
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
  private async checkLog(container: string, expected = this.stored as StoredDocument) {
    const remote = await this.activeDocument();
    const active = remote.data.updateLog ?? docContainerUrls(remote.url).updateLog;
    if (active !== container || !sameIncarnation(expected, remote)) {
      const error = new InactiveLogError("The document has a new update log");
      this.pauseLog(error);
      throw error;
    }
  }
  private async reconcileProvider() {
    const remote = await this.activeDocument();
    const previous = this.provider?.store.container ?? this.updateContainer();
    const active = remote.data.updateLog ?? docContainerUrls(remote.url).updateLog;
    if (previous !== active || !sameIncarnation(this.stored as StoredDocument, remote)) {
      await this.replaceLog(remote);
      this.offlineCopy = false;
      this.trashed = false;
      return;
    }
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
    const expected = this.stored as StoredDocument;
    this.provider = new SolidPersistence({
      doc: this.doc,
      store: new DocumentUpdateStore(
        container,
        this.session.fetch,
        () => this.checkLog(container, expected),
        allowEmpty,
        this.stored?.data.instanceId,
      ),
    });
    this.provider.on("error", (error) => {
      this.providerError = error;
      this.needsFullState = true;
      this.state = "retrying";
      this.scheduleRetry();
      this.notify();
    });
    return this.provider;
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
      owner: this.pendingEdit?.owner ?? this.editOwner,
      title: this.title,
      baseTitle: this.pendingEdit?.baseTitle ?? this.stored?.data.title ?? this.title,
      baseModified: this.pendingEdit?.baseModified ?? this.stored?.data.modified,
    };
    this.version++;
    this.state = this.trashed ? "retrying" : "saving";
    void this.writePending().catch(() => {
      this.state = "retrying";
      this.scheduleRetry();
      this.notify();
    });
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
  private async write(replacements = 0): Promise<void> {
    try {
      await this.mirrorRestart;
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
          if (stored.data.instanceId)
            this.doc.getMap("document").set("instanceId", stored.data.instanceId);
          const mirrorName = incarnationMirror(stored, this.updateContainer());
          if (this.local?.name !== mirrorName) {
            this.draftMirror = this.local;
            this.local = this.createMirror(mirrorName);
          }
          await this.local.whenSynced;
          // Title edits may have arrived while create() was in flight. Move
          // their baseline and pending marker before deleting the draft mirror.
          if (this.pendingEdit) {
            this.pendingEdit.baseTitle = stored.data.title;
            this.pendingEdit.baseModified = stored.data.modified;
            await this.writePending();
          }
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
          await this.linkMirror(stored.url, this.local.name);
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
            { ...snapshot, title, instanceId: this.recordIdentity() },
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
        await this.withMirror((mirror) => storeState(mirror, true));
        await this.cacheStored();
        this.savedVersion = version;
        this.lastSaved = Date.now();
        if (this.version === version) {
          await this.clearPending((this.stored as StoredDocument).data.title);
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
    } catch (failure) {
      let error = failure;
      if (error instanceof DocumentReplacedError && replacements < 3) {
        try {
          await this.reconcileProvider();
          return await this.write(replacements + 1);
        } catch (cause) {
          error = cause;
        }
      }
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
    // Upgrade identity-free logs only on save, retaining an existing snapshot
    // identity (or the log's identity when migrating an older snapshot).
    if (this.stored?.data.instanceId) this.recordIdentity();
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
    if (
      !sameIncarnation(this.stored, remote) ||
      (remote.data.updateLog ?? docContainerUrls(remote.url).updateLog) !== this.updateContainer()
    ) {
      await this.replaceLog(remote);
      await this.flush();
      return;
    }
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
        await this.mirrorRestart;
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
