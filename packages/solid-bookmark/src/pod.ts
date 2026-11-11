// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import { DataFactory } from "n3";
import {
  Bookmark,
  type BookmarkData,
  bookmarkSubject,
  parseBookmark,
  serializeBookmark,
} from "./bookmark.js";
import { httpIriOrUndefined } from "./iri.js";
import { BOOKMARK_CLASS } from "./vocab.js";

export interface StoredBookmark {
  url: string;
  etag: string | null;
  data: BookmarkData;
}
export type BookmarkPatch = Partial<
  Pick<BookmarkData, "url" | "title" | "description" | "notes" | "archived" | "tags">
>;
export interface BookmarkListing {
  items: StoredBookmark[];
  /** A rate-limited entry means listing stopped early; items is an incomplete collection. */
  skipped: { url: string; reason: StorageErrorCode | "unknown" }[];
}
export type BookmarkRegistrationStatus = "pending" | "registered" | "failed";
export interface BookmarkRepository {
  readonly registration: BookmarkRegistrationStatus;
  initialize(): Promise<void>;
  list(): Promise<BookmarkListing>;
  create(data: BookmarkData): Promise<StoredBookmark>;
  update(record: StoredBookmark, patch: BookmarkPatch): Promise<StoredBookmark>;
  remove(record: StoredBookmark): Promise<void>;
}
function version(record: { etag: string | null }): string {
  if (!record.etag) throw new Error("This pod did not supply a version for a safe edit");
  return record.etag;
}
function canonicalUrl(value: string | undefined): string {
  const url = httpIriOrUndefined(value);
  if (!url) throw new TypeError("Enter an http(s) URL");
  return url;
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
  let registration: BookmarkRegistrationStatus = "pending";
  let attempts = 0;
  let registering: Promise<void> | undefined;
  let links: { rel: string; target: string }[] = [];
  const initialize = async (): Promise<void> => {
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
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    await ready;
    if (!registering && (registration === "registered" || attempts >= 2)) return;
    registering ??= (async () => {
      attempts++;
      try {
        const hint = await index.register(BOOKMARK_CLASS, { container }, { index: "private" });
        links = [...(hint?.links ?? [])];
        registration = "registered";
      } catch (error) {
        registration = "failed";
        // Never log the URL, server response, credentials or original error message.
        console.warn("Bookmark Type Index registration failed", {
          reason: error instanceof StorageError ? error.code : "unknown",
        });
      }
    })();
    const task = registering;
    await task;
    if (registering === task) registering = undefined;
  };
  const read = async (url: string): Promise<StoredBookmark | undefined> => {
    const result = await storage.readRdf(url);
    const data = parseBookmark(url, result.dataset);
    return data ? { url, etag: result.etag, data } : undefined;
  };
  return {
    get registration() {
      return registration;
    },
    initialize,
    async list() {
      await initialize();
      const records: StoredBookmark[] = [];
      const skipped: BookmarkListing["skipped"] = [];
      let count = 0;
      for await (const entry of storage.listAll(container, { maxBytes: 4_000_000 })) {
        if (++count > 5000) throw new RangeError("This collection exceeds 5,000 resources");
        if (entry.kind === "container") continue;
        try {
          const record = await read(entry.url);
          if (record) records.push(record);
        } catch (error) {
          const reason = error instanceof StorageError ? error.code : "unknown";
          if (reason === "unauthenticated") throw error;
          skipped.push({ url: entry.url, reason });
          if (reason === "rate-limited") break;
        }
      }
      return { items: records, skipped };
    },
    async create(data) {
      data = { ...data, url: canonicalUrl(data.url) };
      await initialize();
      const created = await storage.create(container, null, { contentType: "text/turtle", links });
      try {
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
      } catch (error) {
        // A lost response can mean the PUT committed. Delete only a freshly observed empty
        // resource, with an observed validator: never remove saved data or a concurrent edit.
        try {
          const orphan = await storage.read(created.url);
          const etag = orphan.etag ?? (created.etagSource === "response" ? created.etag : null);
          if (etag && !(await orphan.bytes()).length)
            await storage.delete(created.url, { ifMatch: etag });
        } catch {
          // Cleanup is best effort and must not replace the original failure.
        }
        throw error;
      }
    },
    async update(record, patch) {
      if (patch.url !== undefined) patch = { ...patch, url: canonicalUrl(patch.url) };
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
