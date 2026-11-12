// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { ResourceWriteError } from "../../pod/resource.js";
import { IntegrationSyncError } from "../errors.js";
import { fnv1a } from "../slug.js";
import { datasetBytes, sha256 } from "./hash.js";
import type { SyncLink, SyncPodWriter } from "./types.js";
import { LinkRecord, SYNC } from "./vocab.js";

const linkPredicates = new Set<string>([
  `${NS.RDF}type`,
  ...Object.entries(SYNC)
    .filter(([key]) => !["Link", "snapshot", "revisionOf", "expires"].includes(key))
    .map(([, value]) => value),
]);
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

export const LINK_SHARDS = 64;
export const MAX_LINKS_PER_SHARD = 128;
export const MAX_SYNC_LINKS = LINK_SHARDS * MAX_LINKS_PER_SHARD;

export function strongEtag(value: string | null | undefined): string {
  if (!value || !/^"[^"\r\n]+"$/.test(value) || value.length > 1024)
    throw new Error("Sync requires a strong ETag.");
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
/** Reject malformed records rather than turning them into apparently new items. */
function validate(link: SyncLink): void {
  checkedText(link.podUrl);
  for (const value of [link.remoteId, link.remoteVersion, link.lastSyncedHash, link.trashUrl])
    if (value !== undefined) checkedText(value);
  if ((link.remoteId === undefined) !== (link.remoteVersion === undefined))
    throw new Error("Incomplete remote sync identity.");
  if (link.podEtag !== undefined) strongEtag(link.podEtag);
  if (link.pendingCreate) {
    checkedText(link.pendingCreate.key);
    checkedText(link.pendingCreate.hash);
    strongEtag(link.pendingCreate.podEtag);
    checkedText(link.pendingCreate.resourceUrl);
  }
  if (!link.remoteId && !link.pendingCreate)
    throw new Error("Link has no remote identity or intent.");
  if (link.conflict) {
    checkedText(link.conflict.snapshotUrl);
    checkedText(link.conflict.remoteVersion);
    if (!["manual", "pod", "remote"].includes(link.conflict.resolution))
      throw new Error("Invalid conflict resolution.");
  }
  if (
    link.status !== undefined &&
    !["remote-deleted", "trashed", "pod-deleted"].includes(link.status)
  )
    throw new Error("Invalid sync link status.");
  if (link.pendingDelete !== undefined && typeof link.pendingDelete !== "boolean")
    throw new Error("Invalid delete intent.");
  if (link.needsInbound !== undefined && typeof link.needsInbound !== "boolean")
    throw new Error("Invalid inbound verification flag.");
  if (JSON.stringify(link).length > 16_384) throw new Error("Sync link byte cap exceeded.");
}

/**
 * Fixed bounded fan-out by pod URL. One bounded index per run supplies both lookup keys.
 * A 412 re-reads the shard and reapplies only this record; a concurrent change of this
 * same record fails closed. Hosts still serialize runs across processes, as for imports.
 */
export function createLinkStore(writer: SyncPodWriter, account: string, adapterId = "sync") {
  const base = `${accountKey(account)}/links/`;
  const byPod = new Map<string, SyncLink>();
  const byRemote = new Map<string, SyncLink>();
  const shardPods = Array.from({ length: LINK_SHARDS }, () => new Set<string>());
  let loaded = false;
  const shardFor = (url: string) => Number.parseInt(fnv1a(url), 16) % LINK_SHARDS;
  const slugFor = (shard: number) => `${base}${shard.toString(16).padStart(2, "0")}.ttl`;
  const accountRoot = writer.resolve(`${account}/`);
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
  async function readShard(shard: number) {
    const slug = slugFor(shard);
    await writer.ensureOwnerOnly(slug);
    const stored = await writer.read(slug);
    const records = new Map<string, SyncLink>();
    if (stored) {
      strongEtag(stored.etag);
      datasetBytes(stored.dataset);
      // Only the typed podUrl predicate is a record discriminator; reject unexpected RDF.
      if (stored.dataset.size > MAX_LINKS_PER_SHARD * linkPredicates.size)
        throw new Error("Malformed or oversized sync shard.");
      const subjectPredicates = new Set<string>();
      const subjects = new Set<string>();
      for (const q of stored.dataset) {
        const key = JSON.stringify([q.subject.value, q.predicate.value]);
        if (
          q.subject.termType !== "NamedNode" ||
          q.graph.termType !== "DefaultGraph" ||
          !linkPredicates.has(q.predicate.value) ||
          subjectPredicates.has(key)
        )
          throw new Error("Unexpected sync shard RDF.");
        subjectPredicates.add(key);
        subjects.add(q.subject.value);
      }
      for (const q of stored.dataset.match(null, DataFactory.namedNode(SYNC.podUrl), null)) {
        if (q.subject.termType !== "NamedNode") throw new Error("Invalid sync record subject.");
        const record = new LinkRecord(q.subject.value, stored.dataset, DataFactory);
        const link = record.record;
        if (!link || record.podUrl !== link.podUrl) throw new Error("Invalid sync record.");
        validate(link);
        localUrl(link.podUrl);
        if (link.trashUrl) metadataUrl(link.trashUrl, "trash");
        if (link.pendingCreate) metadataUrl(link.pendingCreate.resourceUrl, "conflicts");
        if (link.conflict) metadataUrl(link.conflict.snapshotUrl, "conflicts");
        if (!record.types.has(SYNC.Link)) throw new Error("Invalid sync record class.");
        if (shardFor(link.podUrl) !== shard || records.has(link.podUrl))
          throw new Error("Misplaced sync record.");
        if (q.subject.value !== `${writer.resolve(slug)}#${await sha256(link.podUrl)}`)
          throw new Error("Invalid sync record identity.");
        records.set(link.podUrl, link);
      }
      if (records.size !== subjects.size || records.size > MAX_LINKS_PER_SHARD)
        throw new Error("Unexpected sync shard RDF.");
    }
    return { stored, records };
  }
  function index(link: SyncLink) {
    const previous = byPod.get(link.podUrl);
    if (previous?.remoteId) byRemote.delete(previous.remoteId);
    if (link.remoteId) {
      const existing = byRemote.get(link.remoteId);
      if (existing && existing.podUrl !== link.podUrl)
        throw new Error("Duplicate remote sync identity.");
      byRemote.set(link.remoteId, link);
    }
    byPod.set(link.podUrl, link);
    shardPods[shardFor(link.podUrl)]?.add(link.podUrl);
  }
  function checkIdentities(shard: number, records: ReadonlyMap<string, SyncLink>): void {
    const remoteIds = new Set<string>();
    for (const link of records.values()) {
      if (!link.remoteId) continue;
      const existing = byRemote.get(link.remoteId);
      if (remoteIds.has(link.remoteId) || (existing && shardFor(existing.podUrl) !== shard))
        throw new Error("Duplicate remote sync identity.");
      remoteIds.add(link.remoteId);
    }
  }
  return {
    async load(): Promise<void> {
      if (loaded) return;
      for (let i = 0; i < LINK_SHARDS; i++) {
        const { records } = await readShard(i);
        for (const link of records.values()) index(link);
      }
      loaded = true;
    },
    byPodUrl(url: string): SyncLink | undefined {
      if (!loaded) throw new Error("Load sync links first.");
      return byPod.get(url);
    },
    byRemoteId(id: string): SyncLink | undefined {
      if (!loaded) throw new Error("Load sync links first.");
      return byRemote.get(id);
    },
    all(): readonly SyncLink[] {
      if (!loaded) throw new Error("Load sync links first.");
      return [...byPod.values()];
    },
    async put(link: SyncLink): Promise<void> {
      if (!loaded) throw new Error("Load sync links first.");
      validate(link);
      localUrl(link.podUrl);
      if (link.trashUrl) metadataUrl(link.trashUrl, "trash");
      if (link.pendingCreate) metadataUrl(link.pendingCreate.resourceUrl, "conflicts");
      if (link.conflict) metadataUrl(link.conflict.snapshotUrl, "conflicts");
      const expected = byPod.get(link.podUrl);
      const other = link.remoteId ? byRemote.get(link.remoteId) : undefined;
      if (other && other.podUrl !== link.podUrl) throw new Error("Duplicate remote sync identity.");
      const shard = shardFor(link.podUrl);
      for (let attempt = 0; attempt < 4; attempt++) {
        const { stored, records } = await readShard(shard);
        if (fingerprint(records.get(link.podUrl)) !== fingerprint(expected))
          throw new IntegrationSyncError(adapterId, "The sync link changed concurrently.", {
            status: 412,
          });
        records.set(link.podUrl, link);
        if (records.size > MAX_LINKS_PER_SHARD) throw new Error("Sync link shard is full.");
        // Validate the merged shard BEFORE committing: a 412 may introduce a record
        // using the same remote identity as our previously uncommitted create.
        checkIdentities(shard, records);
        const dataset = new Store();
        const slug = slugFor(shard);
        for (const item of records.values()) {
          const record = new LinkRecord(
            `${writer.resolve(slug)}#${await sha256(item.podUrl)}`,
            dataset,
            DataFactory,
          );
          record.types.add(SYNC.Link);
          record.podUrl = item.podUrl;
          record.record = item;
        }
        datasetBytes(dataset);
        try {
          await writer.write(
            { slug, dataset, category: "sync-links", forClass: SYNC.Link, skipRegistration: true },
            stored ? { ifMatch: strongEtag(stored.etag) } : { ifNoneMatch: "*" },
          );
          for (const url of shardPods[shard] ?? []) {
            const previous = byPod.get(url);
            if (previous?.remoteId) byRemote.delete(previous.remoteId);
            byPod.delete(url);
          }
          shardPods[shard]?.clear();
          for (const merged of records.values()) index(merged);
          return;
        } catch (error) {
          if (
            !(error instanceof ResourceWriteError || error instanceof IntegrationSyncError) ||
            error.status !== 412 ||
            attempt === 3
          )
            throw error;
        }
      }
    },
  };
}
