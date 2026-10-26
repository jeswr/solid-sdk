// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
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
  async open(url?: string, recover = false) {
    if (!url) {
      this.local = new IndexeddbPersistence(`suite.docs.draft:${this.session.webId}`, this.doc);
      await this.local.whenSynced;
      if (await this.local.get("pending")) {
        const title = await this.local.get("title");
        if (typeof title === "string") this.title = title;
        this.version++;
      }
      return;
    }
    this.stored = await this.store.read(url);
    if (!this.stored) throw new Error("not-found");
    this.title = this.stored.data.title;
    this.body = this.stored.data.body;
    this.lastSaved = Date.parse(this.stored.data.modified ?? new Date().toISOString());
    this.readOnly = url.startsWith(this.store.legacyContainer);
    const layout = docContainerUrls(url);
    let container = this.stored.data.updateLog ?? layout.updateLog;
    // Stored metadata never gets to redirect the authenticated update provider elsewhere.
    if (!container.endsWith("/") || !isDirectChild(container.slice(0, -1), layout.container))
      throw new Error("Invalid update location");
    if (recover) {
      container = `${layout.container}updates-${Date.now()}/`;
      await createSolidDriveClient({
        storageUrl: this.session.storageUrl,
        fetch: this.session.fetch,
      }).createFolder(container);
      this.stored = await this.store.save(
        this.stored,
        { updateLog: container, revisionLabel: "Recovered last saved copy" },
        { regenerate: () => ({ body: this.body, format: "text/html" }) },
      );
    }
    if (!recover) {
      this.local = new IndexeddbPersistence(url, this.doc);
      await this.local.whenSynced;
      if (await this.local.get("pending")) {
        const localTitle = await this.local.get("title");
        if (typeof localTitle === "string") this.title = localTitle;
        this.version++;
        this.needsFullState = true;
      }
    }
    if (!this.readOnly) {
      this.attachProvider(container);
      // A populated local mirror can render immediately while the remote log is loading.
      if (this.doc.getXmlFragment("prosemirror").length === 0) await this.provider?.whenSynced;
      else
        void this.provider?.whenSynced.catch(() => {
          this.state = "retrying";
          this.notify();
        });
      if (this.providerError) throw this.providerError;
    }
    if (this.doc.getXmlFragment("prosemirror").length === 0) {
      const extensions = baseExtensions(this.session.fetch);
      const seed = prosemirrorJSONToYDoc(
        getSchema(extensions),
        generateJSON(this.body || "<p></p>", extensions),
        "prosemirror",
      );
      applyUpdate(this.doc, encodeStateAsUpdate(seed));
      seed.destroy();
    }
    if (recover) {
      await clearDocument(url);
      this.local = new IndexeddbPersistence(url, this.doc);
      await this.local.whenSynced;
    }
    this.state = this.version || (this.provider && !this.provider.synced) ? "saving" : "saved";
  }
  private attachProvider(container: string) {
    this.provider = new SolidPersistence({ doc: this.doc, container, fetch: this.session.fetch });
    this.provider.on("synced", () => {
      if (this.version === this.savedVersion && !this.providerError) {
        this.state = "saved";
        this.notify();
      }
    });
    this.provider.on("error", (error) => {
      this.providerError = error;
      this.state = "retrying";
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
    if (!this.stored && !this.title) this.title = deriveTitle(json);
    this.markDirty();
    if (!this.stored) void this.flush();
  }
  rename(title: string) {
    if (this.readOnly || this.title === title) return;
    this.title = title.slice(0, 200);
    this.markDirty();
    void this.flush();
  }
  private markDirty() {
    this.version++;
    this.state = "saving";
    void this.local?.set("pending", 1);
    void this.local?.set("title", this.title);
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
    if (this.version === this.savedVersion) {
      await this.provider?.flush();
      return;
    }
    if (this.tail) return this.tail;
    this.tail = this.write().finally(() => {
      this.tail = undefined;
    });
    return this.tail;
  }
  private async write() {
    try {
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
        if (!this.stored) {
          this.stored = await this.store.create({ ...snapshot, title });
          const draftMirror = this.local;
          this.local = new IndexeddbPersistence(this.stored.url, this.doc);
          await this.local.whenSynced;
          this.attachProvider(this.stored.data.updateLog as string);
          await this.provider?.whenSynced;
          await this.provider?.persistFullState();
          if (draftMirror) await draftMirror.clearData();
          this.onCreated(this.stored.url);
        } else {
          this.stored = await this.store.save(
            this.stored,
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
        if (this.title === title) this.title = this.stored.data.title;
        if (this.providerError || this.needsFullState) {
          // Failed incremental writes remain in IndexedDB; reconcile with one full update.
          this.providerError = undefined;
          this.needsFullState = false;
          await this.provider?.persistFullState();
        }
        await this.provider?.flush();
        if (this.providerError) throw this.providerError;
        if (this.local) await storeState(this.local, true);
        this.savedVersion = version;
        this.lastSaved = Date.now();
        if (this.version === version) await this.local?.set("pending", 0);
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
        if (this.state === "retrying" && !this.stopped)
          this.timer = setTimeout(() => void this.flush(), 4000);
      }
    }
    this.notify();
  }
  async resolveTitle(keepMine: boolean) {
    if (!this.stored || !this.conflict) return;
    const remote = await this.store.read(this.stored.url);
    if (!remote) return;
    if (!keepMine) this.title = remote.data.title;
    this.stored = remote;
    this.conflict = undefined;
    this.markDirty();
    await this.flush();
  }
  async reconnect() {
    this.online = true;
    try {
      await this.provider?.sync();
      if (this.provider && this.version !== this.savedVersion)
        await this.provider.persistFullState();
      await this.flush();
    } catch {
      this.state = "retrying";
      this.notify();
    }
  }
  async destroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
    await this.provider?.flush();
    this.provider?.destroy();
    await this.local?.destroy();
    this.doc.destroy();
  }
}
