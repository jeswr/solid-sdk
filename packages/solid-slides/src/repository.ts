// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { createTypeIndex, type TypeHint, type TypeIndex } from "@jeswr/pod-type-index";
import {
  createPodClient,
  type Entry,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";
import { type Deck, renumber } from "./deck.js";
import { PRESENTATION_CLASS, parseDeck, serializeDeck } from "./model.js";

export interface StoredDeck {
  url: string;
  /** The version read or written. Weak or empty ("") versions are shown but never used to write. */
  etag: string;
  deck: Deck;
}
/** A presentation file in the collection that could not be opened. */
export interface BrokenDeck {
  url: string;
  /** "unreadable": the pod refused or failed the read. "invalid": the file is not a presentation. */
  reason: "unreadable" | "invalid";
}
export interface DeckListing {
  decks: StoredDeck[];
  broken: BrokenDeck[];
}
/** Largest presentation document read, enforced while streaming. */
export const DECK_BYTE_LIMIT = 4 * 1024 * 1024;
const LIST_CONCURRENCY = 4;
/** Empty placeholders older than this are interrupted creates, not creates in flight. */
const UNFINISHED_GRACE_MS = 10 * 60 * 1000;
/** Uploaded images older than this that no presentation references are removed. */
const ORPHAN_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
const DECK_TYPES = ["text/turtle", "application/ld+json"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^/]+$/;
const SAMPLE_NAME = /^[a-z0-9][a-z0-9-]*\.ttl$/;

class UnfinishedDeckError extends Error {
  constructor(readonly etag: string | null) {
    super("This presentation was not finished");
  }
}
/** The file exists but does not hold exactly one valid presentation. */
export class InvalidDeckError extends Error {
  constructor(
    readonly etag: string | null,
    options?: { cause?: unknown },
  ) {
    super("This file is not a valid presentation", options);
  }
}
/** The pod did not give a strong version, so a conditional write would be unsafe. */
export class DeckVersionError extends Error {
  constructor() {
    super("The pod did not confirm this presentation's version, so it can't be saved safely");
  }
}
export class DeckConflictError extends Error {
  constructor(
    readonly local: Deck,
    readonly remote: StoredDeck,
  ) {
    super("This presentation changed elsewhere. Your copy is safe.");
  }
}
export function isStrongEtag(etag: string | null | undefined): boolean {
  return typeof etag === "string" && etag.length > 0 && !etag.startsWith("W/");
}
function mediaType(value: string | null | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}
function nameOf(url: string): string {
  const path = new URL(url).pathname;
  try {
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  } catch {
    return "";
  }
}
function olderThan(modified: Date | null, age: number, now: number): boolean {
  return modified !== null && now - modified.getTime() > age;
}
async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
/** Uploaded slide images referenced by a presentation. */
export function deckImages(deck: Deck): string[] {
  return deck.slides.flatMap((slide) => (slide.image ? [slide.image] : []));
}

/** Shared collection I/O. All network operations go through the injected scoped client. */
export function createDeckRepository(
  storage: StorageClient,
  options: { profile: string; index?: TypeIndex; now?: () => number },
) {
  const index =
    options.index ??
    createTypeIndex({ storage, features: storage.features, profile: options.profile });
  const now = options.now ?? Date.now;
  let container = new URL("slides/", storage.root).href;
  let hint: TypeHint | undefined;
  /** A weak version names the same representation as a strong one with the same opaque tag. */
  const strongVersion = async (url: string, etag: string | null): Promise<string> => {
    if (etag && isStrongEtag(etag)) return etag;
    if (etag) {
      const current = await storage.head(url);
      if (current.etag && isStrongEtag(current.etag) && current.etag === etag.slice(2))
        return current.etag;
    }
    throw new DeckVersionError();
  };
  const read = async (url: string, signal?: AbortSignal): Promise<StoredDeck> => {
    const response = await storage.read(url, {
      accept: "text/turtle, application/ld+json;q=0.9",
      signal,
    });
    const type = mediaType(response.contentType);
    if (type && !DECK_TYPES.includes(type)) {
      void response.body?.cancel().catch(() => {});
      throw new InvalidDeckError(response.etag);
    }
    let dataset: Awaited<ReturnType<typeof parseRdf>>;
    try {
      dataset = await parseRdf(response.body ?? "", response.contentType, {
        baseIRI: url,
        maxBytes: DECK_BYTE_LIMIT,
        signal,
      });
    } catch (cause) {
      signal?.throwIfAborted();
      throw new InvalidDeckError(response.etag, { cause });
    }
    if (dataset.size === 0) throw new UnfinishedDeckError(response.etag);
    const deck = parseDeck(url, dataset);
    if (!deck) throw new InvalidDeckError(response.etag);
    return { url, etag: response.etag ?? "", deck };
  };
  const isUpload = (url: string) => {
    if (!url.startsWith(container) || url.slice(container.length).includes("/")) return false;
    return UPLOAD_NAME.test(nameOf(url));
  };
  const removeUploads = async (urls: readonly string[]) => {
    await eachLimited([...new Set(urls)].filter(isUpload), LIST_CONCURRENCY, async (url) => {
      try {
        const { etag } = await storage.head(url);
        if (etag && isStrongEtag(etag)) await storage.delete(url, { ifMatch: etag });
      } catch {
        /* Best effort: a missing or busy upload stays for a later sweep. */
      }
    });
  };
  const create = async (deck: Deck, name = `${crypto.randomUUID()}.ttl`): Promise<StoredDeck> => {
    const created = await storage.create(container, "", {
      name,
      contentType: "text/turtle",
      ...hint,
    });
    const fresh = await storage.read(created.url);
    if ((await fresh.bytes()).length)
      throw new Error("The new presentation was changed before it could be saved");
    const body = await serializeDeck(created.url, deck);
    const saved = await storage.write(created.url, body, {
      contentType: "text/turtle",
      ifMatch: await strongVersion(created.url, fresh.etag),
    });
    if (saved.etagSource !== "response" || !saved.etag || !isStrongEtag(saved.etag))
      return read(created.url);
    return { url: created.url, etag: saved.etag, deck };
  };
  return {
    get container() {
      return container;
    },
    async initialise() {
      try {
        await storage.head(container);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
        try {
          container = (
            await storage.create(storage.root, null, { name: "slides", kind: "container" })
          ).url;
        } catch (createError) {
          if (!(createError instanceof StorageError) || createError.code !== "conflict")
            throw createError;
          await storage.head(container);
        }
      }
      hint = await index.register(PRESENTATION_CLASS, { container });
    },
    read,
    /**
     * One unreadable or invalid file never hides the rest: it is reported in `broken`.
     * Reads run a few at a time. Empty placeholders left by interrupted creates are skipped,
     * and removed once old. Old uploaded images that no presentation references are removed,
     * but only when every presentation could be read.
     */
    async list(): Promise<DeckListing> {
      const files: Entry[] = [];
      const uploads: Entry[] = [];
      for await (const item of storage.listAll(container, { maxBytes: 4 * 1024 * 1024 })) {
        if (item.kind === "container") continue;
        const type = mediaType(item.contentType);
        if (type ? DECK_TYPES.includes(type) : item.url.endsWith(".ttl")) files.push(item);
        else if ((!type || IMAGE_TYPES.includes(type)) && isUpload(item.url)) uploads.push(item);
      }
      const decks: StoredDeck[] = [];
      const broken: BrokenDeck[] = [];
      const time = now();
      await eachLimited(files, LIST_CONCURRENCY, async (item) => {
        try {
          decks.push(await read(item.url));
        } catch (error) {
          if (error instanceof UnfinishedDeckError) {
            if (
              error.etag &&
              isStrongEtag(error.etag) &&
              olderThan(item.modified, UNFINISHED_GRACE_MS, time)
            )
              await storage.delete(item.url, { ifMatch: error.etag }).catch(() => {});
            return;
          }
          broken.push({
            url: item.url,
            reason: error instanceof InvalidDeckError ? "invalid" : "unreadable",
          });
        }
      });
      if (!broken.length) {
        const used = new Set(decks.flatMap((entry) => deckImages(entry.deck)));
        await removeUploads(
          uploads
            .filter(
              (item) =>
                !used.has(item.url) && olderThan(item.modified, ORPHAN_UPLOAD_GRACE_MS, time),
            )
            .map((item) => item.url),
        );
      }
      return {
        decks: decks.sort((a, b) => b.deck.modified.getTime() - a.deck.modified.getTime()),
        broken: broken.sort((a, b) => a.url.localeCompare(b.url)),
      };
    },
    create,
    /**
     * For app-owned sample files only (demo seeding): keeps a valid presentation at `name`,
     * creates a missing one, and replaces an empty or invalid file left by an interrupted seed.
     */
    async ensure(deck: Deck, name: string): Promise<StoredDeck> {
      if (!SAMPLE_NAME.test(name)) throw new TypeError("Invalid sample file name");
      const url = new URL(name, container).href;
      let etag: string | null;
      try {
        return await read(url);
      } catch (error) {
        if (error instanceof StorageError && error.code === "not-found") return create(deck, name);
        if (!(error instanceof UnfinishedDeckError || error instanceof InvalidDeckError))
          throw error;
        etag = error.etag;
      }
      const saved = await storage.write(url, await serializeDeck(url, deck), {
        contentType: "text/turtle",
        ifMatch: await strongVersion(url, etag),
      });
      if (saved.etagSource !== "response" || !saved.etag || !isStrongEtag(saved.etag))
        return read(url);
      return { url, etag: saved.etag, deck };
    },
    async save(current: StoredDeck, deck: Deck, keepalive = false): Promise<StoredDeck> {
      const body = await serializeDeck(current.url, { ...deck, slides: renumber(deck.slides) });
      try {
        const saved = await storage.write(current.url, body, {
          contentType: "text/turtle",
          ifMatch: await strongVersion(current.url, current.etag || null),
          keepalive: keepalive && new TextEncoder().encode(body).byteLength <= 65536,
        });
        if (saved.etagSource !== "response" || !saved.etag || !isStrongEtag(saved.etag)) {
          const observed = await read(current.url);
          // A follow-up HEAD is not proof that our snapshot still owns this version.
          if ((await serializeDeck(current.url, observed.deck)) !== body)
            throw new DeckConflictError(deck, observed);
          return observed;
        }
        return { url: current.url, etag: saved.etag, deck };
      } catch (error) {
        if (error instanceof StorageError && error.code === "precondition-failed") {
          const remote = await read(current.url);
          if ((await serializeDeck(current.url, remote.deck)) === body) return remote;
          throw new DeckConflictError(deck, remote);
        }
        throw error;
      }
    },
    async remove(current: StoredDeck) {
      await storage.delete(current.url, {
        ifMatch: await strongVersion(current.url, current.etag || null),
      });
    },
    /** Best effort: deletes this collection's uploaded images; other URLs are ignored. */
    removeUploads,
    async uploadImage(file: Blob, name: string): Promise<string> {
      if (!IMAGE_TYPES.includes(file.type))
        throw new TypeError("Choose a PNG, JPEG, WebP or GIF image");
      if (file.size > 10 * 1024 * 1024) throw new RangeError("Choose an image smaller than 10 MB");
      return (
        await storage.create(container, file, {
          name: `${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
          contentType: file.type,
        })
      ).url;
    },
  };
}
export type DeckRepository = ReturnType<typeof createDeckRepository>;

function isMissingStorageLink(error: unknown, storageUrl: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "no-storage-link" &&
    "url" in error &&
    error.url === new URL(storageUrl).href
  );
}
/**
 * Opens the collection through storage discovery, so Solid and LWS pods each get their own
 * backend. `assumeSolidWhenUndescribed` is only for transports known to be plain Solid that
 * advertise no storage description at all (the Suite's demo pod): LWS storages always do.
 */
export async function openDeckRepository(options: {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  profile: string;
  assumeSolidWhenUndescribed?: boolean;
  signal?: AbortSignal;
}): Promise<DeckRepository> {
  let storage: StorageClient;
  try {
    storage = (
      await createPodClient({
        storage: options.storageUrl,
        fetch: options.fetch,
        signal: options.signal,
      })
    ).storage;
  } catch (error) {
    if (!options.assumeSolidWhenUndescribed || !isMissingStorageLink(error, options.storageUrl))
      throw error;
    const { createSolidBackend } = await import("@jeswr/storage-client/solid");
    storage = createSolidBackend({ fetch: options.fetch, root: options.storageUrl });
  }
  return createDeckRepository(storage, { profile: options.profile });
}
