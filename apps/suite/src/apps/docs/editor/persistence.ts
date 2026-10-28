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
  type BuildDocumentInput,
  createDocsStore,
  type DocsStore,
  docContainerUrls,
  documentUpdateLocation,
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
import { draftMirrorName, withDraftLock } from "./drafts";
import { baseExtensions } from "./extensions";
import { loadPersistedLocalState } from "./local-state";
import { updateMirrorMetadata } from "./mirror-metadata";
import { DocumentUpdateStore } from "./update-store";

class InactiveLogError extends Error {}

interface PendingEdit {
  owner?: string;
  title: string;
  baseTitle: string | undefined;
  baseModified: string | undefined;
}
interface PendingRecovery {
  key: string;
  title: string;
  source: StoredDocument;
  json: JSONContent;
  reservation?: StoredDocument;
  update?: number[];
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
  /** The last snapshot this publisher wrote, distinct from remote reconciliation. */
  lastTitleSave: StoredDocument | undefined;
  /** A foreign rename remains observable even if a later body save includes it. */
  lastRemoteTitle: StoredDocument | undefined;
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
  private readonly previousMirrors = new Set<IndexeddbPersistence>();
  private readonly mirrorChannels = new WeakMap<IndexeddbPersistence, BroadcastChannel>();
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
  private opened = false;
  private needsFullState = false;
  private providerError: Error | undefined;
  private updates = 0;
  private bytes = 0;
  notify = () => {};
  onCreated: (url: string) => void = () => {};
  constructor(
    readonly session: PodSession,
    readonly draftId = crypto.randomUUID(),
  ) {
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
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(
        `suite.docs:${JSON.stringify([this.session.webId, name])}`,
      );
      this.mirrorChannels.set(mirror, channel);
      channel.onmessage = () => {
        if (
          !this.opened ||
          this.stopped ||
          (mirror !== this.local && !this.previousMirrors.has(mirror))
        )
          return;
        void this.refreshLocalState()
          .then(() => {
            if (this.stopped) return;
            this.notify();
            return this.flush();
          })
          .catch(() => {
            if (this.stopped) return;
            this.state = "retrying";
            this.scheduleRetry();
            this.notify();
          });
      };
      const destroy = mirror.destroy.bind(mirror);
      mirror.destroy = () => {
        channel.close();
        return destroy();
      };
    }
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
      const result = await action(mirror);
      return generation === this.mirrorGeneration ? result : undefined;
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
    if (!this.stopped && generation === this.mirrorGeneration && this.local)
      this.mirrorChannels.get(this.local)?.postMessage(null);
  }
  private async clearPending(title: string, confirmed: Uint8Array) {
    const generation = this.mirrorGeneration;
    let cleared = await this.withMirror((mirror) =>
      updateMirrorMetadata(
        mirror,
        (current) => {
          const pending = this.parseMetadata<PendingEdit>(current.edit)?.title ?? current.title;
          return pending === title ? { pending: 0 } : undefined;
        },
        () => generation === this.mirrorGeneration,
        confirmed,
      ),
    );
    for (const mirror of this.previousMirrors) {
      const acknowledged = await updateMirrorMetadata(
        mirror,
        (current) => {
          const edit = this.parseMetadata<PendingEdit>(current.edit);
          const pendingTitle = edit?.title ?? current.title;
          if (current.pending && pendingTitle !== title && pendingTitle !== edit?.baseTitle)
            return undefined;
          return {
            pending: 0,
            ...(mirror === this.draftMirror
              ? { promoted: (this.stored as StoredDocument).url }
              : {}),
          };
        },
        () => generation === this.mirrorGeneration,
        confirmed,
      );
      if (acknowledged) {
        if (mirror === this.draftMirror) this.draftMirror = undefined;
      } else cleared = false;
    }
    return cleared;
  }
  private captureDoc() {
    this.json = yDocToProsemirrorJSON(this.doc) as JSONContent;
    this.body = generateHTML(this.json, baseExtensions(this.session.fetch));
  }
  /** All publishers refresh the same durable state, including retired draft mirrors. */
  private async refreshLocalState(adoptPending = true) {
    const before = this.updates;
    await this.loadPreviousMirrors();
    const changed = await this.withMirror((mirror) => loadPersistedLocalState(this.doc, mirror));
    if (adoptPending && this.version === this.savedVersion) await this.readPending(false);
    let merged = changed;
    for (const mirror of this.previousMirrors) {
      merged = (await loadPersistedLocalState(this.doc, mirror)) || merged;
      if (adoptPending && this.version === this.savedVersion) await this.readPending(false, mirror);
    }
    if (merged || this.updates !== before) {
      this.captureDoc();
      this.version++;
      this.needsFullState = true;
      this.state = "saving";
    }
  }
  private async loadPreviousMirrors() {
    const mirrors = [this.local, ...this.previousMirrors];
    const seen = new Set(mirrors.map((mirror) => mirror?.name));
    for (const parent of mirrors) {
      const names = this.parseMetadata<unknown>(await parent?.get("previousMirrors"));
      if (!Array.isArray(names)) continue;
      for (const name of names) {
        if (typeof name !== "string" || seen.has(name)) continue;
        seen.add(name);
        const mirror = this.createMirror(name);
        this.previousMirrors.add(mirror);
        mirrors.push(mirror);
        await mirror.whenSynced;
      }
    }
  }
  private async rememberPreviousMirrors() {
    await this.loadPreviousMirrors();
    await this.withMirror((mirror) =>
      mirror.set(
        "previousMirrors",
        JSON.stringify(Array.from(this.previousMirrors, (previous) => previous.name)),
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
  private async recoverRetiredMirrors() {
    if (this.creation !== "created" || !this.stored || !this.local) return;
    // The first promotion has not finished linking or caching its own mirror.
    // Only a hydrated publisher can distinguish it from retired generations.
    if (!(await this.metadata("stored"))) return;
    const url = this.stored.url;
    const seen = new Set<string>();
    const names = [url];
    // A retired tab can write after recovery has finished. Walk the durable
    // forward chain on every publisher, even when no broadcast reached us.
    for (const name of names) {
      if (name === this.local.name || seen.has(name)) continue;
      seen.add(name);
      const doc = new Doc();
      const mirror = new IndexeddbPersistence(name, doc);
      let pending: boolean;
      let next: unknown;
      let previous: unknown;
      try {
        await mirror.whenSynced;
        pending = Boolean(await mirror.get("pending"));
        next = await mirror.get("nextMirror");
        previous = this.parseMetadata<unknown>(await mirror.get("previousMirrors"));
      } finally {
        await mirror.destroy();
        doc.destroy();
      }
      if (pending && !Array.from(this.previousMirrors).some((mirror) => mirror.name === name)) {
        // Reuse the opener's incarnation checks and durable recovery reservation
        // on a separate Y.Doc: retired histories must not seed the active log.
        const recovery = new DocumentPersistence(this.session);
        try {
          await recovery.open(url);
          if (recovery.conflict) throw recovery.conflict;
          if (recovery.recoveredCopy) {
            this.recoveredCopy = recovery.recoveredCopy;
            await this.cacheStored();
          }
        } finally {
          recovery.online = false;
          await recovery.destroy();
        }
      }
      if (typeof next === "string") names.push(next);
      if (Array.isArray(previous))
        for (const parent of previous) if (typeof parent === "string") names.push(parent);
    }
  }
  private async readPending(assertOpen = true, mirror = this.local): Promise<boolean> {
    const pending = Boolean(await mirror?.get("pending"));
    if (assertOpen) this.assertActive();
    if (pending) {
      this.pendingEdit = this.parseMetadata<PendingEdit>(await mirror?.get("edit"));
      // The last pending edit may belong to another tab. Its owner is not
      // necessarily the one that already reserved this incarnation's copy.
      const recoveryKey: unknown = await mirror?.get("activeRecovery");
      this.pendingRecovery ??= this.parseMetadata<PendingRecovery>(
        await mirror?.get(
          typeof recoveryKey === "string" && recoveryKey
            ? recoveryKey
            : `recovery:${this.pendingEdit?.owner ?? this.editOwner}`,
        ),
      );
      const title = this.pendingEdit?.title ?? (await mirror?.get("title"));
      if (typeof title === "string") this.title = title;
      this.version++;
      this.needsFullState = true;
    } else if (mirror === this.local) {
      for (const previous of this.previousMirrors) {
        const pending = await this.readPending(assertOpen, previous);
        if (pending) return pending;
      }
    }
    return pending;
  }
  private async preserveRetiredEdits(remote: StoredDocument) {
    await this.refreshLocalState();
    while (this.version !== this.savedVersion) {
      await this.refreshLocalState();
      const version = this.version;
      const source = this.stored ?? remote;
      const json = yDocToProsemirrorJSON(this.doc) as JSONContent;
      const confirmed = encodeStateAsUpdate(this.doc);
      const prior = this.pendingRecovery;
      this.pendingRecovery = {
        key: prior?.key ?? `recovery:${this.pendingEdit?.owner ?? this.editOwner}`,
        title: this.title,
        source: {
          ...source,
          data: { ...source.data, title: `Recovered edits — ${this.title}`.slice(0, 190) },
        },
        json,
        ...(prior?.reservation ? { reservation: prior.reservation } : {}),
        ...(prior?.update ? { update: prior.update } : {}),
      };
      const recovery = this.pendingRecovery;
      const remember = () =>
        this.withMirror(async (mirror) => {
          await mirror.set(recovery.key, JSON.stringify(recovery));
          await mirror.set("activeRecovery", recovery.key);
        });
      await remember();
      const copy = await copyDocument(this.store, recovery.source, this.session, recovery.json, {
        recovery: {
          update: recovery.update,
          onUpdate: async (update) => {
            recovery.update = update;
            await remember();
          },
        },
        reservation: recovery.reservation,
        onReserved: async (reserved) => {
          recovery.reservation = reserved;
          await remember();
        },
      });
      this.recoveredCopy = copy.url;
      recovery.reservation = copy;
      await remember();
      await this.withMirror((mirror) => mirror.set("recoveredCopy", copy.url));
      await this.refreshLocalState();
      if (this.version !== version) continue;
      if (this.title !== recovery.title) continue;
      if (JSON.stringify(yDocToProsemirrorJSON(this.doc)) !== JSON.stringify(recovery.json))
        continue;
      // Compare the persisted updates and clear the marker in one transaction;
      // a closed tab's late write must stay pending until it too is recovered.
      if (!(await this.clearPending(this.title, confirmed))) {
        await this.readPending();
        continue;
      }
      if (this.version !== version) continue;
      this.pendingRecovery = undefined;
      await this.withMirror(async (mirror) => {
        await mirror.set(recovery.key, "");
        await mirror.set("activeRecovery", "");
      });
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
      for (const mirror of this.previousMirrors) await mirror.destroy();
      this.previousMirrors.clear();
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
    return this.store.claimIdentity(stored, undefined, { requireHistory: true, recover });
  }
  async open(url?: string, recover = false) {
    this.assertActive();
    let pending: unknown;
    let cached: { webId: string; document: StoredDocument } | undefined;
    if (!recover || !url) {
      this.local = this.createMirror(url ?? draftMirrorName(this.session.webId, this.draftId));
      await this.local.whenSynced;
      this.assertActive();
      await this.loadPreviousMirrors();
      this.assertActive();
      if (!url) {
        const promoted: unknown = await this.local.get("promoted");
        if (typeof promoted === "string") {
          await this.local.destroy();
          this.mirrorGeneration++;
          this.doc.destroy();
          this.doc = new Doc();
          this.trackUpdates();
          await this.open(promoted);
          this.onCreated(promoted);
          return;
        }
      }
      pending = await this.readPending();
      const seen = new Set<string>();
      while (url && !pending && !seen.has(this.local.name)) {
        seen.add(this.local.name);
        const next: unknown = await this.local.get("nextMirror");
        if (typeof next !== "string") break;
        await this.local.destroy();
        for (const mirror of this.previousMirrors) await mirror.destroy();
        this.previousMirrors.clear();
        this.mirrorGeneration++;
        this.doc.destroy();
        this.doc = new Doc();
        this.trackUpdates();
        this.local = this.createMirror(next);
        await this.local.whenSynced;
        this.assertActive();
        await this.loadPreviousMirrors();
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
        this.json = yDocToProsemirrorJSON(this.doc) as JSONContent;
        this.body = generateHTML(this.json, baseExtensions(this.session.fetch));
        this.opened = true;
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
          if (pending) this.previousMirrors.add(previous);
          else await previous.destroy();
        }
        await this.rememberPreviousMirrors();
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
    if (!this.readOnly) {
      await this.refreshLocalState();
      if (this.version !== this.savedVersion) this.captureDoc();
    }
    if (this.offlineCopy) this.scheduleRetry();
    this.state = this.conflict
      ? "failed"
      : this.version !== this.savedVersion || (this.provider && !this.provider.synced)
        ? "saving"
        : "saved";
    this.opened = true;
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
    return documentUpdateLocation(this.stored as StoredDocument);
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
  private async reconcileProvider(allowStopped = false) {
    const remote = await this.activeDocument();
    const known = this.stored as StoredDocument;
    if (
      (remote.etag !== known.etag || !sameIncarnation(known, remote)) &&
      remote.data.title !== known.data.title
    )
      this.lastRemoteTitle = remote;
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
      this.attachProvider(container, false, allowStopped);
      await this.provider?.whenSynced;
      if (this.providerError) throw this.providerError;
    }
    this.trashed = false;
  }
  private attachProvider(container: string, allowEmpty = true, allowStopped = false) {
    if (!allowStopped) this.assertActive();
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
  rename(title: string, baseTitle = this.stored?.data.title) {
    if (this.readOnly || this.title === title) return;
    this.title = title.slice(0, 200);
    this.markDirty(baseTitle);
    void this.flush();
  }
  private async recordTitleSave(stored: StoredDocument) {
    this.lastTitleSave = stored;
    if (this.pendingEdit) {
      if (this.pendingEdit.title === this.pendingEdit.baseTitle)
        this.pendingEdit.title = stored.data.title;
      this.pendingEdit.baseTitle = stored.data.title;
      this.pendingEdit.baseModified = stored.data.modified;
      await this.writePending();
    }
  }
  private markDirty(baseTitle = this.stored?.data.title) {
    this.pendingEdit = {
      owner: this.pendingEdit?.owner ?? this.editOwner,
      title: this.title,
      // A never-promoted draft has no pod baseline. Its first typed title is
      // local intent, including when another tab has already promoted it.
      baseTitle: this.pendingEdit ? this.pendingEdit.baseTitle : baseTitle,
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
    if (this.tail) return this.tail;
    const write = () => this.write();
    this.tail = (
      this.creation === "created"
        ? write()
        : withDraftLock(draftMirrorName(this.session.webId, this.draftId), write)
    ).finally(() => {
      this.tail = undefined;
    });
    return this.tail;
  }
  private async write(replacements = 0): Promise<void> {
    try {
      await this.mirrorRestart;
      await this.refreshLocalState();
      if (this.creation === "draft" && this.version === this.savedVersion) return;
      if (this.creation === "created") await this.reconcileProvider(this.stopped);
      await this.recoverRetiredMirrors();
      if (this.savedVersion === this.version) {
        await this.persistUpdates();
        await this.cacheStored();
      }
      while (this.savedVersion !== this.version) {
        await this.refreshLocalState();
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
            // A second opener may have promoted this same draft while this
            // writer waited for the promotion lock. Join that reservation.
            let allocation = await this.metadata<BuildDocumentInput>("allocation");
            if (!allocation) {
              allocation = { ...snapshot, title, instanceId: crypto.randomUUID() };
              await this.withMirror((mirror) =>
                mirror.set("allocation", JSON.stringify(allocation)),
              );
            }
            const creating = await this.metadata<StoredDocument>("creating");
            this.stored = creating ?? (await this.store.create(allocation));
            if (!creating) await this.recordTitleSave(this.stored);
            this.creation = "creating";
            if (creating) {
              // Joining another tab's promotion does not establish a pod base
              // for the title this tab typed while it still held a blank draft.
              this.checkTitleConflict();
              if (this.conflict) throw this.conflict;
            }
            await this.local?.set("creating", JSON.stringify(this.stored));
          }
          const stored = this.stored as StoredDocument;
          if (stored.data.instanceId)
            this.doc.getMap("document").set("instanceId", stored.data.instanceId);
          const mirrorName = incarnationMirror(stored, this.updateContainer());
          if (this.local?.name !== mirrorName) {
            this.draftMirror = this.local;
            if (this.draftMirror) this.previousMirrors.add(this.draftMirror);
            this.local = this.createMirror(mirrorName);
          }
          await this.local.whenSynced;
          // A tab can keep editing the draft after promotion. Retain its
          // mirror and lineage so reconnects and reloads still discover it.
          await this.rememberPreviousMirrors();
          // Title edits may have arrived while create() was in flight. Move
          // their baseline and pending marker before acknowledging promotion.
          if (this.pendingEdit) {
            this.pendingEdit.baseTitle = stored.data.title;
            this.pendingEdit.baseModified = stored.data.modified;
            await this.writePending();
          }
          if (!this.provider?.synced) {
            this.attachProvider(this.updateContainer(), true, this.stopped);
            await this.provider?.whenSynced;
          }
          await this.refreshLocalState();
          await this.provider?.persistFullState();
          this.needsFullState = false;
          this.providerError = undefined;
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
            await this.recordTitleSave(this.stored);
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
          await this.recordTitleSave(this.stored);
        }
        if (this.title === title) this.title = (this.stored as StoredDocument).data.title;
        // A concurrent snapshot/recovery may have changed the pointer during save.
        await this.reconcileProvider(this.stopped);
        const confirmed = await this.persistUpdates();
        await this.withMirror((mirror) => storeState(mirror, true));
        await this.cacheStored();
        this.savedVersion = version;
        this.lastSaved = Date.now();
        if (this.version === version) {
          if (!confirmed) throw new Error("Document updates were not persisted");
          const cleared = await this.clearPending(
            (this.stored as StoredDocument).data.title,
            confirmed,
          );
          if (cleared) this.pendingEdit = undefined;
          else {
            await this.refreshLocalState(false);
            const current = encodeStateAsUpdate(this.doc);
            if (
              this.version === this.savedVersion &&
              (current.length !== confirmed.length ||
                current.some((byte, index) => byte !== confirmed[index]))
            ) {
              this.captureDoc();
              this.version++;
              this.needsFullState = true;
            }
          }
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
    await this.recoverRetiredMirrors();
    await this.refreshLocalState();
    // Upgrade identity-free logs only on save, retaining an existing snapshot
    // identity (or the log's identity when migrating an older snapshot).
    if (this.stored?.data.instanceId) this.recordIdentity();
    const confirmed = encodeStateAsUpdate(this.doc);
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
    return this.provider ? confirmed : undefined;
  }
  async resolveTitle(keepMine: boolean) {
    if (!this.stored || !this.conflict) return;
    await this.refreshLocalState();
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
    // Apply the explicit title choice to every mirror carrying that intent.
    // Otherwise a retained draft marker would reintroduce the rejected title.
    const rejectedTitle = this.conflict.localTitle;
    for (const mirror of [this.local, ...this.previousMirrors]) {
      if (!mirror) continue;
      await updateMirrorMetadata(
        mirror,
        (current) => {
          const edit = this.parseMetadata<PendingEdit>(current.edit);
          if (!current.pending || (edit?.title ?? current.title) !== rejectedTitle)
            return undefined;
          return {
            title: this.title,
            edit: JSON.stringify({
              ...edit,
              title: this.title,
              baseTitle: remote.data.title,
              baseModified: remote.data.modified,
            }),
          };
        },
        () => true,
      );
    }
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
      await this.refreshLocalState();
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
        if (this.opened) await this.flush();
        await this.provider?.flush();
      } finally {
        this.provider?.destroy();
        await this.local?.destroy();
        await this.draftMirror?.destroy();
        for (const mirror of this.previousMirrors) await mirror.destroy();
        this.doc.destroy();
      }
    })();
    return this.destroyed;
  }
}

/** Shared non-editor loader: validate the incarnation and replay its durable log. */
export async function loadDocumentContent(
  resource: string,
  session: PodSession,
  expected?: StoredDocument,
): Promise<JSONContent> {
  const runtime = new DocumentPersistence(session);
  try {
    await runtime.open(resource);
    if (expected && !sameIncarnation(expected, runtime.stored as StoredDocument))
      throw new DocumentReplacedError();
    return yDocToProsemirrorJSON(runtime.doc) as JSONContent;
  } finally {
    runtime.online = false;
    await runtime.destroy();
  }
}
