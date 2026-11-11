// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { DataFactory } from "n3";
import {
  Bookmark,
  type BookmarkData,
  bookmarkSubject,
  parseBookmark,
  serializeBookmark,
} from "./bookmark.js";
import { isHttpIri } from "./iri.js";
import { BOOKMARK_CLASS } from "./vocab.js";

export interface StoredBookmark {
  url: string;
  etag: string | null;
  data: BookmarkData;
}
export type BookmarkPatch = Partial<
  Pick<BookmarkData, "url" | "title" | "description" | "notes" | "archived" | "tags">
>;
export interface BookmarkRepository {
  initialize(): Promise<void>;
  list(): Promise<StoredBookmark[]>;
  create(data: BookmarkData): Promise<StoredBookmark>;
  update(record: StoredBookmark, patch: BookmarkPatch): Promise<StoredBookmark>;
  remove(record: StoredBookmark): Promise<void>;
}
/** Explicit Solid/LDP entry point for sessions which already discovered their pod root. */
export function createSolidBookmarkRepository(options: {
  fetch: typeof fetch;
  storageRoot: string;
  profile: string;
}): BookmarkRepository {
  return createBookmarkRepository({
    storage: createSolidBackend({ fetch: options.fetch, root: options.storageRoot }),
    profile: options.profile,
    fetch: options.fetch,
  });
}
function version(record: { etag: string | null }): string {
  if (!record.etag) throw new Error("This pod did not supply a version for a safe edit");
  return record.etag;
}
function validate(data: Partial<BookmarkData>): void {
  if (data.url !== undefined && !isHttpIri(data.url)) throw new TypeError("Enter an http(s) URL");
}

/** One typed resource per bookmark, preserving unrelated RDF on conditional edits. */
export function createBookmarkRepository(options: {
  storage: StorageClient;
  profile: string;
  fetch?: typeof fetch;
  index?: Pick<TypeIndex, "register">;
}): BookmarkRepository {
  const { storage } = options;
  const index =
    options.index ??
    createTypeIndex({
      storage,
      features: storage.features,
      profile: options.profile,
      fetch: options.fetch,
    });
  let container = new URL("bookmarks/", storage.root).href;
  let ready: Promise<void> | undefined;
  let links: { rel: string; target: string }[] = [];
  const initialize = (): Promise<void> => {
    ready ??= (async () => {
      try {
        await storage.head(container);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
        try {
          container = (
            await storage.create(storage.root, null, { name: "bookmarks", kind: "container" })
          ).url;
        } catch (conflict) {
          if (!(conflict instanceof StorageError) || conflict.code !== "conflict") throw conflict;
          await storage.head(container);
        }
      }
      const hint = await index.register(BOOKMARK_CLASS, { container }, { index: "private" });
      links = [...(hint?.links ?? [])];
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  const read = async (url: string): Promise<StoredBookmark | undefined> => {
    const result = await storage.readRdf(url);
    const data = parseBookmark(url, result.dataset);
    return data ? { url, etag: result.etag, data } : undefined;
  };
  return {
    initialize,
    async list() {
      await initialize();
      const records: StoredBookmark[] = [];
      let count = 0;
      for await (const entry of storage.listAll(container, { maxBytes: 4_000_000 })) {
        if (++count > 5000) throw new RangeError("This collection exceeds 5,000 resources");
        if (entry.kind === "container") continue;
        try {
          const record = await read(entry.url);
          if (record) records.push(record);
        } catch (error) {
          if (!(error instanceof StorageError) || !["not-found", "not-rdf"].includes(error.code))
            throw error;
        }
      }
      return records;
    },
    async create(data) {
      validate(data);
      if (!isHttpIri(data.url)) throw new TypeError("Enter an http(s) URL");
      await initialize();
      const created = await storage.create(container, null, { contentType: "text/turtle", links });
      const fresh = await storage.read(created.url);
      if ((await fresh.bytes()).length) throw new Error("The new resource is no longer empty");
      const normalized = { ...data, created: data.created ?? new Date() };
      const body = await serializeBookmark(created.url, normalized);
      const result = await storage.write(created.url, body, {
        contentType: "text/turtle",
        ifMatch: version(fresh),
      });
      return {
        url: result.url,
        etag: result.etagSource === "response" ? result.etag : null,
        data: normalized,
      };
    },
    async update(record, patch) {
      validate(patch);
      version(record);
      const fresh = await storage.readRdf(record.url);
      if (fresh.etag !== record.etag)
        throw new StorageError("precondition-failed", {
          url: record.url,
          method: "PUT",
          message: "This bookmark changed elsewhere",
        });
      const data = parseBookmark(record.url, fresh.dataset);
      if (!data) throw new Error("This resource is no longer a bookmark");
      const node = new Bookmark(bookmarkSubject(record.url), fresh.dataset, DataFactory);
      for (const key of ["url", "title", "description", "notes", "archived"] as const) {
        if (Object.hasOwn(patch, key)) Object.assign(node, { [key]: patch[key] });
      }
      if (patch.tags) {
        node.tags.clear();
        for (const tag of patch.tags) node.tags.add(tag);
      }
      node.modified = new Date();
      const result = await storage.writeRdf(record.url, fresh.dataset, { ifMatch: version(fresh) });
      return {
        url: result.url,
        etag: result.etagSource === "response" ? result.etag : null,
        data: { ...data, ...patch, modified: node.modified },
      };
    },
    async remove(record) {
      await storage.delete(record.url, { ifMatch: version(record) });
    },
  };
}
