// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex, type TypeHint, type TypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { type Deck, renumber } from "./deck.js";
import { PRESENTATION_CLASS, parseDeck, serializeDeck } from "./model.js";
export interface StoredDeck {
  url: string;
  etag: string;
  deck: Deck;
}
class UnfinishedDeckError extends Error {}
export class DeckConflictError extends Error {
  constructor(
    readonly local: Deck,
    readonly remote: StoredDeck,
  ) {
    super("This presentation changed elsewhere. Your copy is safe.");
  }
}
function validator(etag: string | null): string {
  if (!etag || etag.startsWith("W/"))
    throw new Error("A strong version is required to save safely");
  return etag;
}
/** Shared collection I/O. All network operations go through the injected scoped client. */
export function createDeckRepository(
  storage: StorageClient,
  options: { profile: string; index?: TypeIndex },
) {
  const index =
    options.index ??
    createTypeIndex({ storage, features: storage.features, profile: options.profile });
  let container = new URL("slides/", storage.root).href;
  let hint: TypeHint | undefined;
  const read = async (url: string): Promise<StoredDeck> => {
    const response = await storage.readRdf(url);
    if (response.dataset.size === 0)
      throw new UnfinishedDeckError("This file is not a valid presentation");
    const deck = parseDeck(url, response.dataset);
    if (!deck) throw new Error("This file is not a valid presentation");
    return { url, etag: validator(response.etag), deck };
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
    async list(): Promise<StoredDeck[]> {
      const decks: StoredDeck[] = [];
      for await (const item of storage.listAll(container, { maxBytes: 4 * 1024 * 1024 })) {
        if (
          item.kind === "container" ||
          (item.contentType
            ? !["text/turtle", "application/ld+json"].includes(item.contentType.split(";")[0] ?? "")
            : !item.url.endsWith(".ttl"))
        )
          continue;
        try {
          decks.push(await read(item.url));
        } catch (error) {
          if (!(error instanceof UnfinishedDeckError)) throw error;
        }
      }
      return decks.sort((a, b) => b.deck.modified.getTime() - a.deck.modified.getTime());
    },
    async create(deck: Deck, name = `${crypto.randomUUID()}.ttl`): Promise<StoredDeck> {
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
        ifMatch: validator(fresh.etag),
      });
      if (saved.etagSource !== "response") return read(created.url);
      return { url: created.url, etag: validator(saved.etag), deck };
    },
    async save(current: StoredDeck, deck: Deck, keepalive = false): Promise<StoredDeck> {
      const body = await serializeDeck(current.url, { ...deck, slides: renumber(deck.slides) });
      try {
        const saved = await storage.write(current.url, body, {
          contentType: "text/turtle",
          ifMatch: current.etag,
          keepalive: keepalive && new TextEncoder().encode(body).byteLength <= 65536,
        });
        if (saved.etagSource !== "response") {
          const observed = await read(current.url);
          // A follow-up HEAD is not proof that our snapshot still owns this version.
          if ((await serializeDeck(current.url, observed.deck)) !== body)
            throw new DeckConflictError(deck, observed);
          return observed;
        }
        return { url: current.url, etag: validator(saved.etag), deck };
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
      await storage.delete(current.url, { ifMatch: current.etag });
    },
    async uploadImage(file: Blob, name: string): Promise<string> {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
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

/** Explicit Solid sessions already supply their authenticated root; no protocol inference. */
export async function openSolidDeckRepository(
  fetch: typeof globalThis.fetch,
  root: string,
  profile: string,
) {
  const { createSolidBackend } = await import("@jeswr/storage-client/solid");
  return createDeckRepository(createSolidBackend({ fetch, root }), { profile });
}
