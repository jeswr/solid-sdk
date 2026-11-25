// AUTHORED-BY Codex (GPT-6.1 Sol)
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
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
import { JournalPrivacyError, protectJournal, verifyJournalResource } from "./privacy.js";
import { privateJournalIndex } from "./registration.js";

export interface JournalEntry extends EntryData {
  url: string;
  etag: string | null;
}
export interface JournalStore {
  readonly container: string;
  readonly registrationWarning?: string | undefined;
  initialize(): Promise<void>;
  makePrivate(): Promise<void>;
  list(options?: { onPrivacySkip?: (url: string) => void }): Promise<JournalEntry[]>;
  read(url: string): Promise<JournalEntry>;
  save(data: EntryData, existing?: JournalEntry): Promise<JournalEntry>;
  remove(entry: JournalEntry): Promise<void>;
  attach(file: Blob): Promise<string>;
  photo(url: string): Promise<Blob>;
}
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const ENTRY_MAX_BYTES = 16 * 1024 * 1024;
export function validatePhoto(file: Blob): void {
  if (!PHOTO_TYPES.has(file.type) || file.size === 0 || file.size > PHOTO_MAX_BYTES)
    throw new TypeError("Choose a JPG, PNG, WebP or GIF photo up to 10 MB");
}

/** Accepts public storage/index interfaces so consumers can test without HTTP or authentication. */
export function createJournalStore(
  storage: StorageClient,
  index: TypeIndex | null,
  owner: string,
  fetch: typeof globalThis.fetch,
): JournalStore {
  const interrupted = new WeakMap<EntryData, { url: string; etag: string | null }>();
  let container = new URL("journal/", storage.root).href;
  let registrationWarning: string | undefined;
  const privacy = (created = false) => protectJournal(storage, container, owner, fetch, created);
  const owned = (url: string) => {
    const canonical = assertWithinPodScope(container, url, { allowRoot: false });
    if (
      canonical !== url ||
      new URL(url).search ||
      new URL(url).hash ||
      new URL(".", url).href !== container
    )
      throw new TypeError("Resource is outside your journal");
  };
  const readEntry = async (url: string): Promise<JournalEntry | null> => {
    owned(url);
    await verifyJournalResource(storage, url, owner, fetch);
    const read = await storage.readRdf(url, { maxBytes: ENTRY_MAX_BYTES });
    if (read.dataset.size === 0) return null;
    const data = entryEntity.parse(url, read.dataset);
    if (!data) throw new Error("A journal entry couldn't be read. Your data has not been changed.");
    return { ...data, url, etag: read.etag };
  };
  return {
    get container() {
      return container;
    },
    get registrationWarning() {
      return registrationWarning;
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
      registrationWarning = undefined;
      try {
        await index?.register(ENTRY_CLASS, { container }, { index: "private" });
      } catch (error) {
        if (error instanceof JournalPrivacyError) registrationWarning = error.message;
        else if (error instanceof StorageError && error.code === "invalid-response")
          registrationWarning =
            "Journal registration needs a valid private Type Index and preferences document.";
        else throw error;
      }
    },
    async makePrivate() {
      await privacy(true);
    },
    async list(options) {
      await privacy();
      const entries: JournalEntry[] = [];
      const load = async (url: string) => {
        try {
          const entry = await readEntry(url);
          if (entry) entries.push(entry);
        } catch (error) {
          if (!(error instanceof JournalPrivacyError)) throw error;
          // Without a reporting consumer, refuse an incomplete export/list entirely.
          if (!options?.onPrivacySkip) throw error;
          options.onPrivacySkip(url);
        }
      };
      let batch: string[] = [];
      for await (const item of storage.listAll(container, { maxBytes: 4 * 1024 * 1024 })) {
        if (item.kind === "container" || !new URL(item.url).pathname.endsWith(".ttl")) continue;
        owned(item.url);
        batch.push(item.url);
        if (batch.length === 6) {
          await Promise.all(batch.map(load));
          batch = [];
        }
      }
      await Promise.all(batch.map(load));
      return entries.sort(
        (a, b) => b.created.getTime() - a.created.getTime() || a.url.localeCompare(b.url),
      );
    },
    async read(url) {
      owned(url);
      await privacy();
      const entry = await readEntry(url);
      if (!entry) throw new Error("The entry is no longer available. Your words are kept here.");
      return entry;
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
      let reservation = interrupted.get(data);
      if (!reservation) {
        const created = await storage.create(container, "", {
          name: `${crypto.randomUUID()}.ttl`,
          contentType: "text/turtle",
        });
        owned(created.url);
        reservation = {
          url: created.url,
          etag: created.etagSource === "response" ? created.etag : null,
        };
        interrupted.set(data, reservation);
      }
      const { url } = reservation;
      const changed = (cause?: unknown) =>
        new StorageError("precondition-failed", {
          url,
          method: "PUT",
          message: "The interrupted journal entry changed. Save your draft as a new entry.",
          cause,
        });
      await verifyJournalResource(storage, url, owner, fetch);
      const { body, etag, contentType } = await storage
        .read(url, { maxBytes: ENTRY_MAX_BYTES, headers: { "Cache-Control": "no-cache" } })
        .then(async (read) => ({
          body: await read.text(),
          etag: read.etag,
          contentType: read.contentType,
        }))
        .catch((error: unknown) => {
          if (error instanceof StorageError && error.code === "payload-too-large")
            throw changed(error);
          throw error;
        });
      const turtle = await serializeEntry(url, clean);
      if (!etag) throw new Error("Couldn't create an empty journal entry safely");
      if (body.length) {
        const recovered = await entryEntity
          .parseDocument(url, body, contentType)
          .catch(() => undefined);
        if (!recovered || (await serializeEntry(url, recovered)) !== turtle) throw changed();
        interrupted.delete(data);
        return { ...recovered, url, etag };
      }
      if (reservation.etag && reservation.etag !== etag) throw changed();
      reservation.etag = etag;
      await verifyJournalResource(storage, url, owner, fetch);
      const result = await storage.write(url, turtle, {
        contentType: "text/turtle",
        ifMatch: etag,
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
      const read = await storage.read(url, { maxBytes: PHOTO_MAX_BYTES });
      if (!PHOTO_TYPES.has(read.contentType?.split(";")[0] ?? "")) {
        void read.body?.cancel().catch(() => {});
        throw new Error("This attachment isn't a supported photo");
      }
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
  const root = normalizePodBase(storageUrl);
  let storage: StorageClient;
  if (options.solidFixture) {
    // The browser demo implements WAC but has no discovery document.
    const fixture = createSolidBackend({ fetch, root });
    storage = {
      ...fixture,
      features: {
        ...fixture.features,
        accessControl: { state: "available", evidence: "demo", detail: { model: "wac" } },
      },
    };
  } else {
    const client = await createPodClient({ fetch, storage: root });
    if (client.description.protocol !== "solid")
      throw new Error("Private journal provisioning currently needs a Solid pod");
    if (client.storage.root !== root)
      throw new JournalPrivacyError("The selected pod does not match the discovered storage root.");
    storage = client.storage;
  }
  let index: TypeIndex | null = null;
  try {
    const guarded = privateJournalIndex(storage, owner);
    index = createTypeIndex({ storage: guarded, features: guarded.features, profile: owner });
  } catch (error) {
    // A profile on a separate host cannot be registered through this pod.
    if (!(error instanceof StorageError) || error.code !== "scope") throw error;
  }
  return createJournalStore(storage, index, owner, fetch);
}
