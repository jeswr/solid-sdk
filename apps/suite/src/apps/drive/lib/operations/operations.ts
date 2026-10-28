// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * Drive operations over a {@link DriveClient} (04-drive §4, §5.2–5.4): uploads
 * with conflict policies, new folder, rename, move, make a copy, the
 * app-managed trash and the recent scan. Batch operations never throw mid-way;
 * they return `{ done, failed }` so the UI can report partial results.
 */

import {
  type DriveClient,
  DriveError,
  type DriveItem,
  DrivePartialFailureError,
  type MoveResult,
  nameOf,
  parentOf,
  policyArchiveOf,
} from "../client/client";
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

const LEASE_MS = 60_000;
const liveTransfers = new Set<string>();
const stoppedTransfers = new Map<string, number>();

function ownerIsLive(record: ReturnType<typeof transferRecord>): boolean {
  return (
    !!record.leaseOwner &&
    (liveTransfers.has(record.leaseOwner) ||
      (!stoppedTransfers.has(record.leaseOwner) &&
        (record.leaseUntil?.getTime() ?? 0) > Date.now()))
  );
}

function transferRecord(index: ReturnType<typeof emptyTrashIndex>, url: string) {
  return index.record(url);
}

export interface BatchResult<T> {
  readonly done: T[];
  readonly failed: { url: string; error: unknown }[];
  /** Index access failed; completed side effects may need reconciliation. */
  readonly warnings?: TrashIndexWarning[];
}

export class TrashIndexWarning extends Error {
  readonly kind = "trash-index-persistence";
  constructor(
    readonly url: string,
    override readonly cause: unknown,
  ) {
    super(
      "The Trash index could not be read or saved. Open Trash to reconcile any completed changes.",
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

export class TrashRestorePartialError extends Error {
  readonly kind = "trash-restore-partial";
  constructor(readonly remaining: readonly { url: string; error: unknown }[]) {
    const occupied = remaining.filter(
      ({ error }) => error instanceof DriveError && error.kind === "conflict",
    ).length;
    super(
      occupied === remaining.length
        ? `${occupied} items could not be restored because their location is in use`
        : `${remaining.length} items could not be restored. Their recovery copies remain in Trash.`,
    );
    this.name = "TrashRestorePartialError";
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
  return (await client.move(item.url, childUrl(parent, name, item.kind === "folder"))).url;
}

export async function moveItems(
  client: DriveClient,
  urls: readonly string[],
  targetFolder: string,
): Promise<BatchResult<{ from: string; to: string; identity: MoveResult }>> {
  const result: BatchResult<{ from: string; to: string; identity: MoveResult }> = {
    done: [],
    failed: [],
  };
  for (const url of urls) {
    try {
      if (parentOf(url) === targetFolder) continue;
      if (url.endsWith("/") && targetFolder.startsWith(url)) {
        throw new DriveError("conflict", 409, targetFolder);
      }
      const to = childUrl(targetFolder, nameOf(url), url.endsWith("/"));
      const identity = await client.move(url, to);
      result.done.push({ from: url, to: identity.url, identity });
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

/** Persist source identities in the intent; older records use byte comparison. */
async function sourceVersions(client: DriveClient, url: string): Promise<string[]> {
  try {
    if (url.endsWith("/")) {
      const children = await client.list(url);
      return (await Promise.all(children.map((child) => sourceVersions(client, child.url)))).flat();
    }
    const { etag } = await client.stat(url);
    return etag ? [JSON.stringify([url, etag])] : [];
  } catch (error) {
    // A missing source still gets its normal per-item move failure.
    if (error instanceof DriveError && error.kind === "not-found") return [];
    throw error;
  }
}

/** Presence alone cannot identify a survivor: its URL may have been reused. */
async function sameRecoveryFile(
  client: DriveClient,
  from: string,
  to: string,
  versions: ReadonlySet<string> = new Set(),
): Promise<{ same: boolean; etag: string | undefined; survivorEtag: string | undefined }> {
  const target = await client.stat(to);
  if (target.etag && !target.etag.startsWith("W/")) {
    // Validators only identify versions at the URL that issued them.
    if (versions.has(JSON.stringify([to, target.etag])))
      return { same: true, etag: undefined, survivorEtag: target.etag };
  }
  const [recovery, survivor] = await Promise.all([
    client.readVersion(from),
    client.readVersion(to),
  ]);
  const etag = recovery.etag;
  const survivorEtag = survivor.etag;
  if (recovery.body.size !== survivor.body.size) return { same: false, etag, survivorEtag };
  const [a, b] = await Promise.all([recovery.body.arrayBuffer(), survivor.body.arrayBuffer()]);
  const bytes = new Uint8Array(b);
  return {
    same: new Uint8Array(a).every((value, index) => value === bytes[index]),
    etag,
    survivorEtag,
  };
}

/** Every recovery child must still have the same original, including nested files. */
async function holdsRecovery(
  client: DriveClient,
  from: string,
  original: string,
  versions: ReadonlySet<string>,
): Promise<boolean> {
  if (!(await exists(client, original))) return false;
  if (!from.endsWith("/")) return (await sameRecoveryFile(client, from, original, versions)).same;
  const source = new Set((await client.list(original)).map(({ url }) => url));
  for (const child of await client.list(from)) {
    const target = `${original}${child.url.slice(from.length)}`;
    if (!source.has(target) || !(await holdsRecovery(client, child.url, target, versions)))
      return false;
  }
  return true;
}

/** Keep the slot-local receipt distinct from the recorded resource itself. */
function recoveryMarker(driveRoot: string, entry: TrashEntry): string {
  return `${slotOf(driveRoot, entry)}${nameOf(entry.url) === "partial.ttl" ? ".partial.ttl" : "partial.ttl"}`;
}

async function recoveryStatus(
  client: DriveClient,
  driveRoot: string,
  entry: TrashEntry,
): Promise<"partial" | "complete" | undefined> {
  const current = await client.readRdf(recoveryMarker(driveRoot, entry));
  if (!current) return undefined;
  const record = trashIndexFrom(current.dataset).record(entry.url);
  return (record.status === "partial" || record.status === "complete") &&
    record.originalLocation === entry.original &&
    record.trashedAt?.getTime() === entry.trashedAt.getTime()
    ? record.status
    : undefined;
}

/** A slot-local receipt keeps recovery discoverable if the shared index is unavailable. */
async function markRecovery(
  client: DriveClient,
  driveRoot: string,
  entry: TrashEntry,
  status: "partial" | "complete",
): Promise<void> {
  if (await recoveryStatus(client, driveRoot, entry)) return;
  const receipt = emptyTrashIndex();
  addTrashRecord(receipt, entry);
  receipt.record(entry.url).status = status;
  await client.write(recoveryMarker(driveRoot, entry), await serializeTrashIndex(receipt), {
    contentType: "text/turtle",
    ifNoneMatch: "*",
  });
}

async function reconcilePending(
  client: DriveClient,
  driveRoot: string,
  entry: TrashEntry,
  record: ReturnType<typeof transferRecord>,
  durable = false,
): Promise<"partial" | "complete" | undefined> {
  if (record.leaseOwner && liveTransfers.has(record.leaseOwner)) return undefined;
  if (!(await exists(client, entry.url))) return undefined;
  const marked = await recoveryStatus(client, driveRoot, entry);
  if (!marked && ownerIsLive(record)) return undefined;
  if (!marked && (await holdsRecovery(client, entry.url, entry.original, record.sourceVersions)))
    return undefined;
  const status = marked ?? "partial";
  let promoted = true;
  try {
    await updateIndex(client, driveRoot, (index) => {
      const record = transferRecord(index, entry.url);
      promoted =
        record.originalLocation === entry.original &&
        record.trashedAt?.getTime() === entry.trashedAt.getTime() &&
        (record.status === "pending" || record.status === "partial") &&
        (!ownerIsLive(record) || !!marked);
      if (promoted) record.status = status;
    });
  } catch (error) {
    console.warn(new TrashIndexWarning(indexUrlOf(driveRoot), error));
    try {
      await markRecovery(client, driveRoot, entry, status);
    } catch (error) {
      if (durable) throw error;
      console.warn(new TrashIndexWarning(recoveryMarker(driveRoot, entry), error));
    }
  }
  return promoted ? status : undefined;
}

async function recoveryItems(client: DriveClient, url: string): Promise<string[]> {
  if (!url.endsWith("/")) return [url];
  const children = await client.list(url);
  return (await Promise.all(children.map((child) => recoveryItems(client, child.url)))).flat();
}

/** Never trust a stale caller's copy of the index's transfer state. */
async function requireTrashEntry(
  client: DriveClient,
  driveRoot: string,
  entry: TrashEntry,
  pending = false,
  owner?: string,
): Promise<string | undefined> {
  const current = await client.readRdf(indexUrlOf(driveRoot));
  const index = current ? trashIndexFrom(current.dataset) : emptyTrashIndex();
  const record = transferRecord(index, entry.url);
  if (
    record.originalLocation !== entry.original ||
    record.trashedAt?.getTime() !== entry.trashedAt.getTime() ||
    (pending &&
      (record.status !== "pending" ||
        record.leaseOwner !== owner ||
        (record.leaseUntil?.getTime() ?? 0) <= Date.now()))
  )
    throw new DriveError("invalid-trash-record", 409, entry.url);
  if (!pending && record.status !== "pending" && ownerIsLive(record)) throw new TrashMovingError();
  if (!pending && record.status === "pending") {
    const reconciled = await reconcilePending(client, driveRoot, entry, record, true);
    if (reconciled) return reconciled;
    throw new TrashMovingError();
  }
  return record.status;
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
    let status = transferRecord(index, entry.url).status;
    if (status === "pending") {
      status = await reconcilePending(client, driveRoot, entry, index.record(entry.url));
      if (!status) continue;
    } else if (!(await exists(client, entry.url))) {
      // Restore/delete may have succeeded while their final index PUT failed.
      missing.push(entry.url);
      continue;
    }
    entries.push(
      status === "partial"
        ? { ...entry, status, remaining: await recoveryItems(client, entry.url) }
        : entry,
    );
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
  const owner = `urn:uuid:${crypto.randomUUID()}`;
  liveTransfers.add(owner);
  let renewing: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    renewing = renewing
      .then(() =>
        updateIndex(client, driveRoot, (index) => {
          for (const record of index.records) {
            if (record.leaseOwner === owner && record.status === "pending")
              record.leaseUntil = new Date(Date.now() + LEASE_MS);
          }
        }),
      )
      .catch((error: unknown) => {
        console.warn(new TrashIndexWarning(indexUrlOf(driveRoot), error));
      });
  }, LEASE_MS / 4);
  try {
    return await runTrash(client, driveRoot, items, options, owner);
  } finally {
    clearInterval(heartbeat);
    await renewing;
    liveTransfers.delete(owner);
    stoppedTransfers.set(owner, Date.now() + LEASE_MS);
    for (const [stopped, until] of stoppedTransfers) {
      if (until < Date.now()) stoppedTransfers.delete(stopped);
    }
  }
}

async function runTrash(
  client: DriveClient,
  driveRoot: string,
  items: readonly DriveItem[],
  options: { webId?: string; now?: Date },
  owner: string,
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
  try {
    await client.prepareTrash(trash, options.webId);
    const intents = await Promise.all(
      entries.map(async (entry) => [entry, await sourceVersions(client, entry.original)] as const),
    );
    await updateIndex(client, driveRoot, (index) => {
      for (const [entry, versions] of intents) {
        addTrashRecord(index, entry);
        const record = transferRecord(index, entry.url);
        record.status = "pending";
        record.leaseOwner = owner;
        record.leaseUntil = new Date(Date.now() + LEASE_MS);
        for (const version of versions) record.sourceVersions.add(version);
      }
    });
  } catch (error) {
    return {
      done: [],
      failed: items.map(({ url }) => ({ url, error })),
      warnings: [new TrashIndexWarning(indexUrlOf(driveRoot), error)],
    };
  }
  const partial: TrashEntry[] = [];
  for (const entry of entries) {
    try {
      await client.move(entry.original, entry.url, {
        ...(options.webId ? { privateOwner: options.webId } : {}),
        beforeDelete: async () => {
          await requireTrashEntry(client, driveRoot, entry, true, owner);
          await client.stat(entry.url);
        },
      });
      result.done.push(entry);
    } catch (error) {
      result.failed.push({ url: entry.original, error });
      if (error instanceof DrivePartialFailureError && error.retainedDestinations.length > 0)
        partial.push(entry);
    }
  }
  if (result.done.length > 0 || partial.length > 0) {
    try {
      await updateIndex(client, driveRoot, (index) => {
        for (const entry of [...result.done, ...partial]) {
          const record = transferRecord(index, entry.url);
          record.status = partial.includes(entry) ? "partial" : "complete";
          record.leaseOwner = undefined;
          record.leaseUntil = undefined;
        }
      });
    } catch (error) {
      // Preserve the completed side effects, but callers must withhold Undo
      // until the index has durably recorded completion.
      for (const entry of [...result.done, ...partial]) {
        try {
          await markRecovery(
            client,
            driveRoot,
            entry,
            partial.includes(entry) ? "partial" : "complete",
          );
        } catch (markerError) {
          console.warn(new TrashIndexWarning(recoveryMarker(driveRoot, entry), markerError));
        }
      }
      return { ...result, warnings: [new TrashIndexWarning(indexUrlOf(driveRoot), error)] };
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

async function removePolicyArchive(client: DriveClient, url: string): Promise<void> {
  const archive = policyArchiveOf(url) as string;
  if (await exists(client, archive)) await client.remove(archive);
}

function restoredName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (restored)${name.slice(dot)}` : `${name} (restored)`;
}

/** Merge recovery copies into their original tree, never replacing survivors. */
async function restoreMissing(
  client: DriveClient,
  from: string,
  to: string,
  settled: boolean,
): Promise<{ url: string; error: unknown }[]> {
  try {
    if (from.endsWith("/")) {
      let created = false;
      if (!(await exists(client, to))) {
        try {
          await client.createFolder(to);
          created = true;
        } catch (error) {
          if (!(error instanceof DriveError && error.kind === "conflict")) throw error;
        }
      }
      const remaining: { url: string; error: unknown }[] = [];
      for (const child of await client.list(from))
        remaining.push(
          ...(await restoreMissing(
            client,
            child.url,
            `${to}${child.url.slice(from.length)}`,
            settled,
          )),
        );
      // Non-recursive removal succeeds only for an empty recovery container.
      if (remaining.length === 0) {
        await client.mergeContainer(from, to, created);
        if (!settled) throw new TrashMovingError();
        await client.remove(from);
      }
      return remaining;
    }
    if (await exists(client, to)) {
      if (!settled) throw new TrashMovingError();
      const compared = await sameRecoveryFile(client, from, to);
      if (!compared.same) throw new DriveError("conflict", 412, to);
      if (!compared.etag || compared.etag.startsWith("W/"))
        throw new DriveError("missing-validator", 409, from);
      if (!compared.survivorEtag || compared.survivorEtag.startsWith("W/"))
        throw new DriveError("missing-validator", 409, to);
      const survivor = await client.stat(to, { ifMatch: compared.survivorEtag });
      // Also check servers that ignore HEAD preconditions, as the move client does.
      if (survivor.etag !== compared.survivorEtag) throw new DriveError("conflict", 412, to);
      // Without an atomic server operation, the survivor can still disappear between
      // this verification and the recovery DELETE. Keep that cross-resource window small.
      await client.remove(from, { ifMatch: compared.etag });
      return [];
    }
    if (!settled) {
      // An expired owner may still have an HTTP DELETE in flight. Even an absent
      // original can be recreated with the same content-derived ETag. Copy it
      // back, but retain recovery until a terminal receipt confirms quiescence.
      await client.copy(from, to);
      throw new TrashMovingError();
    }
    await client.move(from, to);
    return [];
  } catch (error) {
    return [{ url: from, error }];
  }
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
      const status = await requireTrashEntry(client, driveRoot, entry);
      if (status === "partial") {
        const current = await client.readRdf(indexUrlOf(driveRoot));
        const owner = current && trashIndexFrom(current.dataset).record(entry.url).leaseOwner;
        const settled =
          !owner ||
          stoppedTransfers.has(owner) ||
          !!(await recoveryStatus(client, driveRoot, entry));
        const remaining = await restoreMissing(client, entry.url, entry.original, settled);
        if (remaining.length) throw new TrashRestorePartialError(remaining);
        if (await recoveryStatus(client, driveRoot, entry))
          await client.remove(recoveryMarker(driveRoot, entry));
        await removePolicyArchive(client, entry.url);
        await client.remove(slot).catch(() => undefined);
        result.done.push({ entry, url: entry.original, renamed: false });
        continue;
      }
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
      const { url } = await client.move(entry.url, target);
      if (await recoveryStatus(client, driveRoot, entry))
        await client.remove(recoveryMarker(driveRoot, entry));
      // The slot may contain another writer's resources; only remove it empty.
      await removePolicyArchive(client, entry.url);
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
      await removeTrashItem(client, entry.url);
      if (await recoveryStatus(client, driveRoot, entry))
        await client.remove(recoveryMarker(driveRoot, entry));
      await removePolicyArchive(client, entry.url);
      await client.remove(slotOf(driveRoot, entry)).catch(() => undefined);
      result.done.push(entry);
    } catch (error) {
      result.failed.push({ url: entry.url, error });
    }
  }
  return removeCompletedRecords(
    client,
    driveRoot,
    result,
    result.done.map((entry) => entry.url),
  );
}

/** A missing descendant is a stale traversal, not proof the entry itself is gone. */
async function removeTrashItem(client: DriveClient, url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.remove(url, { recursive: true });
    } catch (error) {
      const cause = error instanceof DrivePartialFailureError ? error.cause : error;
      if (!(cause instanceof DriveError && cause.kind === "not-found")) throw error;
      if (!(await exists(client, url))) return;
      if (attempt > 0) throw error;
      // Recursive removal takes a new listing on the one retry.
      continue;
    }
    if (await exists(client, url)) throw new DriveError("conflict", 409, url);
    return;
  }
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
    .filter((entry) => entry.status !== "partial" && entry.trashedAt.getTime() < cutoff)
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
