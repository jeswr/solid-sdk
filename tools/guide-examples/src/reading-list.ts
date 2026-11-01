// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type BookmarkData,
  isHttpIri,
  parseBookmarkTtl,
  serializeBookmark,
} from "@jeswr/solid-bookmark";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { retryOnConflict } from "@jeswr/storage-client/helpers";

export interface ReadingItem {
  readonly url: string;
  readonly etag: string;
  readonly bookmark: BookmarkData;
}

export interface ReadingList {
  readonly container: string;
  get(url: string, signal?: AbortSignal): Promise<ReadingItem | undefined>;
  list(signal?: AbortSignal): Promise<ReadingItem[]>;
  add(data: BookmarkData): Promise<ReadingItem>;
  update(item: ReadingItem, changes: Partial<BookmarkData>): Promise<ReadingItem>;
  remove(item: ReadingItem): Promise<void>;
}

function requireEtag(etag: string | null): string {
  if (!etag || etag === "*") throw new Error("Re-read before editing: no ETag supplied");
  return etag;
}

function validateUrl(url: string): void {
  if (!isHttpIri(new URL(url).href)) throw new TypeError("Bookmark URL must be http(s)");
}

/** Open a remembered container, or create one and remember its returned URL. */
export async function openReadingList(
  storage: StorageClient,
  container?: string,
): Promise<ReadingList> {
  // On LWS the name is only a hint; the server's URL is the identity.
  const location =
    container ??
    (
      await storage.create(storage.root, null, {
        kind: "container",
        name: "reading-list",
      })
    ).url;

  async function readItem(url: string, signal?: AbortSignal): Promise<ReadingItem | undefined> {
    const resource = await storage.read(url, { signal });
    // Other applications may put files here; only parse Turtle bookmark documents.
    const type = resource.contentType?.split(";")[0]?.trim().toLowerCase();
    if (type && type !== "text/turtle") {
      await resource.body?.cancel();
      return undefined;
    }
    // Consume outside the parse catch: transport and abort failures must reach the caller.
    const body = await resource.text();
    const bookmark = await parseBookmarkTtl(url, body, resource.contentType).catch((error) => {
      if (error instanceof StorageError || signal?.aborted) throw error;
      return undefined; // Malformed RDF or an unusable domain projection is not a bookmark.
    });
    return bookmark ? { url, etag: requireEtag(resource.etag), bookmark } : undefined;
  }

  async function save(url: string, bookmark: BookmarkData, ifMatch: string): Promise<ReadingItem> {
    validateUrl(bookmark.url);
    // The serializer derives bookmarkSubject(url); never construct RDF by hand.
    const turtle = await serializeBookmark(url, bookmark);
    const written = await storage.write(url, turtle, { contentType: "text/turtle", ifMatch });
    // The backend may get its ETag from a later HEAD. Read bytes and validator together.
    const current = await readItem(written.url);
    if (!current) throw new Error("The saved resource is no longer a bookmark");
    return current;
  }

  return {
    container: location,
    get(url, signal) {
      return readItem(url, signal).catch((error) => {
        if (error instanceof StorageError && error.code === "not-found") return undefined;
        throw error;
      });
    },
    async list(signal) {
      const items: ReadingItem[] = [];
      // listAll follows opaque cursors; kind, rather than a URL suffix, identifies containers.
      for await (const entry of storage.listAll(location, { signal })) {
        if (entry.kind !== "resource") continue;
        const item = await readItem(entry.url, signal);
        if (item) items.push(item);
      }
      return items.sort(
        (a, b) => (b.bookmark.created?.getTime() ?? 0) - (a.bookmark.created?.getTime() ?? 0),
      );
    },
    async add(data) {
      validateUrl(data.url);
      // Create first: the bookmark's subject depends on the URL the server assigns.
      const created = await storage.create(location, null, { contentType: "text/turtle" });
      const etag = requireEtag(created.etag ?? (await storage.head(created.url)).etag);
      return save(created.url, { ...data, created: data.created ?? new Date() }, etag);
    },
    update(item, changes) {
      // A stale ETag raises StorageError('precondition-failed'); let the caller handle it.
      return save(item.url, { ...item.bookmark, ...changes, modified: new Date() }, item.etag);
    },
    remove(item) {
      // Deletion also uses the validator from the item the user actually saw.
      return storage.delete(item.url, { ifMatch: item.etag });
    },
  };
}

/** Re-read and reapply a small, repeatable change when another writer wins. */
export function updateWithRetry(
  list: ReadingList,
  item: ReadingItem,
  changes: Partial<BookmarkData>,
): Promise<ReadingItem> {
  let current = item;
  return retryOnConflict(
    () => list.update(current, changes),
    async () => {
      // The helper reads before the first attempt and each retry; keep the content too.
      const fresh = await list.get(item.url);
      if (!fresh) throw new Error("The bookmark was removed");
      current = fresh;
      return fresh;
    },
  );
}
