// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * Drive operations over a {@link DriveClient} (04-drive §4, §5.2–5.4): uploads
 * with conflict policies, new folder, rename, move, make a copy, the
 * app-managed trash and the recent scan. Batch operations never throw mid-way;
 * they return `{ done, failed }` so the UI can report partial results.
 */

import { type DriveClient, DriveError, type DriveItem, nameOf, parentOf } from "../client/client";
import { guessContentType } from "../files";
import { keepBothName, normalizeUploadName } from "../upload";
import {
  addTrashRecord,
  emptyTrashIndex,
  removeTrashRecord,
  serializeTrashIndex,
  type TrashEntry,
  trashEntries,
  trashIndexFrom,
} from "./trash-index";

export interface BatchResult<T> {
  readonly done: T[];
  readonly failed: { url: string; error: unknown }[];
}

export type ConflictChoice = "keep-both" | "replace" | "skip";

/** The URL of a child called `name` in `folderUrl`. */
export function childUrl(folderUrl: string, name: string, folder = false): string {
  return `${folderUrl}${encodeURIComponent(name)}${folder ? "/" : ""}`;
}

/** Names that Drive never lists (`.trash/`, `.acl`, `.meta`, …). */
export function isHidden(item: Pick<DriveItem, "name">): boolean {
  return item.name.startsWith(".");
}

export function contentTypeFor(name: string, declared?: string): string {
  if (declared && declared !== "application/octet-stream") return declared;
  return guessContentType(name) ?? "application/octet-stream";
}

/**
 * Upload one file. `"fail"` reports a conflict as {@link DriveError} `conflict`
 * so the UI can ask; `"replace"` overwrites the current version only;
 * `"keep-both"` saves as `name (n).ext` with the first free n.
 */
export async function uploadFile(
  client: DriveClient,
  folderUrl: string,
  file: Blob,
  rawName: string,
  policy: "fail" | ConflictChoice = "fail",
): Promise<DriveItem | undefined> {
  const name = normalizeUploadName(rawName);
  const contentType = contentTypeFor(name, file.type);
  const done = (url: string): DriveItem => ({
    url,
    name: nameOf(url),
    kind: "file",
    contentType,
    size: file.size,
    modified: new Date(),
  });
  if (policy === "skip") return undefined;
  const url = childUrl(folderUrl, name);
  if (policy === "replace") {
    const current = await client.stat(url).catch((error: unknown) => {
      if (error instanceof DriveError && error.kind === "not-found") return undefined;
      throw error;
    });
    await client.write(
      url,
      file,
      current?.etag ? { contentType, ifMatch: current.etag } : { contentType, ifNoneMatch: "*" },
    );
    return done(url);
  }
  if (policy === "fail") {
    await client.write(url, file, { contentType, ifNoneMatch: "*" });
    return done(url);
  }
  const taken = (await client.list(folderUrl)).map((item) => item.name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = childUrl(folderUrl, keepBothName(name, taken));
    try {
      await client.write(candidate, file, { contentType, ifNoneMatch: "*" });
      return done(candidate);
    } catch (error) {
      if (!(error instanceof DriveError && error.kind === "conflict")) throw error;
      taken.push(nameOf(candidate));
    }
  }
  throw new DriveError("conflict", 412, url);
}

export async function createFolder(
  client: DriveClient,
  parentUrl: string,
  rawName: string,
): Promise<string> {
  const name = normalizeUploadName(rawName, "folder");
  const url = childUrl(parentUrl, name, true);
  await client.createFolder(url);
  return url;
}

/** Whether a rename changes the extension chain (04-drive §2.9 prompt). */
export function extensionChange(
  oldName: string,
  newName: string,
): { from: string; to: string } | undefined {
  const ext = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  };
  const from = ext(oldName);
  const to = ext(newName);
  return from !== to ? { from, to } : undefined;
}

export function validateName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name";
  if (trimmed.includes("/")) return "Names can't contain /";
  if ([...trimmed].length > 180) return "Use 180 characters or fewer";
  if (trimmed === "." || trimmed === "..") return "Choose another name";
  return undefined;
}

export async function renameItem(
  client: DriveClient,
  item: Pick<DriveItem, "url" | "kind" | "name">,
  newName: string,
): Promise<string> {
  const parent = parentOf(item.url);
  if (!parent || newName.trim() === item.name) return item.url;
  const name = normalizeUploadName(newName, item.kind === "folder" ? "folder" : "file");
  return client.move(item.url, childUrl(parent, name, item.kind === "folder"));
}

export async function moveItems(
  client: DriveClient,
  urls: readonly string[],
  targetFolder: string,
): Promise<BatchResult<{ from: string; to: string }>> {
  const result: BatchResult<{ from: string; to: string }> = { done: [], failed: [] };
  for (const url of urls) {
    try {
      if (parentOf(url) === targetFolder) continue;
      if (url.endsWith("/") && targetFolder.startsWith(url)) {
        throw new DriveError("conflict", 409, targetFolder);
      }
      const to = childUrl(targetFolder, nameOf(url), url.endsWith("/"));
      result.done.push({ from: url, to: await client.move(url, to) });
    } catch (error) {
      result.failed.push({ url, error });
    }
  }
  return result;
}

/** "Make a copy" of a file next to it: `Copy of {name}`, then `(n)` on collisions. */
export async function copyItem(client: DriveClient, url: string): Promise<string> {
  const parent = parentOf(url) as string;
  const taken = (await client.list(parent)).map((item) => item.name);
  const name = keepBothName(`Copy of ${nameOf(url)}`, taken);
  const to = childUrl(parent, name);
  await client.copy(url, to);
  return to;
}

// ---------------------------------------------------------------- trash

export function trashFolderOf(driveRoot: string): string {
  return `${driveRoot}.trash/`;
}

function indexUrlOf(driveRoot: string): string {
  return `${trashFolderOf(driveRoot)}index.ttl`;
}

/** Apply `change` to the trash index with a conditional write; one retry on 412. */
async function updateIndex(
  client: DriveClient,
  driveRoot: string,
  change: (index: ReturnType<typeof emptyTrashIndex>) => void,
): Promise<void> {
  const url = indexUrlOf(driveRoot);
  for (let attempt = 0; ; attempt += 1) {
    const current = await client.readRdf(url);
    const index = current ? trashIndexFrom(current.dataset) : emptyTrashIndex();
    change(index);
    try {
      await client.write(
        url,
        await serializeTrashIndex(index),
        current?.etag
          ? { contentType: "text/turtle", ifMatch: current.etag }
          : { contentType: "text/turtle", ifNoneMatch: "*" },
      );
      return;
    } catch (error) {
      if (attempt > 0 || !(error instanceof DriveError && error.kind === "conflict")) throw error;
    }
  }
}

export async function listTrash(client: DriveClient, driveRoot: string): Promise<TrashEntry[]> {
  const current = await client.readRdf(indexUrlOf(driveRoot));
  return current ? trashEntries(trashIndexFrom(current.dataset)) : [];
}

export async function trashItems(
  client: DriveClient,
  driveRoot: string,
  items: readonly DriveItem[],
  options: { webId?: string; now?: Date } = {},
): Promise<BatchResult<TrashEntry>> {
  const result: BatchResult<TrashEntry> = { done: [], failed: [] };
  const trash = trashFolderOf(driveRoot);
  for (const item of items) {
    try {
      const slot = `${trash}${crypto.randomUUID()}/`;
      const to = childUrl(slot, item.name, item.kind === "folder");
      await client.move(item.url, to);
      result.done.push({
        url: to,
        original: item.url,
        trashedAt: options.now ?? new Date(),
        name: item.name,
        ...(options.webId ? { trashedBy: options.webId } : {}),
        ...(item.contentType ? { contentType: item.contentType } : {}),
        ...(item.size !== undefined ? { size: item.size } : {}),
      });
    } catch (error) {
      result.failed.push({ url: item.url, error });
    }
  }
  if (result.done.length > 0) {
    await updateIndex(client, driveRoot, (index) => {
      for (const entry of result.done) addTrashRecord(index, entry);
    });
  }
  return result;
}

/** The uuid slot folder that holds a trashed item. */
function slotOf(entry: Pick<TrashEntry, "url">): string {
  return parentOf(entry.url) as string;
}

function restoredName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (restored)${name.slice(dot)}` : `${name} (restored)`;
}

export async function restoreItems(
  client: DriveClient,
  driveRoot: string,
  entries: readonly TrashEntry[],
): Promise<BatchResult<{ entry: TrashEntry; url: string; renamed: boolean }>> {
  const result: BatchResult<{ entry: TrashEntry; url: string; renamed: boolean }> = {
    done: [],
    failed: [],
  };
  for (const entry of entries) {
    try {
      const folder = entry.original.endsWith("/");
      const parent = parentOf(entry.original) as string;
      let target = entry.original;
      let renamed = false;
      const exists = await client.stat(target).then(
        () => true,
        (error: unknown) => {
          if (error instanceof DriveError && error.kind === "not-found") return false;
          throw error;
        },
      );
      if (exists) {
        target = childUrl(parent, restoredName(entry.name), folder);
        renamed = true;
      }
      // Moving recreates missing parent folders (PUT creates intermediate containers).
      const url = await client.move(entry.url, target);
      await client.remove(slotOf(entry), { recursive: true }).catch(() => undefined);
      result.done.push({ entry, url, renamed });
    } catch (error) {
      result.failed.push({ url: entry.url, error });
    }
  }
  if (result.done.length > 0) {
    await updateIndex(client, driveRoot, (index) => {
      for (const { entry } of result.done) removeTrashRecord(index, entry.url);
    });
  }
  return result;
}

export async function deleteForever(
  client: DriveClient,
  driveRoot: string,
  entries: readonly TrashEntry[],
): Promise<BatchResult<TrashEntry>> {
  const result: BatchResult<TrashEntry> = { done: [], failed: [] };
  for (const entry of entries) {
    try {
      await client.remove(slotOf(entry), { recursive: true });
      result.done.push(entry);
    } catch (error) {
      if (error instanceof DriveError && error.kind === "not-found") result.done.push(entry);
      else result.failed.push({ url: entry.url, error });
    }
  }
  if (result.done.length > 0) {
    await updateIndex(client, driveRoot, (index) => {
      for (const entry of result.done) removeTrashRecord(index, entry.url);
    });
  }
  return result;
}

const DAY = 86_400_000;

/** Delete items trashed more than `days` ago (max `limit` per run). Online only. */
export async function purgeExpired(
  client: DriveClient,
  driveRoot: string,
  options: { now?: Date; days?: number; limit?: number } = {},
): Promise<BatchResult<TrashEntry>> {
  const now = (options.now ?? new Date()).getTime();
  const cutoff = now - (options.days ?? 30) * DAY;
  const expired = (await listTrash(client, driveRoot))
    .filter((entry) => entry.trashedAt.getTime() < cutoff)
    .slice(0, options.limit ?? 50);
  if (expired.length === 0) return { done: [], failed: [] };
  return deleteForever(client, driveRoot, expired);
}

// ---------------------------------------------------------------- recent

/**
 * Breadth-first scan for recently modified files (04-drive §5.4, the
 * `!caps.serverSearch` path): max depth 4, max 400 containers, 8 concurrent.
 */
export async function recentFiles(
  client: DriveClient,
  roots: readonly string[],
  options: { maxDepth?: number; maxContainers?: number; concurrency?: number; limit?: number } = {},
): Promise<(DriveItem & { folder: string })[]> {
  const maxDepth = options.maxDepth ?? 4;
  const maxContainers = options.maxContainers ?? 400;
  const concurrency = options.concurrency ?? 8;
  const files: (DriveItem & { folder: string; modified: Date })[] = [];
  const seen = new Set<string>();
  let frontier = roots.map((url) => ({ url, depth: 0 }));
  let visited = 0;
  while (frontier.length > 0 && visited < maxContainers) {
    const batch = frontier.splice(0, Math.min(concurrency, maxContainers - visited));
    visited += batch.length;
    const listings = await Promise.all(
      batch.map(({ url, depth }) =>
        client.list(url).then(
          (items) => ({ url, depth, items }),
          () => ({ url, depth, items: [] as DriveItem[] }),
        ),
      ),
    );
    const next: { url: string; depth: number }[] = [];
    for (const { url, depth, items } of listings) {
      for (const item of items) {
        if (isHidden(item) || seen.has(item.url)) continue;
        seen.add(item.url);
        if (item.kind === "folder") {
          if (depth + 1 <= maxDepth) next.push({ url: item.url, depth: depth + 1 });
        } else if (item.modified) {
          files.push({ ...item, folder: url, modified: item.modified });
        }
      }
    }
    frontier = [...frontier, ...next];
  }
  return files
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, options.limit ?? 50);
}

/** Name search within the Drive tree (local scan; 04-drive §4.10). */
export async function searchByName(
  client: DriveClient,
  root: string,
  query: string,
  options: { limit?: number } = {},
): Promise<(DriveItem & { folder: string })[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const out: (DriveItem & { folder: string })[] = [];
  const frontier = [root];
  let visited = 0;
  while (frontier.length > 0 && visited < 400) {
    const batch = frontier.splice(0, 8);
    visited += batch.length;
    const listings = await Promise.all(
      batch.map((url) =>
        client.list(url).then(
          (items) => ({ url, items }),
          () => ({ url, items: [] as DriveItem[] }),
        ),
      ),
    );
    for (const { url, items } of listings) {
      for (const item of items) {
        if (isHidden(item)) continue;
        if (item.kind === "folder") frontier.push(item.url);
        if (item.name.toLocaleLowerCase().includes(needle)) out.push({ ...item, folder: url });
      }
    }
  }
  return out.slice(0, options.limit ?? 100);
}
