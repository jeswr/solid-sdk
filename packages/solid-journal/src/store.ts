// AUTHORED-BY Codex (GPT-6.1 Sol)
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  ENTRY_CLASS,
  type EntryData,
  entryEntity,
  serializeEntry,
  validateEntry,
} from "./model.js";
import { protectJournal, verifyJournalResource } from "./privacy.js";

export interface JournalEntry extends EntryData {
  url: string;
  etag: string | null;
}
export interface JournalStore {
  readonly container: string;
  initialize(): Promise<void>;
  list(): Promise<JournalEntry[]>;
  save(data: EntryData, existing?: JournalEntry): Promise<JournalEntry>;
  remove(entry: JournalEntry): Promise<void>;
  attach(file: Blob): Promise<string>;
  photo(url: string): Promise<Blob>;
}
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export function validatePhoto(file: Blob): void {
  if (!PHOTO_TYPES.has(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024)
    throw new TypeError("Choose a JPG, PNG, WebP or GIF photo up to 10 MB");
}

/** Accepts public storage/index interfaces so consumers can test without HTTP or authentication. */
export function createJournalStore(
  storage: StorageClient,
  index: TypeIndex,
  owner: string,
  fetch: typeof globalThis.fetch,
): JournalStore {
  const interrupted = new WeakMap<EntryData, string>();
  let container = new URL("journal/", storage.root).href;
  const privacy = (created = false) => protectJournal(storage, container, owner, fetch, created);
  const owned = (url: string) => {
    const canonical = assertWithinPodScope(container, url, { allowRoot: false });
    if (canonical !== url || new URL(url).search || new URL(url).hash)
      throw new TypeError("Resource is outside your journal");
  };
  return {
    get container() {
      return container;
    },
    async initialize() {
      let created = false;
      try {
        await storage.head(container);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
        try {
          container = (
            await storage.create(storage.root, null, { name: "journal", kind: "container" })
          ).url;
          created = true;
        } catch (cause) {
          if (!(cause instanceof StorageError) || cause.code !== "conflict") throw cause;
          await storage.head(container);
        }
      }
      await privacy(created);
      await index.register(ENTRY_CLASS, { container }, { index: "private" });
    },
    async list() {
      await privacy();
      const entries: JournalEntry[] = [];
      for await (const item of storage.listAll(container, { maxBytes: 4 * 1024 * 1024 })) {
        if (item.kind === "container" || !new URL(item.url).pathname.endsWith(".ttl")) continue;
        owned(item.url);
        await verifyJournalResource(storage, item.url, owner, fetch);
        const read = await storage.readRdf(item.url);
        if (read.dataset.size === 0) continue; // An interrupted creation has no journal content.
        const data = entryEntity.parse(item.url, read.dataset);
        if (!data)
          throw new Error("A journal entry couldn't be read. Your data has not been changed.");
        entries.push({ ...data, url: item.url, etag: read.etag });
      }
      return entries.sort(
        (a, b) => b.created.getTime() - a.created.getTime() || a.url.localeCompare(b.url),
      );
    },
    async save(data, existing) {
      const clean = validateEntry(data);
      await privacy();
      if (existing) {
        owned(existing.url);
        await verifyJournalResource(storage, existing.url, owner, fetch);
        if (!existing.etag) throw new Error("Reload this entry before editing it");
        const result = await storage.write(
          existing.url,
          await serializeEntry(existing.url, clean),
          { contentType: "text/turtle", ifMatch: existing.etag },
        );
        return {
          ...clean,
          url: result.url,
          etag: result.etagSource === "response" ? result.etag : null,
        };
      }
      // Retain the returned URL after an interrupted write so retry cannot duplicate a
      // committed entry whose response was lost. Successful saves release this identity.
      let url = interrupted.get(data);
      if (!url) {
        const created = await storage.create(container, "", {
          name: `${crypto.randomUUID()}.ttl`,
          contentType: "text/turtle",
        });
        owned(created.url);
        url = created.url;
        interrupted.set(data, url);
      }
      owned(url);
      const empty = await storage.read(url);
      const body = await empty.text();
      const turtle = await serializeEntry(url, clean);
      if (!empty.etag) throw new Error("Couldn't create an empty journal entry safely");
      if (body.length) {
        const recovered = await entryEntity.parseDocument(url, body, empty.contentType);
        if (!recovered || (await serializeEntry(url, recovered)) !== turtle)
          throw new Error("The interrupted journal entry changed. Reload before trying again.");
        interrupted.delete(data);
        return { ...recovered, url, etag: empty.etag };
      }
      const result = await storage.write(url, turtle, {
        contentType: "text/turtle",
        ifMatch: empty.etag,
      });
      interrupted.delete(data);
      return {
        ...clean,
        url: result.url,
        etag: result.etagSource === "response" ? result.etag : null,
      };
    },

    async remove(entry) {
      owned(entry.url);
      if (!entry.etag) throw new Error("Reload this entry before deleting it");
      await privacy();
      await verifyJournalResource(storage, entry.url, owner, fetch);
      await storage.delete(entry.url, { ifMatch: entry.etag });
    },
    async attach(file) {
      validatePhoto(file);
      await privacy();
      const extension = file.type.slice(6).replace("jpeg", "jpg");
      const result = await storage.create(container, file, {
        name: `${crypto.randomUUID()}.${extension}`,
        contentType: file.type,
      });
      owned(result.url);
      return result.url;
    },
    async photo(url) {
      owned(url);
      await privacy();
      await verifyJournalResource(storage, url, owner, fetch);
      const read = await storage.read(url);
      if (!PHOTO_TYPES.has(read.contentType?.split(";")[0] ?? ""))
        throw new Error("This attachment isn't a supported photo");
      const blob = await read.blob();
      validatePhoto(blob);
      return blob;
    },
  };
}

export async function openJournal(
  fetch: typeof globalThis.fetch,
  storageUrl: string,
  owner: string,
  options: { solidFixture?: boolean } = {},
): Promise<JournalStore> {
  // Explicit fixture mode: the browser demo implements LDP but no discovery document.
  if (options.solidFixture) {
    const storage = createSolidBackend({ fetch, root: storageUrl });
    return createJournalStore(
      storage,
      createTypeIndex({ storage, features: storage.features, profile: owner, fetch }),
      owner,
      fetch,
    );
  }
  const client = await createPodClient({ fetch, storage: storageUrl });
  if (client.description.protocol !== "solid")
    throw new Error("Private journal provisioning currently needs a Solid pod");
  const index = createTypeIndex({
    storage: client.storage,
    features: client.features,
    profile: owner,
    fetch,
  });
  return createJournalStore(client.storage, index, owner, fetch);
}
