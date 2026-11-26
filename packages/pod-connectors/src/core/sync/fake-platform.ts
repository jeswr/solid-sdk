// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { DataFactory } from "n3";
import { ResourceWriteError } from "../../pod/resource.js";
import { createImportSession } from "../import-session.js";
import { copyDataset } from "../incremental.js";
import type { NormalisedDoc, WriteConditions } from "../types.js";
import { CLASSES, PodThing, SCHEMA } from "../vocab.js";
import type { SyncPodWriter, SyncResource, TwoWayAdapter } from "./types.js";

export interface FakeOperation {
  readonly remoteId?: string;
  readonly name: string;
}
export interface FakeRemoteItem {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly modifiedAt: string;
  readonly deleted?: boolean;
  readonly key?: string;
  /** Change serial for the delta-only mode's cursor. */
  readonly serial?: number;
}
export interface FakeTwoWayOptions {
  /** Delta-only inbound: with a `cursor-N` checkpoint only later changes (and the framework's
   * pendingRemoteIds) are delivered, as a provider sync token would. */
  readonly delta?: boolean;
  /** false models a provider whose creates cannot be deduplicated by key. */
  readonly deduplicatesCreateKeys?: boolean;
}
/** Typed one-item document used by the synthetic reference platform. */
export function fakeSyncDocument(url: string, name: string): NormalisedDoc {
  const dataset = copyDataset();
  const item = new PodThing(`${url}#item`, dataset, DataFactory);
  item.name = name;
  return { slug: url, dataset, category: "documents", forClass: CLASSES.TextDigitalDocument };
}
export function fakeSyncName(resource: Pick<SyncResource, "url" | "dataset">): string {
  return new PodThing(`${resource.url}#item`, resource.dataset, DataFactory).name ?? "";
}

/**
 * Write `name` at `url` exactly as an earlier one-way import of `adapterId` would have: through
 * the shared import session, so it carries that connector's import provenance and no sync link.
 */
export async function fakeOneWayImport(
  writer: SyncPodWriter,
  adapterId: string,
  url: string,
  name: string,
): Promise<void> {
  const session = createImportSession(
    writer,
    adapterId,
    `urn:solid:connector:${encodeURIComponent(adapterId)}:source`,
    {},
  );
  try {
    await session.write(fakeSyncDocument(url, name));
    await session.finish();
  } finally {
    session.release();
  }
}

/**
 * Owner-only model of the reference pod. `verify`/`confirm` decide the private-destination
 * checks per URL (default: every destination is owner-only); set `owner` false to refuse all.
 */
export interface MemorySyncPodPrivacy {
  owner: boolean;
  verify?: (url: string) => boolean | Promise<boolean>;
  confirm?: (url: string) => boolean | Promise<boolean>;
}
export interface MemorySyncPodOptions {
  /** Supply no verifier at all, as a host that cannot check owner-only access. */
  readonly withoutPrivacyChecks?: boolean;
}

/**
 * Bounded-memory fixture host with real validator checks, owner protection and complete lists.
 * It models an owner-only pod: it supplies `verifyPrivateDestination`, `confirmPrivateWrite`
 * and `cleanupPrivateWrite`, so private sync runs go THROUGH the private-destination gate.
 */
export function createMemorySyncPod(options: MemorySyncPodOptions = {}) {
  const root = `https://pod.test/integrations/fake-${crypto.randomUUID()}/`;
  const documents = new Map<
    string,
    { dataset: ReturnType<typeof copyDataset>; etag: string; lastModified: string }
  >();
  const protectedUrls = new Set<string>();
  const privacy: MemorySyncPodPrivacy = { owner: true };
  /** URLs checked before a mutation, and confirmed after one, in order. */
  const verified: string[] = [];
  const confirmed: string[] = [];
  let version = 0;
  const resolve = (slug: string) => {
    const url = new URL(slug, root);
    if (!url.href.startsWith(root) || url.hash || url.search)
      throw new Error("Fixture URL escapes connector.");
    return url.href;
  };
  const checks: Pick<
    SyncPodWriter,
    "verifyPrivateDestination" | "confirmPrivateWrite" | "cleanupPrivateWrite"
  > = {
    async verifyPrivateDestination(url) {
      verified.push(url);
      return privacy.owner && (await (privacy.verify?.(url) ?? true));
    },
    async confirmPrivateWrite(url) {
      confirmed.push(url);
      return privacy.owner && (await (privacy.confirm?.(url) ?? true));
    },
    async cleanupPrivateWrite(slug, { etag }) {
      const url = resolve(slug);
      if (documents.get(url)?.etag !== etag) return false;
      documents.delete(url);
      return true;
    },
  };
  const writer: SyncPodWriter = {
    webId: "https://pod.test/profile#owner",
    resolve,
    ...(options.withoutPrivacyChecks ? {} : checks),
    async read(slug) {
      const stored = documents.get(resolve(slug));
      return stored ? { ...stored, dataset: copyDataset(stored.dataset) } : undefined;
    },
    async write(doc: NormalisedDoc, conditions?: WriteConditions) {
      const url = resolve(doc.slug);
      const stored = documents.get(url);
      if (
        (conditions?.ifNoneMatch === "*" && stored) ||
        (conditions?.ifMatch && conditions.ifMatch !== stored?.etag)
      )
        throw new ResourceWriteError(url, 412);
      const etag = `"v${++version}"`;
      const created = !stored;
      documents.set(url, {
        dataset: copyDataset(doc.dataset),
        etag,
        lastModified: new Date().toISOString(),
      });
      return {
        url,
        etag,
        category: doc.category,
        forClass: doc.forClass,
        skipRegistration: doc.skipRegistration,
        // Validators for the private-write confirmation and clean-up of a refused create.
        writeEtag: etag,
        writeCreated: created && conditions?.ifNoneMatch === "*",
      };
    },
    async remove(slug, conditions) {
      const url = resolve(slug);
      const stored = documents.get(url);
      if (stored && conditions?.ifMatch && conditions.ifMatch !== stored.etag)
        throw new ResourceWriteError(url, 412);
      documents.delete(url);
    },
    async registerType() {
      return { indexUrl: `${root}index.ttl` };
    },
    async ensureOwnerOnly(slug) {
      protectedUrls.add(resolve(slug));
    },
    async *list(container) {
      const url = resolve(container);
      for (const [key, value] of documents) {
        if (key.startsWith(url) && !key.slice(url.length).includes("/"))
          yield { url: key, etag: value.etag };
      }
    },
  };
  return {
    writer,
    documents,
    protectedUrls,
    privacy,
    verified,
    confirmed,
    async put(slug: string, name: string, modifiedAt = "2026-01-01T00:00:00Z") {
      await writer.write(fakeSyncDocument(resolve(slug), name));
      const stored = documents.get(resolve(slug));
      if (stored) stored.lastModified = modifiedAt;
    },
    name(slug: string): string | undefined {
      const url = resolve(slug);
      const stored = documents.get(url);
      return stored ? fakeSyncName({ url, dataset: stored.dataset }) : undefined;
    },
  };
}

/** No network: models conditional versions, durable idempotency and a post-create crash. */
export function createFakeTwoWayAdapter(account = "account", config: FakeTwoWayOptions = {}) {
  const items = new Map<string, FakeRemoteItem>();
  const calls = { apply: 0, create: 0, update: 0, delete: 0, find: 0 };
  let serial = 0;
  let version = 0;
  let changes = 0;
  const dedupe = config.deduplicatesCreateKeys !== false;
  const platform = {
    items,
    calls,
    crashAfterCreate: false,
    afterApply: undefined as (() => void) | undefined,
    set(name: string, id = "remote-1", modifiedAt = "2026-01-01T00:00:00Z") {
      const item = {
        ...(items.get(id)?.key ? { key: items.get(id)?.key } : {}),
        id,
        name,
        modifiedAt,
        version: `remote-${++version}`,
        serial: ++changes,
      };
      items.set(id, item);
      return item;
    },
    remove(id = "remote-1") {
      const previous = items.get(id);
      if (!previous) throw new Error("Missing fixture item.");
      items.set(id, {
        ...previous,
        version: `remote-${++version}`,
        deleted: true,
        serial: ++changes,
      });
    },
  };
  const adapter: TwoWayAdapter<FakeOperation> = {
    metadata: {
      id: "fake-platform",
      name: "Synthetic two-way platform",
      tier: "A",
      authKind: "none",
      scopes: [],
      categories: ["documents"],
      whatYouGet: "Synthetic fixtures only",
      requirements: [],
    },
    fixtures: () => [],
    fieldsForHash: [`${SCHEMA}name`],
    itemSubjects: (url) => [`${url}#item`],
    writeBackContainers: ["items/"],
    requiredWriteScopes: ["fake:write"],
    ...(dedupe ? {} : { deduplicatesCreateKeys: false }),
    async import(ctx) {
      const since = config.delta ? Number(/^cursor-(\d+)$/.exec(ctx.cursor ?? "")?.[1] ?? 0) : 0;
      const wanted = new Set(config.delta && since ? ctx.sync.pendingRemoteIds() : []);
      for (const item of items.values()) {
        ctx.signal?.throwIfAborted();
        if (since && (item.serial ?? 0) <= since && !wanted.has(item.id)) continue;
        if (item.deleted) await ctx.sync.delete(item.id, item.version);
        else {
          // Framework-owned slug; the provider key lets inbound adopt our own create.
          const url = await ctx.sync.resolve(item.id, `${account}/items`, item.key);
          await ctx.sync.upsert({
            remoteId: item.id,
            remoteVersion: item.version,
            modifiedAt: item.modifiedAt,
            ...(item.key ? { idempotencyKey: item.key } : {}),
            document: fakeSyncDocument(url, item.name),
          });
        }
      }
      return { cursor: `cursor-${changes}` };
    },
    toRemote(resource) {
      return { remoteId: resource.remoteId, name: fakeSyncName(resource) };
    },
    async applyRemote(op, options) {
      options.signal?.throwIfAborted();
      calls.apply++;
      let item: FakeRemoteItem;
      if (op.remoteId) {
        const previous = items.get(op.remoteId);
        if (!previous || previous.deleted || options.ifMatch !== previous.version)
          throw new ResourceWriteError(op.remoteId, 412);
        calls.update++;
        item = {
          ...previous,
          name: op.name,
          version: `remote-${++version}`,
          modifiedAt: new Date().toISOString(),
          serial: ++changes,
        };
      } else {
        if (!options.idempotencyKey) throw new Error("Missing create key.");
        const found = [...items.values()].find((item) => item.key === options.idempotencyKey);
        if (found && dedupe) return { remoteId: found.id, remoteVersion: found.version };
        calls.create++;
        item = {
          id: `created-${++serial}`,
          name: op.name,
          version: `remote-${++version}`,
          modifiedAt: new Date().toISOString(),
          key: options.idempotencyKey,
          serial: ++changes,
        };
      }
      items.set(item.id, item);
      platform.afterApply?.();
      if (!op.remoteId && platform.crashAfterCreate) {
        platform.crashAfterCreate = false;
        throw new Error("Synthetic crash after remote create.");
      }
      return { remoteId: item.id, remoteVersion: item.version };
    },
    async findByIdempotencyKey(key, options) {
      options.signal?.throwIfAborted();
      calls.find++;
      const item = [...items.values()].find((item) => item.key === key);
      return item ? { remoteId: item.id, remoteVersion: item.version } : undefined;
    },
    async deleteRemote(remoteId, options) {
      options.signal?.throwIfAborted();
      calls.delete++;
      const item = items.get(remoteId);
      if (!item || item.deleted) return;
      if (options.ifMatch !== item.version) throw new ResourceWriteError(remoteId, 412);
      platform.remove(remoteId);
    },
  };
  return { adapter, platform };
}
