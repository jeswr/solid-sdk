// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { ResourceWriteError } from "../../pod/resource.js";
import { IntegrationSyncError } from "../errors.js";
import { datasetBytes, sha256 } from "./hash.js";
import type { SyncLink, SyncPodWriter, SyncSkip, SyncSkipReason } from "./types.js";
import {
  LINK_MANIFEST_PREDICATES,
  LINK_RECORD_PREDICATES,
  LINK_SHARD_PREDICATES,
  LinkManifest,
  LinkRecord,
  LinkShardHeader,
  PendingItemRecord,
  SYNC,
} from "./vocab.js";

/** Base shards per connection; records are placed by HMAC-SHA-256(salt, podUrl). */
export const LINK_SHARDS = 64;
/** Records per link document; a full base shard spills into overflow documents. */
export const MAX_LINKS_PER_SHARD = 128;
/** Hard per-connection link cap. Beyond it items are skipped and reported, never thrown. */
export const MAX_SYNC_LINKS = 50_000;
/** Base plus overflow documents a connection may hold. */
export const MAX_LINK_DOCUMENTS = LINK_SHARDS + Math.ceil(MAX_SYNC_LINKS / MAX_LINKS_PER_SHARD);
/** Pending (failed, deferred, unlinked) items the manifest retains. */
export const MAX_PENDING_ITEMS = 2_048;
/** Trashed / pod-deleted tombstones are garbage-collected this long after deletion. */
export const TOMBSTONE_RETENTION_MS = 30 * 86_400_000;

const SKIP_REASONS: ReadonlySet<SyncSkipReason> = new Set<SyncSkipReason>([
  "mapping-failed",
  "hash-failed",
  "read-failed",
  "write-failed",
  "remote-failed",
  "weak-etag",
  "unsupported-resource",
  "unlinked-import",
  "duplicate-identity",
  "link-cap",
  "deferred",
]);

/** A resource without a strong validator; fails only the item that carries it. */
export class WeakEtagError extends Error {
  constructor() {
    super("Sync requires a strong ETag.");
    this.name = "WeakEtagError";
  }
}
/**
 * The manifest (and with it the shard salt) is missing while link documents exist. A fresh salt
 * would place every existing record in the wrong shard, so the run stops instead. Recovery:
 * restore `<account>/links/manifest.ttl` from a backup, or delete the whole `<account>/links/`
 * container so the next run re-adopts items from a full inbound pass.
 */
export class LinkManifestLostError extends Error {
  constructor() {
    super("Sync link manifest is missing while link documents exist.");
    this.name = "LinkManifestLostError";
  }
}
/** The provider identity is already linked to another pod resource. */
export class DuplicateSyncIdentityError extends Error {
  constructor() {
    super("Duplicate remote sync identity.");
    this.name = "DuplicateSyncIdentityError";
  }
}
/** The connection's hard link cap is reached. */
export class LinkCapError extends Error {
  constructor() {
    super("Sync link cap reached.");
    this.name = "LinkCapError";
  }
}

function fingerprint(link: SyncLink | undefined): string | undefined {
  if (!link) return undefined;
  const sort = (value: unknown): unknown =>
    value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sort(v)]),
        )
      : value;
  return JSON.stringify(sort(link));
}

export function strongEtag(value: string | null | undefined): string {
  if (!value || !/^"[^"\r\n]+"$/.test(value) || value.length > 1024) throw new WeakEtagError();
  return value;
}
export function accountKey(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error("Invalid sync account key.");
  return value;
}
export function checkedText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    [...value].some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error("Invalid sync record text.");
  return value;
}
function checkCount(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000))
    throw new Error("Invalid sync counter.");
}
/** Reject malformed records rather than turning them into apparently new items. */
function validate(link: SyncLink): void {
  checkedText(link.podUrl);
  for (const value of [link.remoteId, link.remoteVersion, link.lastSyncedHash, link.trashUrl])
    if (value !== undefined) checkedText(value);
  if (link.movedFrom !== undefined) checkedText(link.movedFrom);
  if ((link.remoteId === undefined) !== (link.remoteVersion === undefined))
    throw new Error("Incomplete remote sync identity.");
  if (link.podEtag !== undefined) strongEtag(link.podEtag);
  if (link.pendingCreate) {
    checkedText(link.pendingCreate.key);
    checkedText(link.pendingCreate.hash);
    strongEtag(link.pendingCreate.podEtag);
    checkedText(link.pendingCreate.resourceUrl);
    checkCount(link.pendingCreate.attempts);
  }
  checkCount(link.deleteHeldRuns);
  if (link.conflict) {
    checkedText(link.conflict.snapshotUrl);
    checkedText(link.conflict.remoteVersion);
    if (link.conflict.remoteId !== undefined) checkedText(link.conflict.remoteId);
    if (!["manual", "pod", "remote"].includes(link.conflict.resolution))
      throw new Error("Invalid conflict resolution.");
  }
  // A duplicate identity is kept as a conflict-only record (item resolved by the owner).
  if (!link.remoteId && !link.pendingCreate && link.conflict?.resolution !== "manual")
    throw new Error("Link has no remote identity or intent.");
  if (
    link.status !== undefined &&
    !["remote-deleted", "trashed", "pod-deleted"].includes(link.status)
  )
    throw new Error("Invalid sync link status.");
  if (link.deletedAt !== undefined && !Number.isFinite(Date.parse(link.deletedAt)))
    throw new Error("Invalid sync deletion time.");
  if (link.pendingDelete !== undefined && typeof link.pendingDelete !== "boolean")
    throw new Error("Invalid delete intent.");
  if (link.needsInbound !== undefined && typeof link.needsInbound !== "boolean")
    throw new Error("Invalid inbound verification flag.");
  if (JSON.stringify(link).length > 16_384) throw new Error("Sync link byte cap exceeded.");
}
function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export interface LinkStoreOptions {
  /** Lower the hard per-connection link cap (tests, constrained hosts). */
  readonly maxLinks?: number;
}
interface StoredDoc {
  readonly etag?: string;
  readonly records: Map<string, SyncLink>;
  readonly overflowCount: number;
}

/**
 * Sharded owner-only link store. A random per-connection salt in the owner-only manifest keys
 * HMAC-SHA-256 placement, so a remote party cannot grind ids into one shard; a full shard
 * spills into overflow documents up to the hard link cap. A 412 re-reads the document and
 * reapplies only this record; a concurrent change of this same record fails closed. Hosts
 * still serialize runs across processes, as for imports.
 */
export function createLinkStore(
  writer: SyncPodWriter,
  account: string,
  adapterId = "sync",
  options: LinkStoreOptions = {},
) {
  const maxLinks = options.maxLinks ?? MAX_SYNC_LINKS;
  if (!Number.isSafeInteger(maxLinks) || maxLinks < 1 || maxLinks > MAX_SYNC_LINKS)
    throw new RangeError("Invalid sync link cap.");
  const base = `${accountKey(account)}/links/`;
  const manifestSlug = `${base}manifest.ttl`;
  const manifestUrl = writer.resolve(manifestSlug);
  const manifestSubject = `${manifestUrl}#manifest`;
  const byPod = new Map<string, SyncLink>();
  const byRemote = new Map<string, SyncLink>();
  const byKey = new Map<string, SyncLink>();
  const docOf = new Map<string, string>();
  const docMembers = new Map<string, Set<string>>();
  const overflow: number[] = Array.from({ length: LINK_SHARDS }, () => 0);
  const shardCache = new Map<string, number>();
  const subjectCache = new Map<string, string>();
  let key: CryptoKey | undefined;
  let salt = "";
  let adoptedAt: Date | undefined;
  let pending: SyncSkip[] = [];
  let duplicates: SyncLink[] = [];
  let staleMoves: SyncLink[] = [];
  /** Known duplicate/stale records: indexed by pod URL only, never by remote identity. */
  const noIdentity = new Set<string>();
  let loaded = false;
  const docSlug = (shard: number, index: number) =>
    `${base}${shard.toString(16).padStart(2, "0")}${index ? `-${index}` : ""}.ttl`;
  const accountRoot = writer.resolve(`${account}/`);
  function ensureLoaded(): void {
    if (!loaded) throw new Error("Load sync links first.");
  }
  function localUrl(url: string): void {
    const parsed = new URL(checkedText(url));
    if (
      parsed.href !== url ||
      !url.startsWith(accountRoot) ||
      parsed.search ||
      parsed.hash ||
      url.endsWith("/")
    )
      throw new Error("Sync link URL escapes its account.");
  }
  function metadataUrl(url: string, tree: "trash" | "conflicts"): void {
    localUrl(url);
    if (
      !url.startsWith(`${accountRoot}${tree}/`) ||
      !/^[a-f0-9]{64}\.ttl$/.test(url.slice(`${accountRoot}${tree}/`.length))
    )
      throw new Error("Invalid sync metadata URL.");
  }
  function checkUrls(link: SyncLink): void {
    localUrl(link.podUrl);
    if (link.movedFrom) localUrl(link.movedFrom);
    if (link.trashUrl) metadataUrl(link.trashUrl, "trash");
    if (link.pendingCreate) metadataUrl(link.pendingCreate.resourceUrl, "conflicts");
    if (link.conflict) metadataUrl(link.conflict.snapshotUrl, "conflicts");
  }
  async function shardFor(url: string): Promise<number> {
    const cached = shardCache.get(url);
    if (cached !== undefined) return cached;
    if (!key) throw new Error("Load sync links first.");
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url)),
    );
    const value =
      (((digest[0] ?? 0) << 24) |
        ((digest[1] ?? 0) << 16) |
        ((digest[2] ?? 0) << 8) |
        (digest[3] ?? 0)) >>>
      0;
    if (shardCache.size > 4 * MAX_SYNC_LINKS) shardCache.clear();
    shardCache.set(url, value % LINK_SHARDS);
    return value % LINK_SHARDS;
  }
  async function subjectFor(slug: string, podUrl: string): Promise<string> {
    let digest = subjectCache.get(podUrl);
    if (!digest) {
      digest = await sha256(podUrl);
      if (subjectCache.size > 4 * MAX_SYNC_LINKS) subjectCache.clear();
      subjectCache.set(podUrl, digest);
    }
    return `${writer.resolve(slug)}#${digest}`;
  }
  function strictRdf(dataset: DatasetCore, allowed: (subject: string) => ReadonlySet<string>) {
    const seen = new Set<string>();
    const subjects = new Set<string>();
    for (const q of dataset) {
      const pair = JSON.stringify([q.subject.value, q.predicate.value]);
      if (
        q.subject.termType !== "NamedNode" ||
        q.graph.termType !== "DefaultGraph" ||
        !allowed(q.subject.value).has(q.predicate.value) ||
        seen.has(pair)
      )
        throw new Error("Unexpected sync link RDF.");
      seen.add(pair);
      subjects.add(q.subject.value);
    }
    return subjects;
  }
  async function readDoc(shard: number, index: number): Promise<StoredDoc> {
    const slug = docSlug(shard, index);
    await writer.ensureOwnerOnly(slug);
    const stored = await writer.read(slug);
    const records = new Map<string, SyncLink>();
    if (!stored) return { records, overflowCount: 0 };
    const etag = strongEtag(stored.etag);
    datasetBytes(stored.dataset);
    if (
      stored.dataset.size >
      MAX_LINKS_PER_SHARD * LINK_RECORD_PREDICATES.size + LINK_SHARD_PREDICATES.size
    )
      throw new Error("Malformed or oversized sync shard.");
    const docUrl = writer.resolve(slug);
    const header = `${docUrl}#shard`;
    const subjects = strictRdf(stored.dataset, (subject) =>
      subject === header ? LINK_SHARD_PREDICATES : LINK_RECORD_PREDICATES,
    );
    let overflowCount = 0;
    if (subjects.has(header)) {
      const shardHeader = new LinkShardHeader(header, stored.dataset, DataFactory);
      const count = shardHeader.overflowCount;
      if (
        index !== 0 ||
        !shardHeader.types.has(SYNC.LinkShard) ||
        count === undefined ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > MAX_LINK_DOCUMENTS
      )
        throw new Error("Invalid sync shard header.");
      overflowCount = count;
    }
    for (const q of stored.dataset.match(null, DataFactory.namedNode(SYNC.podUrl), null)) {
      const record = new LinkRecord(q.subject.value, stored.dataset, DataFactory);
      const link = record.record;
      if (!link || record.podUrl !== link.podUrl) throw new Error("Invalid sync record.");
      validate(link);
      checkUrls(link);
      if (!record.types.has(SYNC.Link)) throw new Error("Invalid sync record class.");
      if ((await shardFor(link.podUrl)) !== shard || records.has(link.podUrl))
        throw new Error("Misplaced sync record.");
      if (q.subject.value !== (await subjectFor(slug, link.podUrl)))
        throw new Error("Invalid sync record identity.");
      records.set(link.podUrl, link);
    }
    if (
      records.size + (subjects.has(header) ? 1 : 0) !== subjects.size ||
      records.size > MAX_LINKS_PER_SHARD
    )
      throw new Error("Unexpected sync link RDF.");
    return { etag, records, overflowCount };
  }
  async function writeDoc(
    shard: number,
    index: number,
    doc: StoredDoc,
    overflowCount: number,
  ): Promise<void> {
    const slug = docSlug(shard, index);
    const dataset = new Store();
    if (index === 0 && overflowCount > 0) {
      const header = new LinkShardHeader(`${writer.resolve(slug)}#shard`, dataset, DataFactory);
      header.types.add(SYNC.LinkShard);
      header.overflowCount = overflowCount;
    }
    for (const item of doc.records.values()) {
      const record = new LinkRecord(await subjectFor(slug, item.podUrl), dataset, DataFactory);
      record.types.add(SYNC.Link);
      record.record = item;
    }
    datasetBytes(dataset);
    await writer.write(
      { slug, dataset, category: "sync-links", forClass: SYNC.Link, skipRegistration: true },
      doc.etag ? { ifMatch: strongEtag(doc.etag) } : { ifNoneMatch: "*" },
    );
  }
  const retryable = (error: unknown) =>
    (error instanceof ResourceWriteError || error instanceof IntegrationSyncError) &&
    error.status === 412;
  function unindex(url: string): void {
    const previous = byPod.get(url);
    if (!previous) return;
    if (previous.remoteId && byRemote.get(previous.remoteId)?.podUrl === url)
      byRemote.delete(previous.remoteId);
    if (previous.pendingCreate && byKey.get(previous.pendingCreate.key)?.podUrl === url)
      byKey.delete(previous.pendingCreate.key);
    byPod.delete(url);
    const slug = docOf.get(url);
    if (slug) docMembers.get(slug)?.delete(url);
    docOf.delete(url);
  }
  function index(link: SyncLink, slug: string, identity = true): void {
    byPod.set(link.podUrl, link);
    docOf.set(link.podUrl, slug);
    let members = docMembers.get(slug);
    if (!members) {
      members = new Set();
      docMembers.set(slug, members);
    }
    members.add(link.podUrl);
    if (identity && link.remoteId) byRemote.set(link.remoteId, link);
    if (link.pendingCreate) byKey.set(link.pendingCreate.key, link);
  }
  function reindex(slug: string, records: ReadonlyMap<string, SyncLink>): void {
    for (const url of [...(docMembers.get(slug) ?? [])]) unindex(url);
    // A mover and the record it replaces may share one document: the mover owns the identity.
    const replaced = new Set<string>();
    for (const link of records.values()) if (link.movedFrom) replaced.add(link.movedFrom);
    for (const link of records.values())
      index(link, slug, !noIdentity.has(link.podUrl) && !replaced.has(link.podUrl));
  }
  /** Merged documents may carry concurrent records; reject identity clashes before writing. */
  function checkIdentities(
    slug: string,
    records: ReadonlyMap<string, SyncLink>,
    replacing?: string,
  ): void {
    const remoteIds = new Set<string>();
    for (const link of records.values()) {
      // The record a move replaces may sit in the same document as its mover.
      if (!link.remoteId || noIdentity.has(link.podUrl) || link.podUrl === replacing) continue;
      const existing = byRemote.get(link.remoteId);
      if (
        remoteIds.has(link.remoteId) ||
        (existing &&
          existing.podUrl !== link.podUrl &&
          existing.podUrl !== replacing &&
          docOf.get(existing.podUrl) !== slug)
      )
        throw new DuplicateSyncIdentityError();
      remoteIds.add(link.remoteId);
    }
  }
  function docIndex(slug: string): number {
    const match = /(?:-(\d+))?\.ttl$/.exec(slug);
    return match?.[1] ? Number(match[1]) : 0;
  }
  /** First document in the shard's chain with room, growing the chain when all are full. */
  async function placeNew(shard: number): Promise<string> {
    for (let i = 0; i <= (overflow[shard] ?? 0); i++) {
      const slug = docSlug(shard, i);
      if ((docMembers.get(slug)?.size ?? 0) < MAX_LINKS_PER_SHARD) return slug;
    }
    const documents = overflow.reduce((total, count) => total + count + 1, 0);
    if (documents >= MAX_LINK_DOCUMENTS) throw new LinkCapError();
    const next = (overflow[shard] ?? 0) + 1;
    // Record the longer chain in the base header FIRST: a crash then leaves an empty
    // (missing) overflow document, never an overflow record the loader cannot see.
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await readDoc(shard, 0);
      if (doc.overflowCount >= next) break;
      try {
        await writeDoc(shard, 0, doc, next);
        break;
      } catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
      }
    }
    overflow[shard] = next;
    return docSlug(shard, next);
  }
  async function readManifest() {
    await writer.ensureOwnerOnly(manifestSlug);
    const stored = await writer.read(manifestSlug);
    if (!stored) return undefined;
    const etag = strongEtag(stored.etag);
    datasetBytes(stored.dataset);
    const pendingPrefix = `${manifestUrl}#pending-`;
    const subjects = strictRdf(stored.dataset, () => LINK_MANIFEST_PREDICATES);
    const manifest = new LinkManifest(manifestSubject, stored.dataset, DataFactory);
    const storedSalt = manifest.salt;
    if (
      !manifest.types.has(SYNC.LinkManifest) ||
      !storedSalt ||
      !/^[a-f0-9]{64}$/.test(storedSalt) ||
      (manifest.adoptedAt && !Number.isFinite(manifest.adoptedAt.getTime()))
    )
      throw new Error("Invalid sync link manifest.");
    const items: SyncSkip[] = [];
    for (const subject of subjects) {
      if (subject === manifestSubject) continue;
      if (!subject.startsWith(pendingPrefix) || items.length >= MAX_PENDING_ITEMS)
        throw new Error("Invalid sync link manifest.");
      const record = new PendingItemRecord(subject, stored.dataset, DataFactory);
      const item = record.item;
      if (!item || !record.types.has(SYNC.PendingItem)) throw new Error("Invalid pending item.");
      checkPending(item);
      if (subject !== (await pendingSubject(item))) throw new Error("Invalid pending item.");
      items.push(item);
    }
    return { etag, salt: storedSalt, adoptedAt: manifest.adoptedAt, pending: items };
  }
  function checkPending(item: SyncSkip): void {
    if (!["inbound", "outbound"].includes(item.direction) || !SKIP_REASONS.has(item.reason))
      throw new Error("Invalid pending item.");
    if (item.remoteId !== undefined) checkedText(item.remoteId);
    if (item.podUrl !== undefined) localUrl(item.podUrl);
    if (item.direction === "inbound" ? !item.remoteId : !item.podUrl)
      throw new Error("Invalid pending item.");
  }
  const pendingSubject = async (item: SyncSkip) =>
    `${manifestUrl}#pending-${await sha256(
      JSON.stringify([item.direction, item.direction === "inbound" ? item.remoteId : item.podUrl]),
    )}`;
  async function writeManifest(
    etag: string | undefined,
    value: { salt: string; adoptedAt?: Date; pending: readonly SyncSkip[] },
  ): Promise<void> {
    const dataset = new Store();
    const manifest = new LinkManifest(manifestSubject, dataset, DataFactory);
    manifest.types.add(SYNC.LinkManifest);
    manifest.salt = value.salt;
    manifest.adoptedAt = value.adoptedAt;
    const seen = new Set<string>();
    for (const item of value.pending) {
      // Only retainable items persist (a sub-container URL is reported, not retained).
      try {
        checkPending(item);
      } catch {
        continue;
      }
      const subject = await pendingSubject(item);
      if (seen.has(subject)) continue;
      if (seen.size >= MAX_PENDING_ITEMS) break;
      seen.add(subject);
      const record = new PendingItemRecord(subject, dataset, DataFactory);
      record.types.add(SYNC.PendingItem);
      record.item = item;
    }
    datasetBytes(dataset);
    await writer.write(
      {
        slug: manifestSlug,
        dataset,
        category: "sync-links",
        forClass: SYNC.LinkManifest,
        skipRegistration: true,
      },
      etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
    );
  }
  async function commit(
    url: string,
    slug: string,
    shard: number,
    expected: SyncLink | undefined,
    mutate: (records: Map<string, SyncLink>) => void,
    replacing?: string,
  ): Promise<void> {
    const indexInChain = docIndex(slug);
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await readDoc(shard, indexInChain);
      if (fingerprint(doc.records.get(url)) !== fingerprint(expected))
        throw new IntegrationSyncError(adapterId, "The sync link changed concurrently.", {
          status: 412,
        });
      mutate(doc.records);
      if (doc.records.size > MAX_LINKS_PER_SHARD) throw new Error("Sync link shard is full.");
      // Validate the merged document BEFORE committing: a 412 may introduce a record
      // using the same remote identity as our previously uncommitted create.
      checkIdentities(slug, doc.records, replacing);
      try {
        await writeDoc(
          shard,
          indexInChain,
          doc,
          indexInChain === 0 ? Math.max(doc.overflowCount, overflow[shard] ?? 0) : 0,
        );
        reindex(slug, doc.records);
        return;
      } catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
      }
    }
  }
  async function put(link: SyncLink, opts: { replacing?: string } = {}): Promise<void> {
    ensureLoaded();
    validate(link);
    checkUrls(link);
    const expected = byPod.get(link.podUrl);
    const other = link.remoteId ? byRemote.get(link.remoteId) : undefined;
    if (other && other.podUrl !== link.podUrl && other.podUrl !== opts.replacing)
      throw new DuplicateSyncIdentityError();
    if (!expected && byPod.size >= maxLinks) throw new LinkCapError();
    const shard = await shardFor(link.podUrl);
    const slug = docOf.get(link.podUrl) ?? (await placeNew(shard));
    await commit(
      link.podUrl,
      slug,
      shard,
      expected,
      (records) => records.set(link.podUrl, link),
      opts.replacing,
    );
  }
  async function remove(url: string): Promise<void> {
    ensureLoaded();
    const expected = byPod.get(url);
    const slug = docOf.get(url);
    if (!expected || !slug) return;
    await commit(url, slug, await shardFor(url), expected, (records) => records.delete(url));
  }
  return {
    async load(): Promise<void> {
      if (loaded) return;
      let manifest = await readManifest();
      if (!manifest) {
        // Never re-salt existing shards: their records would silently land in wrong shards.
        const baseUrl = writer.resolve(base);
        for await (const entry of writer.list(base))
          if (
            entry.url.startsWith(baseUrl) &&
            /^[0-9a-f]{2}(?:-\d+)?\.ttl$/.test(entry.url.slice(baseUrl.length))
          )
            throw new LinkManifestLostError();
        const fresh = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        try {
          await writeManifest(undefined, { salt: fresh, pending: [] });
        } catch (error) {
          if (!retryable(error)) throw error;
        }
        manifest = await readManifest();
        if (!manifest) throw new Error("Invalid sync link manifest.");
      }
      salt = manifest.salt;
      adoptedAt = manifest.adoptedAt;
      pending = [...manifest.pending];
      key = await crypto.subtle.importKey(
        "raw",
        hexBytes(salt),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const all: { link: SyncLink; slug: string }[] = [];
      let documents = 0;
      for (let shard = 0; shard < LINK_SHARDS; shard++) {
        const first = await readDoc(shard, 0);
        overflow[shard] = first.overflowCount;
        documents += first.overflowCount + 1;
        if (documents > MAX_LINK_DOCUMENTS) throw new Error("Malformed or oversized sync links.");
        for (let i = 0; i <= first.overflowCount; i++) {
          const doc = i === 0 ? first : await readDoc(shard, i);
          for (const link of doc.records.values()) {
            if (all.length >= MAX_SYNC_LINKS || byPod.has(link.podUrl))
              throw new Error("Malformed or oversized sync links.");
            all.push({ link, slug: docSlug(shard, i) });
            byPod.set(link.podUrl, link);
          }
        }
      }
      byPod.clear();
      // Duplicate identities never wedge: an interrupted move keeps its mover, and any
      // other duplicate is handed to the runner to record as a manual conflict.
      const groups = new Map<string, { link: SyncLink; slug: string }[]>();
      for (const entry of all) {
        if (!entry.link.remoteId) continue;
        const group = groups.get(entry.link.remoteId) ?? [];
        group.push(entry);
        groups.set(entry.link.remoteId, group);
      }
      const losers = new Set<string>();
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => (a.link.podUrl < b.link.podUrl ? -1 : 1));
        const mover = group.find(
          (entry) =>
            entry.link.movedFrom &&
            group.some((other) => other.link.podUrl === entry.link.movedFrom),
        );
        const winner = mover ?? group[0];
        for (const entry of group) {
          if (entry === winner) continue;
          losers.add(entry.link.podUrl);
          if (mover && entry.link.podUrl === mover.link.movedFrom) staleMoves.push(entry.link);
          else duplicates.push(entry.link);
        }
      }
      for (const url of losers) noIdentity.add(url);
      for (const entry of all) index(entry.link, entry.slug, !losers.has(entry.link.podUrl));
      loaded = true;
    },
    byPodUrl(url: string): SyncLink | undefined {
      ensureLoaded();
      return byPod.get(url);
    },
    byRemoteId(id: string): SyncLink | undefined {
      ensureLoaded();
      return byRemote.get(id);
    },
    /** The link holding a pending create with this idempotency key. */
    byCreateKey(value: string): SyncLink | undefined {
      ensureLoaded();
      return byKey.get(value);
    },
    all(): readonly SyncLink[] {
      ensureLoaded();
      return [...byPod.values()];
    },
    get size(): number {
      ensureLoaded();
      return byPod.size;
    },
    /** Base shard of a pod URL under this connection's salt (diagnostics and tests). */
    async shardOf(url: string): Promise<number> {
      ensureLoaded();
      return shardFor(url);
    },
    /** Document slug currently holding the record (diagnostics and tests). */
    documentOf(url: string): string | undefined {
      ensureLoaded();
      return docOf.get(url);
    },
    /** Records left by an interrupted move; the runner drops them. */
    staleMoves(): readonly SyncLink[] {
      ensureLoaded();
      return staleMoves;
    },
    /** Records duplicating another record's identity; the runner records manual conflicts. */
    duplicates(): readonly SyncLink[] {
      ensureLoaded();
      return duplicates;
    },
    /** Clear a recovery list once handled. */
    resolved(url: string): void {
      noIdentity.delete(url);
      staleMoves = staleMoves.filter((link) => link.podUrl !== url);
      duplicates = duplicates.filter((link) => link.podUrl !== url);
    },
    put,
    delete: remove,
    /**
     * Re-point a link to a moved pod resource: write the mover first (an interrupted move is
     * recovered on load), then drop the old record, then clear the move marker.
     */
    async move(oldUrl: string, link: SyncLink): Promise<void> {
      ensureLoaded();
      const old = byPod.get(oldUrl);
      if (!old?.remoteId || old.remoteId !== link.remoteId || oldUrl === link.podUrl)
        throw new Error("Invalid sync link move.");
      await put({ ...link, movedFrom: oldUrl }, { replacing: oldUrl });
      await remove(oldUrl);
      await put({ ...link, movedFrom: undefined });
    },
    /** The first two-way run sets this after a full inbound pass (adoption migration). */
    get adoptedAt(): Date | undefined {
      ensureLoaded();
      return adoptedAt;
    },
    /** Items retained by the manifest from previous runs. */
    pending(): readonly SyncSkip[] {
      ensureLoaded();
      return pending;
    },
    async saveManifest(update: { adoptedAt?: Date; pending: readonly SyncSkip[] }): Promise<void> {
      ensureLoaded();
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await readManifest();
        if (!current || current.salt !== salt)
          throw new IntegrationSyncError(adapterId, "The sync link manifest changed.", {
            status: 412,
          });
        const next = {
          salt,
          adoptedAt: update.adoptedAt ?? current.adoptedAt,
          pending: update.pending,
        };
        try {
          await writeManifest(current.etag, next);
          adoptedAt = next.adoptedAt;
          pending = [...update.pending].slice(0, MAX_PENDING_ITEMS);
          return;
        } catch (error) {
          if (!retryable(error) || attempt === 3) throw error;
        }
      }
    },
  };
}
export type LinkStore = ReturnType<typeof createLinkStore>;
