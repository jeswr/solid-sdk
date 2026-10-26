// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * Drive operations over a {@link DriveClient} (04-drive §4, §5.2–5.4): uploads
 * with conflict policies, new folder, rename, move, make a copy, the
 * app-managed trash and the recent scan. Batch operations never throw mid-way;
 * they return `{ done, failed }` so the UI can report partial results.
 */

import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { type DriveClient, DriveError, type DriveItem, nameOf, parentOf } from "../client/client";
import { guessContentType } from "../files";
import { keepBothName, normalizeUploadName } from "../upload";
import {
  addTrashRecord,
  emptyTrashIndex,
  removeTrashRecord,
  serializeTrashIndex,
  type TrashEntry,
  TrashRecord,
  trashEntries,
  trashIndexFrom,
} from "./trash-index";

/** A durable intent remains discoverable even if completion cannot be saved. */
class TransferRecord extends TrashRecord {
  get status(): string | undefined {
    return OptionalFrom.subjectPredicate(
      this,
      "http://purl.org/dc/terms/description",
      LiteralAs.string,
    );
  }
  set status(value: string) {
    OptionalAs.object(this, "http://purl.org/dc/terms/description", value, LiteralFrom.string);
  }
}

function transferRecord(index: ReturnType<typeof emptyTrashIndex>, url: string): TransferRecord {
  return new TransferRecord(url, index, DataFactory);
}

export interface BatchResult<T> {
  readonly done: T[];
  readonly failed: { url: string; error: unknown }[];
  /** Side effects completed, but the index needs reconciliation on next load. */
  readonly warnings?: TrashIndexWarning[];
}

export class TrashIndexWarning extends Error {
  readonly kind = "trash-index-persistence";
  constructor(
    readonly url: string,
    override readonly cause: unknown,
  ) {
    super(
      "Trash changes completed, but the index could not be saved. It will be reconciled when Trash is next loaded.",
    );
    this.name = "TrashIndexWarning";
  }
}

export class TrashMovingError extends Error {
  readonly kind = "trash-moving";
  constructor() {
    super(
      "This item is still moving to Trash. Wait until the move completes before restoring or deleting it.",
    );
    this.name = "TrashMovingError";
  }
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
  const to = childUrl(parent, name, url.endsWith("/"));
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

async function exists(client: DriveClient, url: string): Promise<boolean> {
  return client.stat(url).then(
    () => true,
    (error: unknown) => {
      if (error instanceof DriveError && error.kind === "not-found") return false;
      throw error;
    },
  );
}

/** Never trust a stale caller's copy of the index's transfer state. */
async function requireTrashEntry(
  client: DriveClient,
  driveRoot: string,
  entry: TrashEntry,
  pending = false,
): Promise<void> {
  const current = await client.readRdf(indexUrlOf(driveRoot));
  const index = current ? trashIndexFrom(current.dataset) : emptyTrashIndex();
  const record = transferRecord(index, entry.url);
  if (!pending && record.status === "pending") throw new TrashMovingError();
  if (
    record.originalLocation !== entry.original ||
    record.trashedAt?.getTime() !== entry.trashedAt.getTime() ||
    (pending && record.status !== "pending")
  )
    throw new DriveError("invalid-trash-record", 409, entry.url);
}

/** Preserve batch outcomes even when the bookkeeping write fails afterwards. */
async function removeCompletedRecords<T>(
  client: DriveClient,
  driveRoot: string,
  result: BatchResult<T>,
  urls: readonly string[],
): Promise<BatchResult<T>> {
  if (urls.length === 0) return result;
  try {
    await updateIndex(client, driveRoot, (index) => {
      for (const url of urls) removeTrashRecord(index, url);
    });
    return result;
  } catch (error) {
    return { ...result, warnings: [new TrashIndexWarning(indexUrlOf(driveRoot), error)] };
  }
}

export async function listTrash(
  client: DriveClient,
  driveRoot: string,
  options: { onInvalid?: (error: DriveError) => void } = {},
): Promise<TrashEntry[]> {
  const current = await client.readRdf(indexUrlOf(driveRoot));
  if (!current) return [];
  const index = trashIndexFrom(current.dataset);
  const entries: TrashEntry[] = [];
  const missing: string[] = [];
  for (const entry of trashEntries(index)) {
    try {
      slotOf(driveRoot, entry);
      validateOriginal(driveRoot, entry);
    } catch (error) {
      if (options.onInvalid) options.onInvalid(error as DriveError);
      else console.warn(error);
      continue;
    }
    if (transferRecord(index, entry.url).status === "pending") {
      // A destination PUT is only a copy. The source must be gone before a
      // lost completion write can be reconciled, and promotion must persist.
      if ((await exists(client, entry.original)) || !(await exists(client, entry.url))) continue;
      let completed = false;
      try {
        await updateIndex(client, driveRoot, (latest) => {
          completed = false;
          const record = transferRecord(latest, entry.url);
          if (record.status === "pending" && record.originalLocation === entry.original) {
            record.status = "complete";
            completed = true;
          }
        });
      } catch (error) {
        completed = false;
        console.warn(new TrashIndexWarning(indexUrlOf(driveRoot), error));
      }
      if (!completed) continue;
    } else if (!(await exists(client, entry.url))) {
      // Restore/delete may have succeeded while their final index PUT failed.
      missing.push(entry.url);
      continue;
    }
    entries.push(entry);
  }
  const reconciled = await removeCompletedRecords(
    client,
    driveRoot,
    { done: [], failed: [] },
    missing,
  );
  for (const warning of reconciled.warnings ?? []) console.warn(warning);
  return entries;
}

export async function trashItems(
  client: DriveClient,
  driveRoot: string,
  items: readonly DriveItem[],
  options: { webId?: string; now?: Date } = {},
): Promise<BatchResult<TrashEntry>> {
  const result: BatchResult<TrashEntry> = { done: [], failed: [] };
  const trash = trashFolderOf(driveRoot);
  const entries = items.map((item) => {
    const slot = `${trash}${crypto.randomUUID()}/`;
    const to = childUrl(slot, item.name, item.kind === "folder");
    return {
      url: to,
      original: item.url,
      trashedAt: options.now ?? new Date(),
      name: item.name,
      ...(options.webId ? { trashedBy: options.webId } : {}),
      ...(item.contentType ? { contentType: item.contentType } : {}),
      ...(item.size !== undefined ? { size: item.size } : {}),
    };
  });
  if (!entries.length) return result;
  for (const entry of entries) {
    slotOf(driveRoot, entry);
    validateOriginal(driveRoot, entry);
  }
  // No source may be removed until every intent is durably discoverable.
  await updateIndex(client, driveRoot, (index) => {
    for (const entry of entries) {
      addTrashRecord(index, entry);
      transferRecord(index, entry.url).status = "pending";
    }
  });
  for (const entry of entries) {
    try {
      await client.move(entry.original, entry.url, {
        beforeDelete: async () => {
          await requireTrashEntry(client, driveRoot, entry, true);
          await client.stat(entry.url);
        },
      });
      result.done.push(entry);
    } catch (error) {
      result.failed.push({ url: entry.original, error });
    }
  }
  if (result.done.length > 0) {
    try {
      await updateIndex(client, driveRoot, (index) => {
        for (const entry of result.done) transferRecord(index, entry.url).status = "complete";
      });
    } catch (error) {
      // Keep successful items in done so callers can offer Undo. Pending
      // records remain hidden until listTrash can confirm source removal and
      // persist completion.
      result.failed.push({ url: indexUrlOf(driveRoot), error });
    }
  }
  return result;
}

/** The uuid slot folder that holds a trashed item. */
function slotOf(driveRoot: string, entry: Pick<TrashEntry, "url">): string {
  const trash = trashFolderOf(driveRoot);
  try {
    const url = new URL(entry.url);
    const suffix = entry.url.slice(trash.length);
    if (
      url.href !== entry.url ||
      url.search ||
      url.hash ||
      !entry.url.startsWith(trash) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+\/?$/i.test(suffix)
    )
      throw new Error("invalid slot");
    const name = decodeURIComponent(suffix.slice(suffix.indexOf("/") + 1).replace(/\/$/, ""));
    if (name === "." || name === ".." || /[/\\]/.test(name)) throw new Error("invalid name");
    return parentOf(entry.url) as string;
  } catch {
    throw new DriveError("invalid-trash-record", 409, entry.url);
  }
}

function validateOriginal(driveRoot: string, entry: TrashEntry): void {
  try {
    const original = new URL(entry.original);
    if (
      original.href !== entry.original ||
      original.search ||
      original.hash ||
      !entry.original.startsWith(driveRoot) ||
      entry.original === driveRoot ||
      entry.original.startsWith(trashFolderOf(driveRoot)) ||
      /%2f|%5c/i.test(original.pathname) ||
      entry.original.endsWith("/") !== entry.url.endsWith("/")
    )
      throw new Error("invalid original location");
  } catch {
    throw new DriveError("invalid-trash-record", 409, entry.url);
  }
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
      const slot = slotOf(driveRoot, entry);
      validateOriginal(driveRoot, entry);
      await requireTrashEntry(client, driveRoot, entry);
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
      // The slot may contain another writer's resources; only remove it empty.
      await client.remove(slot).catch(() => undefined);
      result.done.push({ entry, url, renamed });
    } catch (error) {
      result.failed.push({ url: entry.url, error });
    }
  }
  return removeCompletedRecords(
    client,
    driveRoot,
    result,
    result.done.map(({ entry }) => entry.url),
  );
}

export async function deleteForever(
  client: DriveClient,
  driveRoot: string,
  entries: readonly TrashEntry[],
): Promise<BatchResult<TrashEntry>> {
  const result: BatchResult<TrashEntry> = { done: [], failed: [] };
  for (const entry of entries) {
    try {
      slotOf(driveRoot, entry);
      await requireTrashEntry(client, driveRoot, entry);
      await client.remove(entry.url, { recursive: true });
      await client.remove(slotOf(driveRoot, entry)).catch(() => undefined);
      result.done.push(entry);
    } catch (error) {
      if (error instanceof DriveError && error.kind === "not-found") result.done.push(entry);
      else result.failed.push({ url: entry.url, error });
    }
  }
  return removeCompletedRecords(
    client,
    driveRoot,
    result,
    result.done.map((entry) => entry.url),
  );
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
  const invalid: BatchResult<TrashEntry>["failed"] = [];
  const expired = (
    await listTrash(client, driveRoot, {
      onInvalid: (error) => invalid.push({ url: error.url, error }),
    })
  )
    .filter((entry) => entry.trashedAt.getTime() < cutoff)
    .slice(0, options.limit ?? 50);
  if (expired.length === 0) return { done: [], failed: invalid };
  const result = await deleteForever(client, driveRoot, expired);
  result.failed.push(...invalid);
  return result;
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

/** Bytes used by files under `root` (hidden names included: trash counts). */
export async function measureUsage(
  client: DriveClient,
  root: string,
  options: { maxContainers?: number } = {},
): Promise<number> {
  const maxContainers = options.maxContainers ?? 400;
  let total = 0;
  const frontier = [root];
  let visited = 0;
  while (frontier.length > 0 && visited < maxContainers) {
    const batch = frontier.splice(0, Math.min(8, maxContainers - visited));
    visited += batch.length;
    const listings = await Promise.all(batch.map((url) => client.list(url).catch(() => [])));
    for (const item of listings.flat()) {
      if (item.kind === "folder") frontier.push(item.url);
      else total += item.size ?? 0;
    }
  }
  return total;
}
